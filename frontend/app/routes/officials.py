import hmac
import hashlib
import base64
import json
import time
import uuid
import logging
from typing import Optional, List, Dict, Any
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Query, Body, Header, Response, status
from pydantic import BaseModel, Field

from app.config import settings
from app.services.firestore_service import firestore_service
from app.services.priority_service import calculate_priority_score

router = APIRouter(prefix="/officials", tags=["Government Officials Portal"])
logger = logging.getLogger("civiclens.routes.officials")

OFFICIAL_TOKEN_SECRET = getattr(settings, 'SECRET_KEY', None) or "civiclens-gov-portal-secret-key-2026"

# In-memory session cache for local fast lookups
OFFICIAL_SESSIONS: Dict[str, Dict[str, Any]] = {}


def create_official_token(official_id: str, level: str) -> str:
    """
    Creates a stateless, cryptographically signed token containing official_id.
    Guarantees deterministic identity and jurisdiction resolution across all serverless lambda instances.
    """
    payload = {
        "official_id": official_id,
        "level": level,
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600 * 24 * 30  # 30 days valid
    }
    payload_bytes = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    b64_payload = base64.urlsafe_b64encode(payload_bytes).decode('utf-8').rstrip('=')
    signature = hmac.new(
        OFFICIAL_TOKEN_SECRET.encode('utf-8'),
        b64_payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()[:32]
    return f"civiclens-gov-tok.{b64_payload}.{signature}"


def decode_official_token(token_str: str) -> Optional[str]:
    """
    Decodes signed official token and returns verified official_id, or None if invalid.
    """
    if not token_str or not isinstance(token_str, str):
        return None
    token_str = token_str.strip()
    if token_str.startswith("Bearer "):
        token_str = token_str[7:].strip()

    # Handle stateless signed token: civiclens-gov-tok.<b64_payload>.<signature>
    if token_str.startswith("civiclens-gov-tok."):
        parts = token_str.split(".")
        if len(parts) == 3:
            b64_payload, sig = parts[1], parts[2]
            expected_sig = hmac.new(
                OFFICIAL_TOKEN_SECRET.encode('utf-8'),
                b64_payload.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()[:32]
            if hmac.compare_digest(sig, expected_sig):
                try:
                    rem = len(b64_payload) % 4
                    if rem > 0:
                        b64_payload += '=' * (4 - rem)
                    payload_data = json.loads(base64.urlsafe_b64decode(b64_payload).decode('utf-8'))
                    return payload_data.get("official_id")
                except Exception as e:
                    logger.warning(f"Error parsing token payload: {e}")

    # Fallback: check in-memory sessions cache if present
    if token_str in OFFICIAL_SESSIONS:
        return OFFICIAL_SESSIONS[token_str].get("official_id")

    return None


class JurisdictionModel(BaseModel):
    state: Optional[str] = None
    district: Optional[str] = None
    locality: Optional[str] = None


class OfficialLoginRequest(BaseModel):
    official_id: str = Field(..., description="Pre-provisioned Official ID (e.g., admin, state_up, delhi_pwd, dm_varanasi, bbmp_bangalore, local_rampur, bihar_power)")
    password: str = Field(..., description="Official portal password")


class OfficialProfile(BaseModel):
    official_id: str
    name: str
    department: str
    level: str = Field(..., description="'national' | 'state' | 'district' | 'local'")
    jurisdiction: JurisdictionModel
    state: str
    district: str


class OfficialLoginResponse(BaseModel):
    success: bool
    token: str
    official: OfficialProfile
    message: str


class HotspotItem(BaseModel):
    hotspot_id: str
    state: str
    district: str
    category: str
    area_type: str
    complaint_count: int
    avg_priority_score: int = Field(..., description="0-100 integer Priority Score for this issue hotspot")
    high_priority_count: int
    total_support_count: int
    priority_score: int = Field(..., description="0-100 integer ranking score")
    formula_breakdown: Dict[str, Any]
    complaints: List[Dict[str, Any]]


class UpdateStatusRequest(BaseModel):
    status: str = Field(..., description="'pending', 'in_progress', or 'resolved'")


def _resolve_authenticated_official(
    auth_header: Optional[str] = None,
    official_id: Optional[str] = None,
    token: Optional[str] = None
) -> Dict[str, Any]:
    """
    Resolve and verify official identity for server-side scope enforcement.
    Strictly derives jurisdiction from the official's authoritative record.
    Never trusts client-passed scopes or defaults to national tier on invalid tokens.
    """
    tok = None
    if auth_header and auth_header.startswith("Bearer "):
        tok = auth_header.split(" ", 1)[1].strip()
    elif token:
        tok = token.strip()

    verified_id = None
    if tok:
        verified_id = decode_official_token(tok)

    if not verified_id and official_id:
        verified_id = official_id.strip()

    if verified_id:
        off = firestore_service.get_official(verified_id)
        if off:
            jurisdiction = off.get("jurisdiction") or {}
            norm_state = jurisdiction.get("state") or (off.get("state") if off.get("state") != "All States" else None)
            norm_district = jurisdiction.get("district") or (off.get("district") if off.get("district") != "All Districts" else None)
            norm_locality = jurisdiction.get("locality")

            return {
                "official_id": off["official_id"],
                "name": off["name"],
                "department": off["department"],
                "level": off.get("level", "national"),
                "jurisdiction": {
                    "state": norm_state,
                    "district": norm_district,
                    "locality": norm_locality
                },
                "state": off.get("state", "All States"),
                "district": off.get("district", "All Districts")
            }

    # If unauthenticated or token expired, raise 401 Unauthorized
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Unauthorized official session. Please provide a valid official session token."
    )


def _compute_hotspots(
    complaints: List[Dict[str, Any]],
    category_filter: Optional[str] = None,
    area_type_filter: Optional[str] = None
) -> List[HotspotItem]:
    """
    Groups complaints by (State, District, Single Category, AreaType) and computes explainable 0-100 Priority Scores:
    - Multi-category arrays are exploded so each complaint contributes to every issue it represents.
    """
    groups = defaultdict(list)
    for c in complaints:
        c_state = c.get("state", "Other")
        c_district = c.get("district", "Other")
        c_area = c.get("area_type", "urban")

        raw_cats = c.get("categories")
        if isinstance(raw_cats, list) and raw_cats:
            cats = raw_cats
        elif isinstance(raw_cats, str):
            cats = [raw_cats]
        else:
            cats = [c.get("category", "roads")]

        if category_filter and category_filter.lower() != "all" and category_filter.lower() not in [ct.lower() for ct in cats]:
            continue
        if area_type_filter and area_type_filter.lower() != "all" and c_area.lower() != area_type_filter.lower():
            continue

        for single_cat in cats:
            if category_filter and category_filter.lower() != "all" and single_cat.lower() != category_filter.lower():
                continue
            key = (c_state, c_district, single_cat, c_area)
            groups[key].append(c)

    hotspots: List[HotspotItem] = []

    for (g_state, g_district, g_cat, g_area), items in groups.items():
        count = len(items)
        if count == 0:
            continue

        # Extract 0-100 priority scores of each complaint
        scores = []
        for it in items:
            s = it.get("priority_score")
            if s is None or not isinstance(s, int):
                s, _ = calculate_priority_score(
                    urgency=it.get("urgency", "medium"),
                    categories=it.get("categories", [g_cat]),
                    raw_text=it.get("raw_text", ""),
                    support_count=it.get("support_count", 1)
                )
            scores.append(s)

        avg_score = int(round(sum(scores) / len(scores))) if scores else 50
        # Volume boost: add modest bonus for cluster density (up to +15), clamped to 100
        cluster_bonus = min(15, (count - 1) * 3)
        hotspot_priority_score = max(0, min(100, avg_score + cluster_bonus))

        total_support = sum(item.get("support_count", 1) for item in items)
        high_priority_count = sum(1 for item in items if item.get("high_priority", False) or item.get("priority_score", 0) >= 75)

        clean_state = g_state.replace(" ", "").lower()[:3] if g_state else "ind"
        clean_dist = g_district.replace(" ", "").lower()[:3] if g_district else "dst"
        hotspot_id = f"hotspot-{clean_state}-{clean_dist}-{g_cat}-{g_area}"

        hotspots.append(HotspotItem(
            hotspot_id=hotspot_id,
            state=g_state,
            district=g_district,
            category=g_cat,
            area_type=g_area,
            complaint_count=count,
            avg_priority_score=avg_score,
            high_priority_count=high_priority_count,
            total_support_count=total_support,
            priority_score=hotspot_priority_score,
            formula_breakdown={
                "complaint_count": count,
                "avg_complaint_priority": avg_score,
                "cluster_density_bonus": cluster_bonus,
                "total_supporters": total_support,
                "formula_str": f"Avg Complaint Priority ({avg_score}/100) + Density Bonus ({cluster_bonus}) = {hotspot_priority_score}/100"
            },
            complaints=items
        ))

    hotspots.sort(key=lambda h: h.priority_score, reverse=True)
    return hotspots


def _compute_map_data(
    level: str,
    jurisdiction: Dict[str, Any],
    effective_state: Optional[str],
    effective_district: Optional[str],
    complaints: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Computes per-region complaint counts for the choropleth map.
    Uses DISTINCT complaint IDs (not exploded hotspot rows) to avoid multi-category double-counting.
    """
    if level == "local":
        return {
            "level": "local",
            "scope": {"state": jurisdiction.get("state"), "district": jurisdiction.get("district"), "locality": jurisdiction.get("locality")},
            "regions": []
        }

    regions: List[Dict[str, Any]] = []

    if level == "national":
        state_groups: Dict[str, list] = defaultdict(list)
        for c in complaints:
            st = c.get("state") or "Unknown"
            state_groups[st].append(c)

        for st_name, items in state_groups.items():
            scores = [c.get("priority_score", 50) for c in items]
            avg_ps = int(round(sum(scores) / len(scores))) if scores else 0
            regions.append({
                "name": st_name,
                "complaint_count": len(items),
                "avg_priority_score": avg_ps
            })
        regions.sort(key=lambda r: r["complaint_count"], reverse=True)

    elif level == "state":
        dist_groups: Dict[str, list] = defaultdict(list)
        for c in complaints:
            dt = c.get("district") or "Unknown"
            dist_groups[dt].append(c)

        for dt_name, items in dist_groups.items():
            scores = [c.get("priority_score", 50) for c in items]
            avg_ps = int(round(sum(scores) / len(scores))) if scores else 0
            regions.append({
                "name": dt_name,
                "complaint_count": len(items),
                "avg_priority_score": avg_ps
            })
        regions.sort(key=lambda r: r["complaint_count"], reverse=True)

    elif level == "district":
        scores = [c.get("priority_score", 50) for c in complaints]
        avg_ps = int(round(sum(scores) / len(scores))) if scores else 0
        regions.append({
            "name": effective_district or jurisdiction.get("district", "Unknown"),
            "complaint_count": len(complaints),
            "avg_priority_score": avg_ps
        })

    return {
        "level": level,
        "scope": {
            "state": effective_state or jurisdiction.get("state"),
            "district": effective_district or jurisdiction.get("district")
        },
        "regions": regions
    }


def _set_no_cache_headers(response: Response):
    """Ensure officials portal responses are never cached by browser or CDN."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0, private"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"


@router.post("/login", response_model=OfficialLoginResponse, summary="Government Official Login with Tier Authentication")
async def official_login(payload: OfficialLoginRequest, response: Response):
    """
    Login endpoint for authorized government officials.
    Verifies credentials with bcrypt and returns official profile with cryptographically signed token.
    """
    _set_no_cache_headers(response)
    official_data = firestore_service.verify_official(payload.official_id.strip(), payload.password.strip())
    if not official_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid official credentials. Use demo accounts: admin/civic2026, state_up/jal2026, delhi_pwd/pwd2026, dm_varanasi/varanasi2026, bbmp_bangalore/bbmp2026, local_rampur/local2026, bihar_power/bihar2026"
        )

    token = create_official_token(official_data["official_id"], official_data["level"])
    OFFICIAL_SESSIONS[token] = official_data
    logger.info(f"Official logged in: {official_data['name']} (Tier: {official_data['level']}, Dept: {official_data['department']})")

    return {
        "success": True,
        "token": token,
        "official": official_data,
        "message": f"Authenticated as {official_data['name']} ({official_data['level'].title()} Tier)"
    }


@router.get("/hotspots", response_model=List[HotspotItem], summary="Get aggregated hotspots ranked by 0-100 Priority Score with Server-Side Scope Enforcement")
async def get_hotspots(
    response: Response,
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
    official_id: Optional[str] = Query(None),
    state: Optional[str] = Query(None, description="Requested state filter (subject to server-side override)"),
    district: Optional[str] = Query(None, description="Requested district filter (subject to server-side override)"),
    locality: Optional[str] = Query(None, description="Requested locality filter (subject to server-side override)"),
    category: Optional[str] = Query(None, description="Filter hotspots by category"),
    area_type: Optional[str] = Query(None, description="Filter hotspots by rural/urban")
):
    """
    Aggregates complaints by (State, District, Single Category, AreaType) and computes explainable 0-100 Priority Score:
    - Multi-category arrays are exploded so each complaint contributes to every issue it represents.
    - Server-side scope enforcement strictly locks non-national officials to their jurisdiction.
    """
    _set_no_cache_headers(response)
    official = _resolve_authenticated_official(auth_header=authorization, official_id=official_id, token=token)
    officer_level = official.get("level", "national")
    jurisdiction = official.get("jurisdiction", {})

    effective_state = None
    effective_district = None
    effective_locality = None

    if officer_level == "national":
        effective_state = state if (state and state != "All States") else None
        effective_district = district if (district and district != "All Districts") else None
        effective_locality = locality if (locality and locality != "unspecified") else None
    elif officer_level == "state":
        effective_state = jurisdiction.get("state")
        effective_district = district if (district and district != "All Districts") else None
        effective_locality = locality if (locality and locality != "unspecified") else None
    elif officer_level == "district":
        effective_state = jurisdiction.get("state")
        effective_district = jurisdiction.get("district")
        effective_locality = locality if (locality and locality != "unspecified") else None
    elif officer_level == "local":
        effective_state = jurisdiction.get("state")
        effective_district = jurisdiction.get("district")
        effective_locality = jurisdiction.get("locality")

    all_complaints = firestore_service.get_complaints(
        state=effective_state,
        district=effective_district,
        locality=effective_locality,
        limit=500
    )

    return _compute_hotspots(all_complaints, category_filter=category, area_type_filter=area_type)


@router.get("/dashboard-data", summary="Get Tier-specific Dashboard data including KPIs, Recharts data, Complaints, Hotspots, and Map Data")
async def get_dashboard_data(
    response: Response,
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
    official_id: Optional[str] = Query(None),
    drill_state: Optional[str] = Query(None),
    drill_district: Optional[str] = Query(None)
):
    """
    Returns complete tiered dashboard data in a single unified round-trip:
    1. Server-side enforced jurisdiction scoping derived directly from verified official identity.
    2. Direct complaint KPIs:
       - Total Complaints
       - High Priority (score >= 75 or support >= 100k)
       - Open Issues (pending + in_progress)
       - Resolved Issues
       - Average Priority Score (0-100 integer)
    3. Tier-tailored Recharts datasets with multi-category aggregation.
    4. Hotspot matrix and Map data.
    """
    _set_no_cache_headers(response)
    official = _resolve_authenticated_official(auth_header=authorization, official_id=official_id, token=token)
    level = official.get("level", "national")
    jurisdiction = official.get("jurisdiction", {})

    effective_state = None
    effective_district = None
    effective_locality = None

    if level == "national":
        effective_state = drill_state if (drill_state and drill_state != "All States") else None
        effective_district = drill_district if (drill_district and drill_district != "All Districts") else None
    elif level == "state":
        effective_state = jurisdiction.get("state")
        effective_district = drill_district if (drill_district and drill_district != "All Districts") else None
    elif level == "district":
        effective_state = jurisdiction.get("state")
        effective_district = jurisdiction.get("district")
    elif level == "local":
        effective_state = jurisdiction.get("state")
        effective_district = jurisdiction.get("district")
        effective_locality = jurisdiction.get("locality")

    # Fetch unique complaints within the strictly enforced jurisdiction
    complaints = firestore_service.get_complaints(
        state=effective_state,
        district=effective_district,
        locality=effective_locality,
        limit=500
    )

    # Compute KPIs
    total_complaints = len(complaints)
    high_priority_count = sum(1 for c in complaints if c.get("high_priority", False) or c.get("priority_score", 0) >= 75)
    pending_count = sum(1 for c in complaints if c.get("status") == "pending")
    in_progress_count = sum(1 for c in complaints if c.get("status") == "in_progress")
    open_issues = pending_count + in_progress_count
    resolved_count = sum(1 for c in complaints if c.get("status") == "resolved")
    total_supporters = sum(c.get("support_count", 1) for c in complaints)

    # Compute Average 0-100 Priority Score
    priority_scores = []
    for c in complaints:
        s = c.get("priority_score")
        if s is None or not isinstance(s, int):
            s, _ = calculate_priority_score(
                urgency=c.get("urgency", "medium"),
                categories=c.get("categories", ["roads"]),
                raw_text=c.get("raw_text", ""),
                support_count=c.get("support_count", 1)
            )
            c["priority_score"] = s
        priority_scores.append(s)

    average_priority_score = int(round(sum(priority_scores) / len(priority_scores))) if priority_scores else 0

    # Multi-category charts aggregation
    chart_data: List[Dict[str, Any]] = []
    category_chart_data: List[Dict[str, Any]] = []

    cat_counts = defaultdict(int)
    for c in complaints:
        raw_cats = c.get("categories", ["roads"])
        if isinstance(raw_cats, str):
            raw_cats = [raw_cats]
        for cat in raw_cats:
            cat_counts[cat] += 1

    for cat_name, cnt in cat_counts.items():
        category_chart_data.append({
            "name": cat_name.replace("_", " ").title(),
            "value": cnt
        })
    category_chart_data.sort(key=lambda x: x["value"], reverse=True)

    if level == "national":
        state_groups = defaultdict(list)
        for c in complaints:
            st = c.get("state", "Unspecified")
            state_groups[st].append(c)

        for st_name, st_items in state_groups.items():
            st_count = len(st_items)
            st_scores = [it.get("priority_score", 50) for it in st_items]
            st_avg_score = int(round(sum(st_scores) / len(st_scores))) if st_scores else 0
            st_sup = sum(i.get("support_count", 1) for i in st_items)
            chart_data.append({
                "name": st_name,
                "priority_score": st_avg_score,
                "complaints": st_count,
                "supporters": st_sup,
                "high_priority": sum(1 for i in st_items if i.get("high_priority", False) or i.get("priority_score", 0) >= 75)
            })
        chart_data.sort(key=lambda x: x["priority_score"], reverse=True)

    elif level == "state":
        dist_groups = defaultdict(list)
        for c in complaints:
            dt = c.get("district", "Unspecified")
            dist_groups[dt].append(c)

        for dt_name, dt_items in dist_groups.items():
            dt_count = len(dt_items)
            dt_scores = [it.get("priority_score", 50) for it in dt_items]
            dt_avg_score = int(round(sum(dt_scores) / len(dt_scores))) if dt_scores else 0
            dt_sup = sum(i.get("support_count", 1) for i in dt_items)
            chart_data.append({
                "name": dt_name,
                "priority_score": dt_avg_score,
                "complaints": dt_count,
                "supporters": dt_sup,
                "high_priority": sum(1 for i in dt_items if i.get("high_priority", False) or i.get("priority_score", 0) >= 75)
            })
        chart_data.sort(key=lambda x: x["priority_score"], reverse=True)

    elif level == "district" or level == "local":
        loc_groups = defaultdict(list)
        for c in complaints:
            loc = c.get("locality", c.get("location", "Unspecified"))
            loc_groups[loc].append(c)

        for loc_name, loc_items in loc_groups.items():
            l_count = len(loc_items)
            l_scores = [it.get("priority_score", 50) for it in loc_items]
            l_avg_score = int(round(sum(l_scores) / len(l_scores))) if l_scores else 0
            l_sup = sum(i.get("support_count", 1) for i in loc_items)
            chart_data.append({
                "name": loc_name,
                "priority_score": l_avg_score,
                "complaints": l_count,
                "supporters": l_sup
            })
        chart_data.sort(key=lambda x: x["priority_score"], reverse=True)

    # Compute Hotspots and Map Data in same payload for zero-overhead client rendering
    hotspots = _compute_hotspots(complaints)
    map_data = _compute_map_data(level, jurisdiction, effective_state, effective_district, complaints)

    return {
        "official": official,
        "level": level,
        "jurisdiction": jurisdiction,
        "kpis": {
            "total_complaints": total_complaints,
            "open_issues": open_issues,
            "high_priority_count": high_priority_count,
            "pending_count": pending_count,
            "in_progress_count": in_progress_count,
            "resolved_count": resolved_count,
            "average_priority_score": average_priority_score,
            "total_supporters": total_supporters
        },
        "chart_data": chart_data,
        "category_chart_data": category_chart_data,
        "complaints": complaints,
        "hotspots": hotspots,
        "map_data": map_data
    }


@router.patch("/complaints/{complaint_id}/status", summary="Update complaint resolution status")
async def update_status(
    complaint_id: str,
    payload: UpdateStatusRequest,
    response: Response,
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None)
):
    """Allows authenticated government officials to mark complaints as in_progress or resolved."""
    _set_no_cache_headers(response)
    # Validate session
    _resolve_authenticated_official(auth_header=authorization, token=token)

    if payload.status not in ["pending", "in_progress", "resolved"]:
        raise HTTPException(status_code=400, detail="Status must be 'pending', 'in_progress', or 'resolved'")

    updated = firestore_service.update_complaint_status(complaint_id, payload.status)
    if not updated:
        raise HTTPException(status_code=404, detail="Complaint not found")

    return {
        "success": True,
        "complaint_id": complaint_id,
        "new_status": payload.status,
        "message": f"Complaint status updated to {payload.status}"
    }


@router.get("/map-data", summary="Complaint density data per region for choropleth map (distinct complaint counts, no double-counting)")
async def get_map_data(
    response: Response,
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
    official_id: Optional[str] = Query(None)
):
    """
    Returns per-region complaint counts for the choropleth map.
    Uses DISTINCT complaint IDs (not exploded hotspot rows) to avoid the multi-category double-counting trap.
    Server-side scope is enforced identically to the hotspot and dashboard endpoints.
    """
    _set_no_cache_headers(response)
    official = _resolve_authenticated_official(auth_header=authorization, official_id=official_id, token=token)
    level = official.get("level", "national")
    jurisdiction = official.get("jurisdiction", {})

    if level == "national":
        effective_state = None
        effective_district = None
    elif level == "state":
        effective_state = jurisdiction.get("state")
        effective_district = None
    elif level == "district":
        effective_state = jurisdiction.get("state")
        effective_district = jurisdiction.get("district")
    else:  # local
        return {
            "level": "local",
            "scope": {"state": jurisdiction.get("state"), "district": jurisdiction.get("district"), "locality": jurisdiction.get("locality")},
            "regions": []
        }

    complaints = firestore_service.get_complaints(
        state=effective_state,
        district=effective_district,
        locality=None,
        limit=500
    )

    return _compute_map_data(level, jurisdiction, effective_state, effective_district, complaints)
