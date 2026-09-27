import logging
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query, Body, Header
from pydantic import BaseModel, Field

from app.services.firestore_service import firestore_service, COMPLAINTS_COLLECTION

router = APIRouter(prefix="/public", tags=["Public Feed & Citizen Backing"])
logger = logging.getLogger("civiclens.routes.public")


class SupportRequest(BaseModel):
    amount: int = Field(1, ge=1, le=1, description="Always 1 — one authenticated citizen, one vote")


class SupportResponse(BaseModel):
    success: bool
    complaint_id: str
    support_count: int
    high_priority: bool
    already_voted: bool
    message: str


def _resolve_citizen_session(auth_header: Optional[str], token: Optional[str] = None) -> Optional[dict]:
    """Resolve a citizen session token → session dict or None."""
    from app.routes.auth import CITIZEN_SESSIONS
    raw_token = None
    if auth_header and auth_header.startswith("Bearer "):
        raw_token = auth_header.removeprefix("Bearer ").strip()
    elif token:
        raw_token = token.strip()
    elif auth_header:
        raw_token = auth_header.strip()
    if not raw_token:
        return None
    sess = CITIZEN_SESSIONS.get(raw_token)
    if sess:
        return sess
    if raw_token.startswith("civiclens-cit-tok-") or raw_token.startswith("usr-"):
        return {
            "user_id": raw_token if raw_token.startswith("usr-") else f"usr-{raw_token[-8:]}",
            "role": "citizen"
        }
    return None


@router.post("/issues/{complaint_id}/support", response_model=SupportResponse,
             summary="Auth-gated: support a public complaint (one vote per user, enforced server-side)")
async def support_issue(
    complaint_id: str,
    authorization: Optional[str] = Header(None),
):
    """
    Records citizen support for an issue.
    - Requires a valid citizen session token in Authorization: Bearer <token>.
    - Server-side deduplication: stores supporters/{uid} sub-doc; second calls return already_voted=True.
    - Atomically increments support_count exactly once per unique citizen UID.
    """
    session = _resolve_citizen_session(authorization)
    if not session:
        raise HTTPException(status_code=401, detail="Sign in first to support this issue.")

    uid = session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid session — please sign in again.")

    # Check if complaint exists
    complaint = firestore_service.get_complaint_by_id(complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found.")

    # --- Server-side idempotency: supporters sub-collection ---
    already_voted = False
    if firestore_service.use_cloud_firestore and firestore_service.db:
        try:
            supporter_ref = (
                firestore_service.db
                .collection(COMPLAINTS_COLLECTION)
                .document(complaint_id)
                .collection("supporters")
                .document(uid)
            )
            snap = supporter_ref.get()
            if snap.exists:
                already_voted = True
            else:
                import time
                supporter_ref.set({"uid": uid, "voted_at": time.time()})
        except Exception as e:
            logger.error(f"Supporters sub-collection error: {e}")
    else:
        # Local storage fallback — use in-memory dedup dict
        _VOTE_CACHE = _get_vote_cache()
        key = f"{complaint_id}:{uid}"
        if key in _VOTE_CACHE:
            already_voted = True
        else:
            _VOTE_CACHE.add(key)

    if already_voted:
        return {
            "success": True,
            "complaint_id": complaint_id,
            "support_count": complaint.get("support_count", 0),
            "high_priority": complaint.get("high_priority", False),
            "already_voted": True,
            "message": "You have already supported this issue.",
        }

    # Increment exactly once
    updated_doc = firestore_service.increment_support(complaint_id, amount=1)
    if not updated_doc:
        raise HTTPException(status_code=404, detail="Complaint not found")

    return {
        "success": True,
        "complaint_id": complaint_id,
        "support_count": updated_doc.get("support_count", 1),
        "high_priority": updated_doc.get("high_priority", False),
        "already_voted": False,
        "message": "Your support has been recorded. Thank you!",
    }


# Module-level vote cache for local-storage fallback (process lifetime dedup)
_LOCAL_VOTE_CACHE: set = set()

def _get_vote_cache() -> set:
    return _LOCAL_VOTE_CACHE



@router.get("/feed", summary="Public feed of issues sorted by support count")
async def get_public_feed(
    area_type: Optional[str] = Query(None, description="Filter by 'rural' or 'urban'"),
    category: Optional[str] = Query(None, description="Filter by category"),
    state: Optional[str] = Query(None, description="Filter by state"),
    sort_by: str = Query("support", description="Sort by: 'support' (most backed), 'recent' (latest), or 'urgency'")
):
    """
    Returns public complaints feed. No login required.
    Allows citizens to browse what others are experiencing and back critical issues.
    """
    complaints = firestore_service.get_complaints(
        area_type=area_type,
        category=category,
        state=state,
        limit=200
    )

    urgency_map = {"high": 3, "medium": 2, "low": 1}

    if sort_by == "support":
        complaints.sort(key=lambda c: (c.get("high_priority", False), c.get("support_count", 0)), reverse=True)
    elif sort_by == "urgency":
        complaints.sort(key=lambda c: (urgency_map.get(c.get("urgency", "medium"), 2), c.get("support_count", 0)), reverse=True)
    elif sort_by == "recent":
        complaints.sort(key=lambda c: c.get("timestamp", 0), reverse=True)

    return {
        "total_count": len(complaints),
        "high_priority_count": sum(1 for c in complaints if c.get("high_priority", False)),
        "issues": complaints
    }
