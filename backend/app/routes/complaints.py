import time
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.gemini_service import classify_complaint_with_gemini, _two_stage_merge_and_validate
from app.services.firestore_service import firestore_service
from app.services.priority_service import calculate_priority_score
from app.services.location_service import normalize_location

router = APIRouter(prefix="/requests", tags=["Complaints"])
logger = logging.getLogger("civiclens.routes.complaints")


class AnalyzeComplaintRequest(BaseModel):
    text: str = Field(..., min_length=5, description="Raw complaint text submitted by citizen")
    state: Optional[str] = Field(None, description="Optional citizen selected state hint")
    district: Optional[str] = Field(None, description="Optional citizen selected district hint")
    locality: Optional[str] = Field(None, description="Optional citizen selected locality hint")
    manual_categories: Optional[List[str]] = Field(default_factory=list, description="Optional pre-selected categories")


class SubmitComplaintRequest(BaseModel):
    text: str = Field(..., min_length=5, description="Raw complaint text submitted by citizen in any Indian language")
    user_id: Optional[str] = Field("anon-user", description="Authenticated citizen user ID or Firebase UID")
    state: Optional[str] = Field(None, description="Optional citizen selected state hint")
    district: Optional[str] = Field(None, description="Optional citizen selected district hint")
    locality: Optional[str] = Field(None, description="Optional citizen selected locality hint")
    confirmed_categories: Optional[List[str]] = Field(None, description="Citizen-reviewed categories after editing")
    manual_categories: Optional[List[str]] = Field(default_factory=list, description="Categories manually added by citizen")
    analysis: Optional[Dict[str, Any]] = Field(
        None,
        description="Result previously returned by /requests/analyze for this exact text. "
                    "When present, it is re-validated deterministically instead of calling Gemini again."
    )


class ComplaintResponse(BaseModel):
    id: str
    raw_text: str
    area_type: str
    categories: List[str] = Field(..., description="1 to 3 categories matching the area_type")
    ai_categories: Optional[List[str]] = None
    manual_categories: Optional[List[str]] = None
    location: str
    state: str
    district: str
    locality: str
    urgency: str
    priority_score: int = Field(50, ge=0, le=100, description="0-100 integer governance priority score")
    priority_reason: Optional[str] = Field(None, description="Explainable reason string for priority score")
    summary: str
    original_language: str
    user_id: str
    support_count: int
    high_priority: bool
    timestamp: float
    status: str
    classified_by: Optional[str] = Field("gemini", description="'gemini' or 'heuristic_fallback'")


@router.post("/analyze", summary="Analyze complaint with Gemini without persisting immediately")
async def analyze_complaint(payload: AnalyzeComplaintRequest):
    """
    Step 3 of Grievance Reporting Flow:
    Analyzes raw complaint text using Gemini + Two-Stage deterministic verification,
    merges optional manual categories, normalizes location, and calculates 0-100 priority score.
    Allows the citizen to review and edit category chips before final submission.
    """
    # 1. Run Gemini multi-label classification with authoritative state & district hints
    ai_result = await classify_complaint_with_gemini(
        text=payload.text,
        state_hint=payload.state,
        district_hint=payload.district
    )

    ai_cats = list(ai_result.get("categories", ["roads"]))
    manual_cats = payload.manual_categories or []

    # Merge AI categories + manual categories (deduplicate, cap at max 3)
    merged_cats: List[str] = list(ai_cats)
    for mc in manual_cats:
        if mc and mc not in merged_cats:
            merged_cats.append(mc)
    final_cats = merged_cats[:3]

    # Recalculate 0-100 priority score based on final merged categories
    score, reason = calculate_priority_score(
        urgency=ai_result.get("urgency", "medium"),
        categories=final_cats,
        raw_text=payload.text,
        support_count=1
    )

    return {
        "area_type": ai_result["area_type"],
        "categories": final_cats,
        "ai_categories": ai_cats,
        "manual_categories": manual_cats,
        "location": ai_result["location"],
        "state": ai_result["state"],
        "district": ai_result["district"],
        "locality": ai_result["locality"],
        "urgency": ai_result["urgency"],
        "priority_score": score,
        "priority_reason": reason,
        "summary": ai_result["summary"],
        "original_language": ai_result["original_language"],
        "classified_by": ai_result.get("classified_by", "gemini")
    }


@router.post("/submit", response_model=ComplaintResponse, summary="Submit raw complaint, analyze with Gemini AI, and save to Firestore")
async def submit_complaint(payload: SubmitComplaintRequest):
    """
    Core CivicLens ingestion endpoint:
    1. Receives raw complaint text (or voice transcript).
    2. Runs Gemini + Two-Stage verification with canonical location normalization.
    3. Merges any citizen-confirmed/manual categories (deduplicated, capped at max 3).
    4. Computes explainable 0–100 integer Priority Score.
    5. Persists structured complaint into Firestore database.
    """
    # Authentication guard — reject anonymous submissions
    _ANON_IDS = {"anon-user", "guest-citizen", "", None}
    if not payload.user_id or payload.user_id.strip() in _ANON_IDS:
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please sign in as a citizen before submitting a grievance."
        )

    logger.info(f"Received complaint from user {payload.user_id}: '{payload.text[:60]}...'")

    # 1. Reuse the citizen-reviewed /analyze result when available (avoids a second, slow
    #    Gemini round-trip). It is re-run through the deterministic validator so taxonomy,
    #    urgency promotion and location normalization are still enforced server-side.
    classification = None
    if payload.analysis:
        try:
            prior = dict(payload.analysis)
            prior["categories"] = prior.get("ai_categories") or prior.get("categories") or []
            classification = _two_stage_merge_and_validate(
                prior,
                payload.text,
                state_hint=payload.state,
                district_hint=payload.district
            )
        except Exception as e:
            logger.warning(f"Provided analysis failed validation ({type(e).__name__}); re-classifying.")
            classification = None

    if classification is None:
        classification = await classify_complaint_with_gemini(
            text=payload.text,
            state_hint=payload.state,
            district_hint=payload.district
        )

    ai_cats = list(classification.get("categories", ["roads"]))
    manual_cats = payload.manual_categories or []

    # If citizen passed confirmed_categories from review UI, respect them!
    if payload.confirmed_categories and len(payload.confirmed_categories) > 0:
        final_categories = payload.confirmed_categories[:3]
    else:
        merged_cats: List[str] = list(ai_cats)
        for mc in manual_cats:
            if mc and mc not in merged_cats:
                merged_cats.append(mc)
        final_categories = merged_cats[:3]

    # Ensure at least 1 category
    if not final_categories:
        final_categories = [ai_cats[0] if ai_cats else "roads"]

    # 2. Canonical jurisdiction resolution
    state = classification.get("state", payload.state or "unspecified")
    district = classification.get("district", payload.district or "unspecified")
    locality = classification.get("locality", payload.locality or "unspecified")
    location = classification.get("location", "unspecified")

    # 3. 0–100 Priority Score Calculation
    priority_score, priority_reason = calculate_priority_score(
        urgency=classification["urgency"],
        categories=final_categories,
        raw_text=payload.text,
        support_count=1
    )

    # 4. Assemble document payload
    complaint_data = {
        "raw_text": payload.text,
        "area_type": classification["area_type"],
        "categories": final_categories,
        "ai_categories": ai_cats,
        "manual_categories": manual_cats,
        "location": location,
        "state": state,
        "district": district,
        "locality": locality,
        "urgency": classification["urgency"],
        "priority_score": priority_score,
        "priority_reason": priority_reason,
        "summary": classification["summary"],
        "original_language": classification["original_language"],
        "user_id": payload.user_id,
        "support_count": 1,
        "high_priority": priority_score >= 75,
        "timestamp": time.time(),
        "status": "pending",
        "classified_by": classification.get("classified_by", "gemini")
    }

    # 5. Save to Firestore / local JSON storage
    created_doc = firestore_service.create_complaint(complaint_data)
    return created_doc


@router.get("", response_model=List[ComplaintResponse], summary="Get all complaints with optional filters")
async def list_complaints(
    area_type: Optional[str] = Query(None, description="Filter by 'rural' or 'urban'"),
    category: Optional[str] = Query(None, description="Filter by single category contained in categories array"),
    urgency: Optional[str] = Query(None, description="Filter by 'low', 'medium', or 'high'"),
    state: Optional[str] = Query(None, description="Filter by state name"),
    district: Optional[str] = Query(None, description="Filter by district name"),
    locality: Optional[str] = Query(None, description="Filter by locality name"),
    search: Optional[str] = Query(None, description="Search term in text, summary, location, or categories"),
    limit: int = Query(100, ge=1, le=500)
):
    """Retrieve complaints from Firestore with support for multi-faceted governance filters."""
    complaints = firestore_service.get_complaints(
        area_type=area_type,
        category=category,
        urgency=urgency,
        state=state,
        district=district,
        locality=locality,
        search=search,
        limit=limit
    )
    return complaints


@router.get("/citizen/my-issues", summary="Get all issues submitted by a specific citizen")
async def get_my_issues(user_id: str = Query(..., description="Authenticated citizen user ID")):
    """Return all complaints filed by this citizen, newest first."""
    if not user_id or user_id.strip() in ("anon-user", "guest-citizen", ""):
        raise HTTPException(status_code=401, detail="Authentication required to view your issues.")
    complaints = firestore_service.get_complaints_by_user(user_id.strip())
    return complaints


@router.get("/{complaint_id}", response_model=ComplaintResponse, summary="Get single complaint by ID")
async def get_complaint(complaint_id: str):
    doc = firestore_service.get_complaint_by_id(complaint_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return doc
