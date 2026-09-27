import json
import re
import logging
from typing import Dict, Any, List, Optional, Literal, Tuple
from pydantic import BaseModel, Field, ValidationError

from app.config import settings
from app.services.location_service import normalize_location
from app.services.priority_service import calculate_priority_score

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("civiclens.gemini")

# Valid category taxonomies strictly adhering to rural vs urban civic governance in India
RURAL_CATEGORIES: List[str] = [
    "roads",
    "electricity",
    "irrigation_water",
    "healthcare_access",
    "network_coverage"
]

URBAN_CATEGORIES: List[str] = [
    "roads",
    "electricity",
    "water_shortage",
    "pollution",
    "traffic",
    "infra_quality",
    "road_expansion"
]

ALL_VALID_CATEGORIES = list(set(RURAL_CATEGORIES + URBAN_CATEGORIES))

# Runtime observability state for /api/health
_runtime_gemini_state: Dict[str, Any] = {
    "configured": bool(settings.GEMINI_API_KEY),
    "reachable": False,
    "model": settings.GEMINI_MODEL,
    "last_used": None,
    "last_error": None,
    "total_classifications": 0,
    "gemini_success_count": 0,
    "fallback_count": 0
}


def get_gemini_runtime_status() -> Dict[str, Any]:
    """Returns runtime observability status for health checks."""
    return dict(_runtime_gemini_state)


def set_gemini_reachability(reachable: bool, message: Optional[str] = None):
    """Updates reachability status during startup probe or runtime."""
    _runtime_gemini_state["reachable"] = reachable
    _runtime_gemini_state["configured"] = bool(settings.GEMINI_API_KEY)
    _runtime_gemini_state["model"] = settings.GEMINI_MODEL
    if message:
        _runtime_gemini_state["last_error"] = None if reachable else message


class GeminiClassificationSchema(BaseModel):
    """Pydantic model for Gemini structured JSON output."""
    area_type: Literal["rural", "urban"] = Field(
        ...,
        description="'rural' for gaon/fields/panchayat/irrigation, 'urban' for city/ward/traffic/municipal areas"
    )
    categories: List[str] = Field(
        ...,
        description="1 to 3 distinct categories representing ALL clearly supported civic problems described"
    )
    location: Optional[str] = Field(
        "unspecified",
        description="Place, village, ward, city, or landmark explicitly mentioned, or 'unspecified'"
    )
    state: Optional[str] = Field(
        "unspecified",
        description="Indian state name mentioned, or 'unspecified'"
    )
    district: Optional[str] = Field(
        "unspecified",
        description="District or city name mentioned, or 'unspecified'"
    )
    locality: Optional[str] = Field(
        "unspecified",
        description="Village name, ward number, neighborhood, or 'unspecified'"
    )
    urgency: Literal["low", "medium", "high"] = Field(
        ...,
        description="'high' for immediate hazards or critical disruption, 'medium' for persistent disruption, 'low' for minor repair"
    )
    summary: str = Field(
        ...,
        description="One-sentence clear factual English summary"
    )
    original_language: Optional[str] = Field(
        "English",
        description="Detected language of the citizen complaint"
    )


class ClassificationResult(BaseModel):
    """Pydantic model for final validated classification response with 0–100 Priority Score."""
    area_type: Literal["rural", "urban"]
    categories: List[str] = Field(..., min_length=1, max_length=3)
    location: str = "unspecified"
    state: str = "unspecified"
    district: str = "unspecified"
    locality: str = "unspecified"
    urgency: Literal["low", "medium", "high"] = "medium"
    priority_score: int = Field(..., ge=0, le=100, description="0-100 integer governance priority score")
    priority_reason: str = Field(..., description="Explainable reason string for priority score")
    summary: str
    original_language: str = "English"
    classified_by: Literal["gemini", "heuristic_fallback"] = "gemini"


SYSTEM_PROMPT = """You are CivicLens AI, an expert civic infrastructure classifier and governance assistant for India.
Your task is to analyze civic complaints submitted by citizens across India in English, Hindi, Hinglish, Urdu, Gujarati, Assamese, Bhojpuri, Malayalam, Tamil, Telugu, Kannada, Bengali, Marathi, or any Indian regional language.

MULTI-LABEL CLASSIFICATION RULES:
1. Treat every complaint as a multi-label classification problem. Identify and return 1 to 3 categories representing ALL distinct civic problems described.
   - Do NOT return only the single dominant category when multiple issues are present.
   - Example: A complaint mentioning crater potholes causing traffic congestion must return BOTH ["roads", "traffic"].
   - Example: A rural complaint mentioning a broken road and no doctor at the PHC must return BOTH ["roads", "healthcare_access"].
   - Example: A complaint mentioning garbage dumps and tap water shortage must return BOTH ["pollution", "water_shortage"].
   - Example: A rural complaint mentioning transformer failure and crop drying must return BOTH ["electricity", "irrigation_water"].

2. area_type must be either "rural" or "urban":
   - "rural": Gaon, khet, canal, irrigation, panchayat, tube well, agricultural setting, village PHC.
   - "urban": City, municipal ward, traffic signals, flyovers, metro, apartments, commercial areas.

3. categories taxonomy:
   - Valid Rural Categories: ["roads", "electricity", "irrigation_water", "healthcare_access", "network_coverage"]
   - Valid Urban Categories: ["roads", "electricity", "water_shortage", "pollution", "traffic", "infra_quality", "road_expansion"]
   - All returned categories MUST come strictly from the valid set matching area_type. Never mix rural and urban categories on the same complaint.
   - Cap at maximum 3 categories. Do not duplicate or fragment a single issue into synonyms.

4. urgency:
   - "high": Immediate hazard, life/health risk (collapsed bridge, electric spark, hospital without doctor, toxic drain, severe flood, accident risk, danger to two-wheelers).
   - "medium": Persistent daily disruption (power cuts for hours, major potholes, gridlock, dry canal during sowing, garbage accumulating).
   - "low": Minor maintenance, slow repair, aesthetic request without safety risk.

5. location, state, district & locality:
   - Extract only geography explicitly supported by the text. Never hallucinate locations. If unknown, return "unspecified".

6. summary: Write a concise 1-sentence factual English summary.
7. original_language: State detected input language (e.g. English, Hindi, Hinglish, Urdu, Gujarati, Assamese, Bhojpuri, Malayalam, Tamil, Telugu, Kannada, Bengali, Marathi, etc.)."""


def _matches_any_keyword(text_lower: str, keywords: List[str]) -> bool:
    """Matches keywords with boundary awareness for short terms to prevent substring collisions."""
    for kw in keywords:
        if len(kw) <= 5 or " " in kw:
            pattern = r'(?<![a-zA-Z])' + re.escape(kw) + r'(?![a-zA-Z])'
            if re.search(pattern, text_lower):
                return True
        else:
            if kw in text_lower:
                return True
    return False


def detect_explicit_categories(text: str, area_type: str) -> List[str]:
    """
    Stage 2 Deterministic Multi-Label Scanner:
    Inspects raw complaint text (multilingual keywords and phrase patterns) to detect
    all explicitly supported categories for the given area_type.
    """
    lower = text.lower()
    found: List[str] = []

    if area_type == "rural":
        # roads
        rural_roads_kw = [
            "road", "sadak", "pothole", "potholes", "gaddha", "bridge", "pul", "rasta",
            "village path", "kharanja", "culvert", "broken road", "tuta road",
            "gali", "mud road", "kachha rasta", "pavement"
        ]
        if _matches_any_keyword(lower, rural_roads_kw):
            found.append("roads")

        # electricity
        rural_elec_kw = [
            "bijli", "light", "power", "transformer", "electricity", "voltage",
            "current", "pole", "wire", "blackout", "load shedding", "khamba",
            "taar", "power cut", "short circuit", "spark", "fuse"
        ]
        if _matches_any_keyword(lower, rural_elec_kw):
            found.append("electricity")

        # irrigation_water
        rural_water_kw = [
            "pani", "water", "nehar", "canal", "irrigation", "tubewell", "tube well",
            "borewell", "pump", "khet", "sichai", "fasal", "crop", "crops",
            "drought", "sukha", "suk rahi", "fields", "panni"
        ]
        if _matches_any_keyword(lower, rural_water_kw):
            found.append("irrigation_water")

        # healthcare_access
        rural_health_kw = [
            "hospital", "doctor", "dispensary", "aspatal", "medicine", "dawa",
            "davai", "phc", "chc", "nurse", "health", "anti-venom", "patient",
            "medical", "clinic", "swasthya", "health centre", "health center",
            "health facility", "ambulance", "vaccine", "treatment"
        ]
        if _matches_any_keyword(lower, rural_health_kw):
            found.append("healthcare_access")

        # network_coverage
        rural_net_kw = [
            "network", "tower", "signal", "mobile", "internet", "range",
            "connectivity", "4g", "5g", "sim", "upi", "broadband", "call drop",
            "no signal", "wifi"
        ]
        if _matches_any_keyword(lower, rural_net_kw):
            found.append("network_coverage")

    else:
        # Urban roads
        urban_roads_kw = [
            "road", "sadak", "pothole", "potholes", "gaddha", "crater", "craters", "bridge", "pul",
            "rasta", "pavement", "asphalt", "tar", "footpath", "manhole",
            "street damage", "damaged street", "highway", "crater-like"
        ]
        if _matches_any_keyword(lower, urban_roads_kw):
            found.append("roads")

        # Urban traffic
        urban_traffic_kw = [
            "traffic", "jam", "jams", "signal", "choke", "flyover", "gridlock",
            "congestion", "red light", "accident", "two-wheeler", "two-wheelers",
            "commute", "commuters", "bottleneck", "silk board", "vehicle", "crawl"
        ]
        if _matches_any_keyword(lower, urban_traffic_kw):
            found.append("traffic")

        # Urban water_shortage
        urban_water_kw = [
            "water", "pani", "paani", "tanker", "tankers", "shortage", "pipeline",
            "tap", "jal", "drinking water", "supply", "leakage", "dry tap",
            "no water", "water cut", "low pressure", "pipe burst"
        ]
        if _matches_any_keyword(lower, urban_water_kw):
            found.append("water_shortage")

        # Urban pollution
        urban_pollution_kw = [
            "pollution", "air", "garbage", "kachra", "waste", "trash", "smell",
            "drain", "sewer", "stench", "smoke", "effluent", "gutter", "dumps",
            "dump", "dumping", "toxic", "aqi", "smog", "dust", "burning"
        ]
        if _matches_any_keyword(lower, urban_pollution_kw):
            found.append("pollution")

        # Urban electricity
        urban_elec_kw = [
            "bijli", "light", "lights", "power", "transformer", "electricity", "voltage",
            "current", "load", "blackout", "blackouts", "streetlight", "streetlights",
            "street light", "street lights", "wire", "wires", "pole", "poles",
            "power cut", "power failure", "short circuit", "outage", "outages", "darkness", "andhera"
        ]
        if _matches_any_keyword(lower, urban_elec_kw):
            found.append("electricity")

        # Urban infra_quality
        urban_infra_kw = [
            "construction quality", "sub-standard", "substandard", "flyover crack", "building crack",
            "dilapidated building", "footover bridge crack", "structural defect", "collapsed wall",
            "pillar crack", "bad quality construction", "poor construction", "inferior material", "civil work quality"
        ]
        if _matches_any_keyword(lower, urban_infra_kw):
            found.append("infra_quality")

        # Urban road_expansion
        urban_expansion_kw = [
            "expansion", "widening", "chauraha", "bottleneck", "encroachment",
            "lane widening", "widen", "expand road", "road expansion", "narrow road", "expressway"
        ]
        if _matches_any_keyword(lower, urban_expansion_kw):
            found.append("road_expansion")

    valid_set = RURAL_CATEGORIES if area_type == "rural" else URBAN_CATEGORIES
    result: List[str] = []
    for f in found:
        if f in valid_set and f not in result:
            result.append(f)
    return result


def _normalize_single_cat(cat_str: str, area_type: str) -> Optional[str]:
    """Map arbitrary category string or synonym to a valid taxonomy category."""
    if not cat_str or not isinstance(cat_str, str):
        return None

    c = cat_str.strip().lower().replace(" ", "_").replace("-", "_")
    valid_set = RURAL_CATEGORIES if area_type == "rural" else URBAN_CATEGORIES
    if c in valid_set:
        return c

    # Keyword fallback mapping
    if any(k in c for k in ["road", "pothole", "highway", "sadak", "gaddha", "bridge", "pul", "crater"]):
        return "roads"
    if any(k in c for k in ["power", "light", "bijli", "transformer", "electricity", "voltage", "current", "outage"]):
        return "electricity"
    if any(k in c for k in ["water", "pani", "canal", "nehar", "irrigation", "tubewell", "khet", "sichai", "fasal"]):
        return "irrigation_water" if area_type == "rural" else "water_shortage"
    if any(k in c for k in ["hospital", "health", "doctor", "dispensary", "aspatal", "medicine", "dawa", "phc", "chc"]):
        return "healthcare_access" if area_type == "rural" else "infra_quality"
    if any(k in c for k in ["network", "tower", "signal", "mobile", "internet", "range", "connectivity"]):
        return "network_coverage" if area_type == "rural" else "infra_quality"
    if area_type == "urban":
        if any(k in c for k in ["traffic", "jam", "signal", "flyover", "choke", "congestion", "gridlock"]):
            return "traffic"
        if any(k in c for k in ["pollution", "air", "garbage", "kachra", "waste", "trash", "smell", "drain", "sewer", "dump"]):
            return "pollution"
        if any(k in c for k in ["expansion", "widening", "chauraha", "bottleneck", "encroachment"]):
            return "road_expansion"
        if any(k in c for k in ["infra", "quality", "building", "construction", "crack", "structural"]):
            return "infra_quality"

    return None


def _two_stage_merge_and_validate(
    raw_data: Dict[str, Any],
    raw_text: str,
    state_hint: Optional[str] = None,
    district_hint: Optional[str] = None
) -> Dict[str, Any]:
    """
    Two-Stage Multi-Label Classification & Validation Engine:
    Stage 1: Normalize LLM returned taxonomy.
    Stage 2: Deterministic scan on raw text for explicit evidence, merging missing categories.
    Location Normalization: Canonical jurisdiction resolution (prevents hallucinations).
    Priority Score: Generates an explainable 0–100 integer priority score.
    """
    # 1. Normalize area_type
    area_type = str(raw_data.get("area_type", "urban")).strip().lower()
    if area_type not in ["rural", "urban"]:
        lower = raw_text.lower()
        rural_kw = [
            "gaon", "gram panchayat", "gram pradhan", "gramin", "panchayat", "pradhan",
            "khet", "fasal", "kisan", "tubewell", "nehar", "phc", "village"
        ]
        area_type = "rural" if _matches_any_keyword(lower, rural_kw) else "urban"

    valid_categories = RURAL_CATEGORIES if area_type == "rural" else URBAN_CATEGORIES

    # 2. Parse and normalize LLM predicted categories
    raw_cats = raw_data.get("categories")
    if isinstance(raw_cats, str):
        raw_cats = [raw_cats]
    elif not isinstance(raw_cats, list):
        single_cat = raw_data.get("category")
        raw_cats = [single_cat] if single_cat else []

    cleaned_llm_cats: List[str] = []
    for rc in raw_cats:
        mapped = _normalize_single_cat(str(rc), area_type)
        if mapped and mapped in valid_categories and mapped not in cleaned_llm_cats:
            cleaned_llm_cats.append(mapped)

    # 3. Stage 2 Deterministic Inspection: Detect explicitly supported categories from text
    explicit_text_cats = detect_explicit_categories(raw_text, area_type)

    # 4. Merge Stage 1 + Stage 2 categories without duplicating
    merged_categories: List[str] = list(cleaned_llm_cats)
    for ext_cat in explicit_text_cats:
        if ext_cat in valid_categories and ext_cat not in merged_categories:
            merged_categories.append(ext_cat)

    # If completely empty, fall back to first valid category in taxonomy
    if not merged_categories:
        merged_categories = [valid_categories[0]]

    # Strict Cap at 3 categories
    final_categories = merged_categories[:3]

    # 5. Normalize Urgency
    urgency = str(raw_data.get("urgency", "medium")).strip().lower()
    if urgency not in ["low", "medium", "high"]:
        urgency = "medium"

    # Promote urgency to high if severe keywords present in text
    lower_text = raw_text.lower()
    if any(k in lower_text for k in [
        "hazard", "danger", "dangerous", "accident", "accidents", "spark",
        "emergency", "death", "die", "collapsed", "toxic", "khatra", "no doctor",
        "3 hafte", "two months", "2 months", "crater"
    ]):
        urgency = "high"

    # 6. Canonical Location Normalization (Fixes Hyderabad/Telangana -> UP bug)
    def _clean_str(val):
        if not val or not isinstance(val, str):
            return None
        clean = val.strip()
        if clean.lower() in ("none", "null", "unknown", "unspecified", ""):
            return None
        return clean

    jurisdiction = normalize_location(
        complaint_text=raw_text,
        state_hint=state_hint,
        district_hint=district_hint,
        ai_state=_clean_str(raw_data.get("state")),
        ai_district=_clean_str(raw_data.get("district")),
        ai_locality=_clean_str(raw_data.get("locality")),
        ai_location=_clean_str(raw_data.get("location"))
    )

    # 7. Deterministic 0–100 Priority Score Calculation
    priority_score, priority_reason = calculate_priority_score(
        urgency=urgency,
        categories=final_categories,
        raw_text=raw_text,
        support_count=1
    )

    # 8. Summary
    summary = str(raw_data.get("summary", "")).strip()
    if not summary:
        cat_labels = ", ".join(c.replace("_", " ") for c in final_categories)
        summary = f"Citizen reported {cat_labels} issue in {area_type} region ({jurisdiction.location_str})."

    # 9. Original Language
    original_language = str(raw_data.get("original_language", "English")).strip()
    if not original_language or original_language.lower() in ("none", "null"):
        original_language = "English"

    classified_by = raw_data.get("classified_by", "gemini")
    if classified_by not in ["gemini", "heuristic_fallback"]:
        classified_by = "gemini"

    # Validate against Pydantic schema
    result_obj = ClassificationResult(
        area_type=area_type,
        categories=final_categories,
        location=jurisdiction.location_str,
        state=jurisdiction.state,
        district=jurisdiction.district,
        locality=jurisdiction.locality,
        urgency=urgency,
        priority_score=priority_score,
        priority_reason=priority_reason,
        summary=summary,
        original_language=original_language,
        classified_by=classified_by
    )

    return result_obj.model_dump()


# Backwards compatibility alias
_validate_and_normalize = _two_stage_merge_and_validate
two_stage_merge_and_validate = _two_stage_merge_and_validate


def _heuristic_classify(
    text: str,
    state_hint: Optional[str] = None,
    district_hint: Optional[str] = None
) -> Dict[str, Any]:
    """
    Deterministic fallback classifier with multi-category support, urgency, canonical location,
    and 0–100 priority score calculation. Used when Gemini API is offline, rate-limited, or unavailable.
    """
    lower = text.lower()

    # 1. Detect Rural vs Urban
    rural_keywords = [
        "gaon", "gram panchayat", "gram pradhan", "gramin", "panchayat", "pradhan",
        "khet", "fasal", "kisan", "farmer", "tube well", "tubewell", "canal", "nehar",
        "irrigation", "chaupal", "tola", "rural", "village", "basti", "krishi",
        "phc", "chc", "healthcare", "doctor", "dispensary", "aspatal",
        "health centre", "health center", "health facility"
    ]
    is_rural = _matches_any_keyword(lower, rural_keywords)
    area_type = "rural" if is_rural else "urban"

    # 2. Multi-category keyword extraction
    categories = detect_explicit_categories(text, area_type)
    if not categories:
        valid_set = RURAL_CATEGORIES if area_type == "rural" else URBAN_CATEGORIES
        categories = [valid_set[0]]

    # Cap at 3
    categories = categories[:3]

    # 3. Detect Urgency
    urgency = "medium"
    if any(k in lower for k in [
        "danger", "dangerous", "hazard", "spark", "accident", "accidents", "emergency",
        "broken", "death", "die", "khatra", "marr", "aag", "fire", "hospital", "urgent",
        "immediate", "3 hafte", "two months", "2 months", "crater", "collapsed", "toxic"
    ]):
        urgency = "high"
    elif any(k in lower for k in ["minor", "request", "please", "maintenance", "light", "slow"]):
        urgency = "low"

    # 4. Canonical Location Normalization
    jurisdiction = normalize_location(
        complaint_text=text,
        state_hint=state_hint,
        district_hint=district_hint
    )

    # 5. Deterministic 0–100 Priority Score Calculation
    priority_score, priority_reason = calculate_priority_score(
        urgency=urgency,
        categories=categories,
        raw_text=text,
        support_count=1
    )

    # 6. Language Detection Fallback
    lower = text.lower()
    if any('\u0600' <= char <= '\u06FF' or '\u0750' <= char <= '\u077F' for char in text):
        original_language = "Urdu"
    elif any('\u0A80' <= char <= '\u0AFF' for char in text):
        original_language = "Gujarati"
    elif any('\u0D00' <= char <= '\u0D7F' for char in text):
        original_language = "Malayalam"
    elif any('\u0C00' <= char <= '\u0C7F' for char in text):
        original_language = "Telugu"
    elif any('\u0B80' <= char <= '\u0BFF' for char in text):
        original_language = "Tamil"
    elif any('\u0C80' <= char <= '\u0CFF' for char in text):
        original_language = "Kannada"
    elif any('\u0980' <= char <= '\u09FF' for char in text):
        original_language = "Assamese / Bengali"
    elif any('\u0900' <= char <= '\u097F' for char in text):
        # Bhojpuri or Hindi in Devanagari script
        bhojpuri_markers = ["ba", "baate", "bhavat", "rowa", "kahe", "humke", "tohar", "laika", "gail", "rahin", "baani"]
        if any(w in lower for w in bhojpuri_markers):
            original_language = "Bhojpuri"
        else:
            original_language = "Hindi"
    elif any(k in lower for k in ["hai", "nahi", "raha", "rahi", "gaon", "sadak", "bijli", "pani", "khet", "bahut", "mein", "pichle", "fasal", "suk"]):
        original_language = "Hinglish (Hindi in Latin script)"
    else:
        original_language = "English"

    cat_labels = ", ".join(c.replace("_", " ") for c in categories)
    summary = f"Citizen reported {cat_labels} issue in {area_type} region ({jurisdiction.location_str})."

    result_obj = ClassificationResult(
        area_type=area_type,
        categories=categories,
        location=jurisdiction.location_str,
        state=jurisdiction.state,
        district=jurisdiction.district,
        locality=jurisdiction.locality,
        urgency=urgency,
        priority_score=priority_score,
        priority_reason=priority_reason,
        summary=summary,
        original_language=original_language,
        classified_by="heuristic_fallback"
    )

    return result_obj.model_dump()


async def classify_complaint_with_gemini(
    text: str,
    state_hint: Optional[str] = None,
    district_hint: Optional[str] = None
) -> Dict[str, Any]:
    """
    Two-Stage Multi-Label Civic Complaint Classification:
    1. Ingestion through Google GenAI SDK (gemini-3.6-flash) using structured output.
    2. Deterministic multi-label validation and text inspection merge.
    3. Canonical location normalization & 0–100 priority score calculation.
    4. Seamless offline fallback on rate-limits, errors, or missing credentials.
    """
    api_key = settings.GEMINI_API_KEY
    _runtime_gemini_state["total_classifications"] += 1

    if not api_key:
        logger.warning("No GEMINI_API_KEY configured. Executing deterministic multi-label fallback.")
        _runtime_gemini_state["fallback_count"] += 1
        _runtime_gemini_state["last_used"] = "heuristic_fallback"
        return _heuristic_classify(text, state_hint=state_hint, district_hint=district_hint)

    try:
        # Attempt classification via candidate active Gemini models
        candidate_models = [
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "gemini-3.5-flash",
            settings.GEMINI_MODEL or "gemini-3.8-flash",
            "gemini-flash-latest"
        ]
        
        parsed_dict = None
        last_exception = None

        import google.generativeai as legacy_genai
        legacy_genai.configure(api_key=api_key)

        for model_name in candidate_models:
            if not model_name:
                continue
            try:
                model = legacy_genai.GenerativeModel(
                    model_name=model_name,
                    system_instruction=SYSTEM_PROMPT,
                    generation_config={"response_mime_type": "application/json", "temperature": 0.1}
                )
                user_prompt = f"Analyze this citizen complaint:\n\n\"\"\"\n{text}\n\"\"\""
                legacy_resp = model.generate_content(user_prompt)
                cleaned_json = legacy_resp.text.strip()
                if cleaned_json.startswith("```json"):
                    cleaned_json = cleaned_json[7:]
                if cleaned_json.startswith("```"):
                    cleaned_json = cleaned_json[3:]
                if cleaned_json.endswith("```"):
                    cleaned_json = cleaned_json[:-3]
                parsed_dict = json.loads(cleaned_json.strip())
                parsed_dict["classified_by"] = "gemini"

                _runtime_gemini_state["gemini_success_count"] += 1
                _runtime_gemini_state["last_used"] = f"gemini ({model_name})"
                _runtime_gemini_state["reachable"] = True
                _runtime_gemini_state["model"] = model_name
                logger.info(f"Successfully classified with Gemini model: {model_name}")
                break
            except Exception as model_err:
                last_exception = model_err
                logger.warning(f"Gemini model {model_name} failed: {type(model_err).__name__}. Trying next model...")

        if parsed_dict is None:
            raise last_exception or Exception("All Gemini models exhausted")

        # Stage 2: Merge, Validate, Normalize Location, Calculate Priority
        validated = _two_stage_merge_and_validate(
            parsed_dict,
            text,
            state_hint=state_hint,
            district_hint=district_hint
        )
        logger.info(f"Classified multi-label complaint: {validated['categories']} ({validated['area_type']}) - Priority: {validated['priority_score']}/100, Location: {validated['location']}")
        return validated

    except Exception as e:
        err_msg = f"{type(e).__name__}: {str(e)}"
        logger.warning(f"Gemini AI classification failed: {err_msg}. Executing deterministic multi-label fallback.")
        _runtime_gemini_state["fallback_count"] += 1
        _runtime_gemini_state["last_used"] = "heuristic_fallback"
        _runtime_gemini_state["last_error"] = err_msg
        return _heuristic_classify(text, state_hint=state_hint, district_hint=district_hint)
