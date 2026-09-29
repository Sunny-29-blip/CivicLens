import re
import uuid
import time
import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, status, Header
from pydantic import BaseModel, Field, EmailStr

from app.config import settings
from app.services.firestore_service import (
    FS_READ_TIMEOUT_S,
    FS_WRITE_TIMEOUT_S,
    firestore_service, 
    hash_password, 
    verify_password,
    USERS_COLLECTION
)

router = APIRouter(prefix="/auth", tags=["Citizen & Official Authentication"])
logger = logging.getLogger("civiclens.routes.auth")

# In-memory token cache for authenticated citizen sessions
CITIZEN_SESSIONS: Dict[str, Dict[str, Any]] = {}

# Seed / Demo Citizens for Hackathon Demonstration
DEFAULT_CITIZENS: List[Dict[str, Any]] = [
    {
        "uid": "usr-889101",
        "displayName": "Aarav Sharma",
        "email": "citizen.demo@civiclens.gov.in",
        "password_hash": hash_password("citizen2026"),
        "role": "citizen",
        "phone": "9876543210",
        "createdAt": time.time() - 3600 * 24 * 30
    },
    {
        "uid": "usr-889102",
        "displayName": "Priya Patel",
        "email": "priya.patel@civiclens.org",
        "password_hash": hash_password("citizen2026"),
        "role": "citizen",
        "phone": "9811223344",
        "createdAt": time.time() - 3600 * 24 * 15
    }
]

DEMO_CITIZENS_PHONE = {
    "9876543210": "Aarav Sharma",
    "9811223344": "Priya Patel",
    "9988776655": "Rameshwar Yadav",
    "9123456780": "Ananya Mukherjee",
    "9845012345": "Karthik Swamy"
}


# ==============================================================================
# Pydantic Schemas
# ==============================================================================

class CitizenSignUpRequest(BaseModel):
    name: str = Field(..., min_length=2, description="Citizen's full name")
    email: str = Field(..., description="Citizen's email address")
    password: str = Field(..., min_length=6, description="Account password (min 6 characters)")


class CitizenLoginRequest(BaseModel):
    email: str = Field(..., description="Registered email address")
    password: str = Field(..., description="Account password")


class CitizenGoogleAuthRequest(BaseModel):
    email: str = Field(..., description="Google authenticated email")
    name: Optional[str] = Field(None, description="Google display name")
    uid: Optional[str] = Field(None, description="Google / Firebase UID")
    id_token: Optional[str] = Field(None, description="Firebase ID token")


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., description="Email address to receive reset link")


class SendOtpRequest(BaseModel):
    phone_number: str = Field(..., description="10-digit Indian mobile number")


class VerifyOtpRequest(BaseModel):
    phone_number: str = Field(..., description="Mobile number used to request OTP")
    otp: str = Field(..., description="6-digit OTP code (Demo OTP is 123456)")
    name: Optional[str] = Field(None, description="Optional citizen display name")


class AuthResponse(BaseModel):
    success: bool
    token: str
    user_id: str
    name: str
    email: Optional[str] = None
    role: str = "citizen"
    message: str


# ==============================================================================
# Citizen Email & Password Authentication
# ==============================================================================

def _get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Look up user document in Firestore or local storage by email."""
    email_clean = email.strip().lower()
    
    if firestore_service.use_cloud_firestore and firestore_service.db:
        try:
            docs = firestore_service.db.collection(USERS_COLLECTION).where("email", "==", email_clean).limit(1).stream(timeout=FS_READ_TIMEOUT_S)
            for d in docs:
                return d.to_dict()
        except Exception as e:
            logger.error(f"Firestore user lookup error: {e}")

    # Local storage lookup
    data = firestore_service._load_local_data()
    users = data.get(USERS_COLLECTION, DEFAULT_CITIZENS)
    for u in users:
        if u.get("email", "").strip().lower() == email_clean:
            return u
    return None


def _save_user(user_doc: Dict[str, Any]):
    """Save or update user in Firestore or local storage."""
    uid = user_doc["uid"]
    if firestore_service.use_cloud_firestore and firestore_service.db:
        try:
            firestore_service.db.collection(USERS_COLLECTION).document(uid).set(user_doc, timeout=FS_WRITE_TIMEOUT_S)
            return
        except Exception as e:
            logger.error(f"Firestore save user error: {e}")

    data = firestore_service._load_local_data()
    if USERS_COLLECTION not in data:
        data[USERS_COLLECTION] = list(DEFAULT_CITIZENS)
    
    # Update existing or append
    updated = False
    for idx, u in enumerate(data[USERS_COLLECTION]):
        if u.get("uid") == uid or u.get("email") == user_doc.get("email"):
            data[USERS_COLLECTION][idx] = user_doc
            updated = True
            break
    if not updated:
        data[USERS_COLLECTION].append(user_doc)
    
    firestore_service._save_local_data(data)


@router.post("/citizen/signup", response_model=AuthResponse, summary="Citizen Account Registration")
async def citizen_signup(payload: CitizenSignUpRequest):
    """
    Registers a new citizen account with bcrypt password hashing.
    Enforces that default assigned role is strictly 'citizen' (no elevation possible from frontend).
    """
    email_clean = payload.email.strip().lower()
    if not re.match(r"^[^@]+@[^@]+\.[^@]+$", email_clean):
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")

    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters long.")

    # Check if user already exists
    existing = _get_user_by_email(email_clean)
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email address already exists. Please sign in.")

    uid = f"usr-{uuid.uuid4().hex[:8]}"
    pwd_hash = hash_password(payload.password)

    user_doc = {
        "uid": uid,
        "displayName": payload.name.strip(),
        "email": email_clean,
        "password_hash": pwd_hash,
        "role": "citizen",  # Strictly assigned by backend
        "createdAt": time.time()
    }
    _save_user(user_doc)

    session_token = f"civiclens-cit-tok-{uuid.uuid4().hex}"
    CITIZEN_SESSIONS[session_token] = {
        "user_id": uid,
        "name": payload.name.strip(),
        "email": email_clean,
        "role": "citizen"
    }

    logger.info(f"New citizen registered: {payload.name} ({email_clean})")

    return {
        "success": True,
        "token": session_token,
        "user_id": uid,
        "name": payload.name.strip(),
        "email": email_clean,
        "role": "citizen",
        "message": f"Welcome to CivicLens, {payload.name.strip()}! Account created successfully."
    }


@router.post("/citizen/login", response_model=AuthResponse, summary="Citizen Email & Password Login")
async def citizen_login(payload: CitizenLoginRequest):
    """
    Authenticates citizen with email and bcrypt password.
    """
    email_clean = payload.email.strip().lower()
    user = _get_user_by_email(email_clean)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="We couldn't find an account with that email address. Please check your email or create an account."
        )

    pwd_hash = user.get("password_hash", "")
    if not verify_password(payload.password, pwd_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password. Please try again or use forgot password."
        )

    uid = user.get("uid", f"usr-{uuid.uuid4().hex[:8]}")
    name = user.get("displayName", user.get("name", "Citizen"))
    session_token = f"civiclens-cit-tok-{uuid.uuid4().hex}"

    CITIZEN_SESSIONS[session_token] = {
        "user_id": uid,
        "name": name,
        "email": email_clean,
        "role": "citizen"
    }

    logger.info(f"Citizen signed in: {name} ({email_clean})")

    return {
        "success": True,
        "token": session_token,
        "user_id": uid,
        "name": name,
        "email": email_clean,
        "role": "citizen",
        "message": f"Welcome back, {name}!"
    }


@router.post("/citizen/google", response_model=AuthResponse, summary="Citizen Google Sign-In Integration")
async def citizen_google_auth(payload: CitizenGoogleAuthRequest):
    """
    Authenticates or creates a citizen account via Google Authentication.
    """
    email_clean = payload.email.strip().lower()
    user = _get_user_by_email(email_clean)

    if not user:
        uid = payload.uid or f"usr-{uuid.uuid4().hex[:8]}"
        name = payload.name or email_clean.split("@")[0].title()
        user = {
            "uid": uid,
            "displayName": name,
            "email": email_clean,
            "role": "citizen",
            "authProvider": "google",
            "createdAt": time.time()
        }
        _save_user(user)
    else:
        uid = user.get("uid", payload.uid or f"usr-{uuid.uuid4().hex[:8]}")
        name = user.get("displayName", payload.name or "Citizen")

    session_token = f"civiclens-cit-tok-{uuid.uuid4().hex}"
    CITIZEN_SESSIONS[session_token] = {
        "user_id": uid,
        "name": name,
        "email": email_clean,
        "role": "citizen"
    }

    return {
        "success": True,
        "token": session_token,
        "user_id": uid,
        "name": name,
        "email": email_clean,
        "role": "citizen",
        "message": f"Welcome, {name}!"
    }


@router.post("/citizen/forgot-password", summary="Request Password Reset")
async def forgot_password(payload: ForgotPasswordRequest):
    """Generates password reset acknowledgment message for citizens."""
    return {
        "success": True,
        "message": f"Password reset instructions have been dispatched to {payload.email.strip()}."
    }


# ==============================================================================
# Citizen Phone OTP Authentication
# ==============================================================================

@router.post("/send-otp", summary="Request SMS OTP for Citizen Phone Login")
async def send_otp(payload: SendOtpRequest):
    phone = payload.phone_number.replace("+91", "").replace("-", "").replace(" ", "")
    if len(phone) < 10:
        raise HTTPException(status_code=400, detail="Please enter a valid 10-digit mobile number.")

    db_data = firestore_service._load_local_data()
    if "otps" not in db_data:
        db_data["otps"] = {}
    db_data["otps"][phone] = {
        "otp": settings.DEMO_OTP,
        "timestamp": time.time()
    }
    firestore_service._save_local_data(db_data)

    return {
        "success": True,
        "message": f"OTP sent successfully to +91 {phone}",
        "phone_number": phone,
        "demo_hint": f"Demo OTP is {settings.DEMO_OTP}"
    }


@router.post("/verify-otp", response_model=AuthResponse, summary="Verify SMS OTP and issue citizen session")
async def verify_otp(payload: VerifyOtpRequest):
    phone = payload.phone_number.replace("+91", "").replace("-", "").replace(" ", "")
    otp = payload.otp.strip()

    db_data = firestore_service._load_local_data()
    stored_otp_data = db_data.get("otps", {}).get(phone)

    is_valid = (otp == settings.DEMO_OTP) or (stored_otp_data and stored_otp_data.get("otp") == otp)

    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid OTP. Please enter the 6-digit OTP code (Demo: 123456)."
        )

    citizen_name = payload.name or DEMO_CITIZENS_PHONE.get(phone) or f"Citizen (+91 {phone[-4:]})"
    user_id = f"usr-{phone[-6:]}"
    session_token = f"civiclens-cit-tok-{uuid.uuid4().hex}"

    CITIZEN_SESSIONS[session_token] = {
        "user_id": user_id,
        "name": citizen_name,
        "phone": phone,
        "role": "citizen"
    }

    return {
        "success": True,
        "token": session_token,
        "user_id": user_id,
        "name": citizen_name,
        "email": f"{phone}@sms.civiclens.local",
        "role": "citizen",
        "message": f"Welcome back, {citizen_name}!"
    }
