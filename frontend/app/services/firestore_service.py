import json
import os
import uuid
import time
import logging
from typing import Dict, Any, List, Optional
import bcrypt

from app.config import settings
from app.services.priority_service import calculate_priority_score

logger = logging.getLogger("civiclens.firestore")

# ==============================================================================
# Centralized Firestore Collection Path Constants (Single Source of Truth)
# ==============================================================================
COMPLAINTS_COLLECTION = "complaints"
USERS_COLLECTION = "users"
OFFICIALS_COLLECTION = "officials"
ANALYTICS_COLLECTION = "analytics"


def hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a bcrypt hash or legacy plaintext string."""
    if not hashed_password:
        return False
    try:
        if hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$"):
            return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
        return plain_password == hashed_password
    except Exception:
        return plain_password == hashed_password


# Seed Complaints with multi-category arrays, canonical jurisdictions, and 0-100 Priority Scores
INITIAL_COMPLAINTS: List[Dict[str, Any]] = [
    {
        "id": "c-101",
        "raw_text": "Outer Ring Road near Silk Board Junction has massive crater-like potholes causing 2-hour daily traffic jams and dangerous accidents for two-wheelers.",
        "area_type": "urban",
        "categories": ["roads", "traffic"],
        "ai_categories": ["roads", "traffic"],
        "manual_categories": [],
        "location": "Silk Board Junction, Bengaluru, Karnataka",
        "state": "Karnataka",
        "district": "Bengaluru Urban",
        "locality": "Silk Board",
        "urgency": "high",
        "priority_score": 90,
        "priority_reason": "Priority: 90/100 · High urgency + immediate safety/health hazard + dual co-occurring issues + recurring daily disruption.",
        "summary": "Severe crater potholes near Silk Board junction causing 2-hour daily traffic jams and safety risks for two-wheelers.",
        "original_language": "English",
        "user_id": "usr-8891",
        "support_count": 104520,
        "high_priority": True,
        "timestamp": time.time() - 3600 * 24 * 3,
        "status": "in_progress",
        "classified_by": "gemini"
    },
    {
        "id": "c-102",
        "raw_text": "Hamare Rampur gaon mein 3 hafte se transformer jala hua hai. Fasal suk rahi hai aur tube well nahi chal pa rahe.",
        "area_type": "rural",
        "categories": ["electricity", "irrigation_water"],
        "ai_categories": ["electricity", "irrigation_water"],
        "manual_categories": [],
        "location": "Rampur Village, Varanasi, Uttar Pradesh",
        "state": "Uttar Pradesh",
        "district": "Varanasi",
        "locality": "Rampur",
        "urgency": "high",
        "priority_score": 85,
        "priority_reason": "Priority: 85/100 · High urgency + dual co-occurring issues + recurring daily disruption.",
        "summary": "Burnt electricity transformer in Rampur village cutting power to tube wells and threatening crops.",
        "original_language": "Hinglish (Hindi in Latin script)",
        "user_id": "usr-3421",
        "support_count": 112000,
        "high_priority": True,
        "timestamp": time.time() - 3600 * 24 * 2,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-103",
        "raw_text": "Primary Health Centre in Phulparas lacks basic emergency medicines and doctors are absent on weekdays. Villagers have to travel 40km.",
        "area_type": "rural",
        "categories": ["healthcare_access"],
        "ai_categories": ["healthcare_access"],
        "manual_categories": [],
        "location": "Phulparas Block, Madhubani, Bihar",
        "state": "Bihar",
        "district": "Madhubani",
        "locality": "Phulparas",
        "urgency": "high",
        "priority_score": 70,
        "priority_reason": "Priority: 70/100 · High urgency + immediate safety/health hazard.",
        "summary": "Doctor shortages and absence of emergency medicine at Phulparas Primary Health Centre.",
        "original_language": "English",
        "user_id": "usr-1102",
        "support_count": 48200,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 24 * 5,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-104",
        "raw_text": "Severe chemical stench and black toxic effluent discharge in open drains near Okhla Phase 3 industrial area. Breathing difficulties reported.",
        "area_type": "urban",
        "categories": ["pollution"],
        "ai_categories": ["pollution"],
        "manual_categories": [],
        "location": "Okhla Phase 3, New Delhi, Delhi",
        "state": "Delhi",
        "district": "South East Delhi",
        "locality": "Okhla Phase 3",
        "urgency": "high",
        "priority_score": 75,
        "priority_reason": "Priority: 75/100 · High urgency + immediate safety/health hazard + backed by citizen supports.",
        "summary": "Toxic industrial discharge and foul chemical stench causing respiratory concerns in Okhla Phase 3.",
        "original_language": "English",
        "user_id": "usr-9903",
        "support_count": 105800,
        "high_priority": True,
        "timestamp": time.time() - 3600 * 24 * 1,
        "status": "in_progress",
        "classified_by": "gemini"
    },
    {
        "id": "c-105",
        "raw_text": "No mobile network signal in Khed taluka for past 2 months after monsoon tower damage. Online schooling and UPI payments completely stopped.",
        "area_type": "rural",
        "categories": ["network_coverage"],
        "ai_categories": ["network_coverage"],
        "manual_categories": [],
        "location": "Khed Taluka, Pune, Maharashtra",
        "state": "Maharashtra",
        "district": "Pune",
        "locality": "Khed",
        "urgency": "medium",
        "priority_score": 45,
        "priority_reason": "Priority: 45/100 · Medium disruption + recurring daily disruption + backed by citizen supports.",
        "summary": "Complete loss of telecom and internet connectivity in Khed taluka due to damaged cellular tower.",
        "original_language": "English",
        "user_id": "usr-4412",
        "support_count": 31400,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 24 * 6,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-106",
        "raw_text": "Municipal tap water in Ward 14 has had zero supply for 5 days. Water tankers are charging exorbitant rates.",
        "area_type": "urban",
        "categories": ["water_shortage"],
        "ai_categories": ["water_shortage"],
        "manual_categories": [],
        "location": "Ward 14, Mansarovar, Jaipur, Rajasthan",
        "state": "Rajasthan",
        "district": "Jaipur",
        "locality": "Mansarovar",
        "urgency": "high",
        "priority_score": 55,
        "priority_reason": "Priority: 55/100 · High urgency + backed by citizen supports.",
        "summary": "Complete municipal drinking water stoppage for 5 days in Mansarovar Ward 14.",
        "original_language": "English",
        "user_id": "usr-7761",
        "support_count": 89400,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 18,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-107",
        "raw_text": "Feeder canal irrigation gate broken at canal KM 14. Water flooding adjacent wheat fields instead of reaching tail-end farmers.",
        "area_type": "rural",
        "categories": ["irrigation_water"],
        "ai_categories": ["irrigation_water"],
        "manual_categories": [],
        "location": "Bikramganj, Rohtas, Bihar",
        "state": "Bihar",
        "district": "Rohtas",
        "locality": "Bikramganj",
        "urgency": "high",
        "priority_score": 60,
        "priority_reason": "Priority: 60/100 · High urgency + backed by citizen supports.",
        "summary": "Damaged canal regulator gate causing field inundation and water deprivation for downstream farmers.",
        "original_language": "English",
        "user_id": "usr-5520",
        "support_count": 12500,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 12,
        "status": "in_progress",
        "classified_by": "gemini"
    },
    {
        "id": "c-108",
        "raw_text": "Traffic signal defunct at Rajeev Chowk intersection for over a week causing daily gridlock during peak morning hours.",
        "area_type": "urban",
        "categories": ["traffic", "roads"],
        "ai_categories": ["traffic", "roads"],
        "manual_categories": [],
        "location": "Rajeev Chowk, Gurugram, Haryana",
        "state": "Haryana",
        "district": "Gurugram",
        "locality": "Rajeev Chowk",
        "urgency": "medium",
        "priority_score": 55,
        "priority_reason": "Priority: 55/100 · Medium disruption + dual co-occurring issues + recurring daily disruption + backed by citizen supports.",
        "summary": "Defunct traffic lights at busy Rajeev Chowk junction resulting in daily gridlocks.",
        "original_language": "English",
        "user_id": "usr-2281",
        "support_count": 14200,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 40,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-109",
        "raw_text": "Severe water logging and blocked drainage near Dal Lake Boulevard road following snowfall and rain. Freezing slush creating severe hazard for morning commuters.",
        "area_type": "urban",
        "categories": ["drainage", "roads"],
        "ai_categories": ["drainage", "roads"],
        "manual_categories": [],
        "location": "Boulevard Road, Srinagar, Jammu & Kashmir",
        "state": "Jammu & Kashmir",
        "district": "Srinagar",
        "locality": "Boulevard Road",
        "urgency": "high",
        "priority_score": 88,
        "priority_reason": "Priority: 88/100 · High urgency + safety hazard + multi-category issue.",
        "summary": "Freezing slush and drainage blockage on Boulevard Road along Dal Lake.",
        "original_language": "English",
        "user_id": "usr-6101",
        "support_count": 42100,
        "high_priority": True,
        "timestamp": time.time() - 3600 * 20,
        "status": "in_progress",
        "classified_by": "gemini"
    },
    {
        "id": "c-110",
        "raw_text": "Streetlights non-functional across 2 km stretch on Janpath road from Master Canteen to Vani Vihar. Multiple chain-snatching incidents reported at night.",
        "area_type": "urban",
        "categories": ["electricity", "public_safety"],
        "ai_categories": ["electricity", "public_safety"],
        "manual_categories": [],
        "location": "Janpath, Bhubaneswar, Odisha",
        "state": "Odisha",
        "district": "Khordha",
        "locality": "Janpath",
        "urgency": "high",
        "priority_score": 82,
        "priority_reason": "Priority: 82/100 · High urgency + public safety risk.",
        "summary": "2km dark stretch due to broken street lighting on Janpath.",
        "original_language": "English",
        "user_id": "usr-6102",
        "support_count": 31500,
        "high_priority": True,
        "timestamp": time.time() - 3600 * 16,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-111",
        "raw_text": "Landslide debris blocking Mussoorie-Dehradun bypass road near Rajpur. Only one lane open causing 4-hour tourist and local traffic jams.",
        "area_type": "rural",
        "categories": ["roads", "traffic"],
        "ai_categories": ["roads", "traffic"],
        "manual_categories": [],
        "location": "Rajpur Bypass, Dehradun, Uttarakhand",
        "state": "Uttarakhand",
        "district": "Dehradun",
        "locality": "Rajpur",
        "urgency": "high",
        "priority_score": 85,
        "priority_reason": "Priority: 85/100 · Landslide hazard + arterial bypass obstruction.",
        "summary": "Landslide debris obstructing Rajpur bypass on Mussoorie-Dehradun route.",
        "original_language": "English",
        "user_id": "usr-6103",
        "support_count": 56000,
        "high_priority": True,
        "timestamp": time.time() - 3600 * 14,
        "status": "in_progress",
        "classified_by": "gemini"
    },
    {
        "id": "c-112",
        "raw_text": "Perambur railway subway flooded with 3 feet sewage-mixed stormwater after overnight heavy rains. Bus routes completely diverted.",
        "area_type": "urban",
        "categories": ["drainage", "transport"],
        "ai_categories": ["drainage", "transport"],
        "manual_categories": [],
        "location": "Perambur Subway, Chennai, Tamil Nadu",
        "state": "Tamil Nadu",
        "district": "Chennai",
        "locality": "Perambur",
        "urgency": "high",
        "priority_score": 87,
        "priority_reason": "Priority: 87/100 · Critical subway inundation disabling urban transit.",
        "summary": "Subway inundation with stormwater disrupting North Chennai transit.",
        "original_language": "English",
        "user_id": "usr-6104",
        "support_count": 78900,
        "high_priority": True,
        "timestamp": time.time() - 3600 * 10,
        "status": "in_progress",
        "classified_by": "gemini"
    },
    {
        "id": "c-113",
        "raw_text": "Pipeline burst near SG Highway Sarkhej junction. Hundreds of kilolitres of potable water wasted while surrounding societies have no supply.",
        "area_type": "urban",
        "categories": ["water_shortage"],
        "ai_categories": ["water_shortage"],
        "manual_categories": [],
        "location": "Sarkhej, Ahmedabad, Gujarat",
        "state": "Gujarat",
        "district": "Ahmedabad",
        "locality": "Sarkhej",
        "urgency": "medium",
        "priority_score": 64,
        "priority_reason": "Priority: 64/100 · Major drinking water pipeline rupture.",
        "summary": "Water main burst at SG Highway Sarkhej junction wasting municipal supply.",
        "original_language": "English",
        "user_id": "usr-6105",
        "support_count": 34100,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 22,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-114",
        "raw_text": "Potholes along Gachibowli to Financial District main corridor causing dangerous swerving for tech corridor IT bus commuters.",
        "area_type": "urban",
        "categories": ["roads"],
        "ai_categories": ["roads"],
        "manual_categories": [],
        "location": "Gachibowli, Hyderabad, Telangana",
        "state": "Telangana",
        "district": "Hyderabad",
        "locality": "Gachibowli",
        "urgency": "medium",
        "priority_score": 68,
        "priority_reason": "Priority: 68/100 · Major arterial potholes in high density corridor.",
        "summary": "Gachibowli to Financial District road deterioration.",
        "original_language": "English",
        "user_id": "usr-6106",
        "support_count": 45200,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 26,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-115",
        "raw_text": "Solid waste and plastic dumping along MG Road promenade in White Town causing foul odor and blocking stormwater drains.",
        "area_type": "urban",
        "categories": ["sanitation", "pollution"],
        "ai_categories": ["sanitation", "pollution"],
        "manual_categories": [],
        "location": "White Town, Puducherry",
        "state": "Puducherry",
        "district": "Puducherry",
        "locality": "White Town",
        "urgency": "medium",
        "priority_score": 58,
        "priority_reason": "Priority: 58/100 · Sanitation and drain blockage in tourist heritage zone.",
        "summary": "Uncollected garbage and drain dumping in White Town heritage zone.",
        "original_language": "English",
        "user_id": "usr-6107",
        "support_count": 18200,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 30,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-116",
        "raw_text": "Severe silt accumulation in Brahmaputra embankment canal near Jalukbari causing overflow during high tide.",
        "area_type": "rural",
        "categories": ["drainage", "irrigation_water"],
        "ai_categories": ["drainage", "irrigation_water"],
        "manual_categories": [],
        "location": "Jalukbari, Guwahati, Assam",
        "state": "Assam",
        "district": "Kamrup Metropolitan",
        "locality": "Jalukbari",
        "urgency": "high",
        "priority_score": 76,
        "priority_reason": "Priority: 76/100 · Embankment canal silting threatening low-lying neighborhoods.",
        "summary": "Canal siltation causing overflow near Jalukbari.",
        "original_language": "English",
        "user_id": "usr-6108",
        "support_count": 29800,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 18,
        "status": "in_progress",
        "classified_by": "gemini"
    },
    {
        "id": "c-117",
        "raw_text": "Underground sewage line rupture near Park Circus 7-point crossing leading to contaminated drinking water reports in 3 wards.",
        "area_type": "urban",
        "categories": ["sanitation", "water_shortage"],
        "ai_categories": ["sanitation", "water_shortage"],
        "manual_categories": [],
        "location": "Park Circus, Kolkata, West Bengal",
        "state": "West Bengal",
        "district": "Kolkata",
        "locality": "Park Circus",
        "urgency": "high",
        "priority_score": 92,
        "priority_reason": "Priority: 92/100 · Sewage pipe cross-contamination into water network.",
        "summary": "Sewage pipe fracture contaminating drinking water in Park Circus.",
        "original_language": "English",
        "user_id": "usr-6109",
        "support_count": 91200,
        "high_priority": True,
        "timestamp": time.time() - 3600 * 8,
        "status": "in_progress",
        "classified_by": "gemini"
    },
    {
        "id": "c-118",
        "raw_text": "Kochi metro pillar drainage downspouts leaking directly onto MG Road traffic lanes creating dangerous hydroplaning zones.",
        "area_type": "urban",
        "categories": ["roads", "traffic"],
        "ai_categories": ["roads", "traffic"],
        "manual_categories": [],
        "location": "MG Road, Kochi, Kerala",
        "state": "Kerala",
        "district": "Ernakulam",
        "locality": "MG Road",
        "urgency": "medium",
        "priority_score": 62,
        "priority_reason": "Priority: 62/100 · Road drainage defect creating skidding hazard.",
        "summary": "Leaking metro pillar downspouts on MG Road Kochi.",
        "original_language": "English",
        "user_id": "usr-6110",
        "support_count": 22400,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 32,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-119",
        "raw_text": "Industrial effluent discharge in Upper Lake catchment area near Bairagarh threatening municipal water intake reservoir.",
        "area_type": "urban",
        "categories": ["pollution", "water_shortage"],
        "ai_categories": ["pollution", "water_shortage"],
        "manual_categories": [],
        "location": "Bairagarh, Bhopal, Madhya Pradesh",
        "state": "Madhya Pradesh",
        "district": "Bhopal",
        "locality": "Bairagarh",
        "urgency": "high",
        "priority_score": 86,
        "priority_reason": "Priority: 86/100 · Contamination threat to city drinking water source.",
        "summary": "Effluent pollution near Upper Lake drinking water reservoir intake.",
        "original_language": "English",
        "user_id": "usr-6111",
        "support_count": 67300,
        "high_priority": True,
        "timestamp": time.time() - 3600 * 15,
        "status": "in_progress",
        "classified_by": "gemini"
    },
    {
        "id": "c-120",
        "raw_text": "Heavy commercial vehicles causing structural damage and massive noise pollution on GT Road bypass in Ludhiana.",
        "area_type": "urban",
        "categories": ["roads", "pollution"],
        "ai_categories": ["roads", "pollution"],
        "manual_categories": [],
        "location": "GT Road Bypass, Ludhiana, Punjab",
        "state": "Punjab",
        "district": "Ludhiana",
        "locality": "GT Road Bypass",
        "urgency": "medium",
        "priority_score": 59,
        "priority_reason": "Priority: 59/100 · Road surface wear and noise disruption.",
        "summary": "Heavy transit road damage on Ludhiana GT Road bypass.",
        "original_language": "English",
        "user_id": "usr-6112",
        "support_count": 25100,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 28,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-121",
        "raw_text": "Beach road streetlights and beachside surveillance cameras broken along RK Beach promenade from Submarine Museum to Kali Temple.",
        "area_type": "urban",
        "categories": ["electricity", "public_safety"],
        "ai_categories": ["electricity", "public_safety"],
        "manual_categories": [],
        "location": "RK Beach, Visakhapatnam, Andhra Pradesh",
        "state": "Andhra Pradesh",
        "district": "Visakhapatnam",
        "locality": "RK Beach",
        "urgency": "medium",
        "priority_score": 60,
        "priority_reason": "Priority: 60/100 · Darkness on popular coastal public promenade.",
        "summary": "Non-functional lights along RK Beach promenade in Visakhapatnam.",
        "original_language": "English",
        "user_id": "usr-6113",
        "support_count": 31000,
        "high_priority": False,
        "timestamp": time.time() - 3600 * 24,
        "status": "pending",
        "classified_by": "gemini"
    },
    {
        "id": "c-122",
        "raw_text": "Solar microgrid battery unit damaged due to extreme sub-zero temperatures near Chang La pass route in Leh district, causing power outage across 4 villages.",
        "area_type": "rural",
        "categories": ["electricity"],
        "ai_categories": ["electricity"],
        "manual_categories": [],
        "location": "Chang La Route, Leh, Ladakh",
        "state": "Ladakh",
        "district": "Leh",
        "locality": "Chang La",
        "urgency": "high",
        "priority_score": 84,
        "priority_reason": "Priority: 84/100 · Critical winter energy failure in remote high-altitude rural valley.",
        "summary": "Sub-zero solar microgrid battery failure cutting power to 4 Leh villages.",
        "original_language": "English",
        "user_id": "usr-6114",
        "support_count": 19400,
        "high_priority": True,
        "timestamp": time.time() - 3600 * 18,
        "status": "in_progress",
        "classified_by": "gemini"
    }
]

# 4-Tier officials with bcrypt-hashed passwords and jurisdiction objects
INITIAL_OFFICIALS: List[Dict[str, Any]] = [
    {
        "official_id": "admin",
        "name": "Dr. Rajeshwar Rao, IAS",
        "department": "National Infrastructure & Governance Mission",
        "level": "national",
        "jurisdiction": {
            "state": None,
            "district": None,
            "locality": None
        },
        "state": "All States",
        "district": "All Districts",
        "password_hash": "$2b$12$6w6r9sYw0sbB9DdBMATMMuug04prDtxTL7wQl8I6eJBzL5O2Nwt72"  # civic2026
    },
    {
        "official_id": "state_up",
        "name": "Anil Kumar Srivastava",
        "department": "UP Jal Nigam & Rural Infrastructure",
        "level": "state",
        "jurisdiction": {
            "state": "Uttar Pradesh",
            "district": None,
            "locality": None
        },
        "state": "Uttar Pradesh",
        "district": "All Districts",
        "password_hash": "$2b$12$YY3OIY0M5AbkKI7A2JMUXup5RXGf3L9SSSXUFWnr6fxctd1binori"  # jal2026
    },
    {
        "official_id": "up_jal",
        "name": "Anil Kumar Srivastava",
        "department": "UP Jal Nigam & Rural Infrastructure",
        "level": "state",
        "jurisdiction": {
            "state": "Uttar Pradesh",
            "district": None,
            "locality": None
        },
        "state": "Uttar Pradesh",
        "district": "All Districts",
        "password_hash": "$2b$12$sVWVZrplHOQHTALDVvUNh.T9k.uja0S1IWsMWOv244xMYL3y2KOSa"  # jal2026
    },
    {
        "official_id": "delhi_pwd",
        "name": "Sunita Verma, Chief Engineer",
        "department": "Delhi Public Works Department (PWD)",
        "level": "state",
        "jurisdiction": {
            "state": "Delhi",
            "district": None,
            "locality": None
        },
        "state": "Delhi",
        "district": "All Districts",
        "password_hash": "$2b$12$os9fzvQCL2sSn6ama.cwNurNtPfPs3m/2ga2qLjXFJxuVydfZyS4i"  # pwd2026
    },
    {
        "official_id": "dm_varanasi",
        "name": "K. S. Sharma, District Magistrate",
        "department": "District Administration, Varanasi",
        "level": "district",
        "jurisdiction": {
            "state": "Uttar Pradesh",
            "district": "Varanasi",
            "locality": None
        },
        "state": "Uttar Pradesh",
        "district": "Varanasi",
        "password_hash": "$2b$12$zDNOiP6yRi0Dn.u8royKhePWcmUygxKgzuss3xy9yZMb208w.29V2"  # varanasi2026
    },
    {
        "official_id": "bbmp_bangalore",
        "name": "Kavitha Reddy, Commissioner",
        "department": "BBMP Urban Infrastructure & Traffic",
        "level": "district",
        "jurisdiction": {
            "state": "Karnataka",
            "district": "Bengaluru Urban",
            "locality": None
        },
        "state": "Karnataka",
        "district": "Bengaluru Urban",
        "password_hash": "$2b$12$fQ0eKTSKEtuRFiLakdYl.uXpmDCVaypKURLGZmsu.vv5.CJhO5AGK"  # bbmp2026
    },
    {
        "official_id": "local_rampur",
        "name": "Rameshwar Yadav, Gram Panchayat Adhikari",
        "department": "Rampur Village Development Office",
        "level": "local",
        "jurisdiction": {
            "state": "Uttar Pradesh",
            "district": "Varanasi",
            "locality": "Rampur"
        },
        "state": "Uttar Pradesh",
        "district": "Varanasi",
        "password_hash": "$2b$12$f2cAj.0/wC7pYLfoj7jd6uNjxVHuiQ90BxkR5nya/ptu1YGEPPY6O"  # local2026
    },
    {
        "official_id": "bihar_power",
        "name": "Manoj Paswan, Executive Engineer",
        "department": "Bihar State Power Distribution Co.",
        "level": "district",
        "jurisdiction": {
            "state": "Bihar",
            "district": "Madhubani",
            "locality": None
        },
        "state": "Bihar",
        "district": "Madhubani",
        "password_hash": "$2b$12$IuJXVRIH0lweL5UPwDqGX.wTWtX/DiMhhVTC8a7LB3rczNBfC6aCu"  # bihar2026
    }
]


class FirestoreService:
    """
    Unified Data Access Layer for Google Cloud Firestore.
    Provides real Firestore connectivity with seamless local persistence fallback.
    """

    def __init__(self):
        self.use_cloud_firestore = False
        self.db = None
        self.storage_reason = "No credentials provided; operating in local JSON fallback mode."
        self.data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
        self.db_file = os.path.join(self.data_dir, "civiclens_db.json")
        self._init_storage()

    def _init_storage(self):
        """Try initializing Google Cloud Firestore / Firebase Admin SDK, or fallback to local persistence."""
        project_id = settings.FIREBASE_PROJECT_ID or "jansetu-d2106"
        service_account_json = settings.FIREBASE_SERVICE_ACCOUNT_JSON or os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "")
        creds_path = settings.FIREBASE_CREDENTIALS_PATH
        if creds_path and not os.path.exists(creds_path):
            backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
            alt_path = os.path.join(backend_dir, creds_path.lstrip("./"))
            if os.path.exists(alt_path):
                creds_path = alt_path

        try:
            # 1. First priority: Raw JSON string from Secret Manager / environment variable
            if service_account_json and service_account_json.strip():
                import firebase_admin
                from firebase_admin import credentials, firestore
                parsed_cert = json.loads(service_account_json)
                cred = credentials.Certificate(parsed_cert)
                try:
                    firebase_admin.initialize_app(cred, {"projectId": project_id})
                except ValueError:
                    pass
                self.db = firestore.client()
                self.use_cloud_firestore = True
                self.storage_reason = f"Connected to Google Cloud Firestore via Secret Manager JSON (Project: {project_id})"
                logger.info(f"✅ Real Google Cloud Firestore connected via Secret Manager JSON (Project ID: {project_id})")
                return

            # 2. Second priority: Local service account file path
            elif creds_path and os.path.exists(creds_path):
                import firebase_admin
                from firebase_admin import credentials, firestore
                cred = credentials.Certificate(creds_path)
                try:
                    firebase_admin.initialize_app(cred, {"projectId": project_id})
                except ValueError:
                    pass
                self.db = firestore.client()
                self.use_cloud_firestore = True
                self.storage_reason = f"Connected to Google Cloud Firestore (Project: {project_id})"
                logger.info(f"✅ Real Google Cloud Firestore connected (Project ID: {project_id})")
                return

            # 3. Third priority: Application Default Credentials (ADC)
            elif os.getenv("GOOGLE_APPLICATION_CREDENTIALS") and os.path.exists(os.getenv("GOOGLE_APPLICATION_CREDENTIALS")):
                import firebase_admin
                from firebase_admin import firestore
                try:
                    firebase_admin.initialize_app(options={"projectId": project_id})
                except ValueError:
                    pass
                self.db = firestore.client()
                self.use_cloud_firestore = True
                self.storage_reason = f"Connected via GOOGLE_APPLICATION_CREDENTIALS (Project: {project_id})"
                logger.info(f"✅ Real Google Cloud Firestore connected via ADC (Project ID: {project_id})")
                return
            else:
                self.storage_reason = f"FIREBASE_CREDENTIALS_PATH not set or file not found. Running in local JSON database mode (Project: {project_id})."
                logger.info(f"ℹ️ Storage mode: local_json fallback. Reason: {self.storage_reason}")
        except Exception as e:
            self.storage_reason = f"Failed to initialize Firestore: {e}. Falling back to local JSON."
            logger.warning(f"⚠️ {self.storage_reason}")

        # Local storage setup
        os.makedirs(self.data_dir, exist_ok=True)
        if not os.path.exists(self.db_file):
            self._save_local_data({
                COMPLAINTS_COLLECTION: INITIAL_COMPLAINTS,
                OFFICIALS_COLLECTION: INITIAL_OFFICIALS,
                "otps": {}
            })
            logger.info("Initialized local CivicLens database with multi-category seed data.")
        else:
            data = self._load_local_data()
            migrated = False

            # Sync officials: ensure all standard 4-tier officials are present
            existing_ids = {o.get("official_id") for o in data.get(OFFICIALS_COLLECTION, [])}
            updated_officials = list(data.get(OFFICIALS_COLLECTION, []))
            for init_off in INITIAL_OFFICIALS:
                if init_off["official_id"] not in existing_ids:
                    updated_officials.append(init_off)
                    migrated = True
                else:
                    for idx, ex_off in enumerate(updated_officials):
                        if ex_off.get("official_id") == init_off["official_id"]:
                            if "level" not in ex_off or "jurisdiction" not in ex_off or "password_hash" not in ex_off:
                                updated_officials[idx] = init_off
                                migrated = True
            data[OFFICIALS_COLLECTION] = updated_officials

            # Sync complaints: ensure categories is list and priority_score is 0-100 integer
            for c in data.get(COMPLAINTS_COLLECTION, []):
                if "category" in c and "categories" not in c:
                    c["categories"] = [c["category"]]
                    c.setdefault("locality", "unspecified")
                    migrated = True
                if "priority_score" not in c or not isinstance(c["priority_score"], int):
                    score, reason = calculate_priority_score(
                        urgency=c.get("urgency", "medium"),
                        categories=c.get("categories", ["roads"]),
                        raw_text=c.get("raw_text", ""),
                        support_count=c.get("support_count", 1)
                    )
                    c["priority_score"] = score
                    c["priority_reason"] = reason
                    migrated = True
            if migrated:
                self._save_local_data(data)
                logger.info("Auto-synchronized 4-tier officials, 0-100 priority scores, and multi-category complaints in local JSON.")
            logger.info("Loaded existing CivicLens local database.")

    def get_storage_type(self) -> str:
        """Returns 'firestore' or 'local_json'."""
        return "firestore" if self.use_cloud_firestore else "local_json"

    def get_storage_status(self) -> Dict[str, Any]:
        """Returns storage diagnostics for /api/health."""
        return {
            "storage": self.get_storage_type(),
            "project_id": settings.FIREBASE_PROJECT_ID,
            "reason": self.storage_reason
        }

    def _load_local_data(self) -> Dict[str, Any]:
        try:
            with open(self.db_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {COMPLAINTS_COLLECTION: INITIAL_COMPLAINTS, OFFICIALS_COLLECTION: INITIAL_OFFICIALS, "otps": {}}

    def _save_local_data(self, data: Dict[str, Any]):
        try:
            with open(self.db_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Error saving to local db: {e}")

    # --- Complaints Methods ---

    def create_complaint(self, complaint_data: Dict[str, Any]) -> Dict[str, Any]:
        """Save a new structured complaint to Firestore or local storage."""
        complaint_id = complaint_data.get("id") or f"c-{uuid.uuid4().hex[:8]}"

        raw_cats = complaint_data.get("categories")
        if isinstance(raw_cats, str):
            raw_cats = [raw_cats]
        elif not isinstance(raw_cats, list) or not raw_cats:
            single = complaint_data.get("category", "roads")
            raw_cats = [single] if single else ["roads"]

        # Calculate or normalize 0-100 priority score
        score = complaint_data.get("priority_score")
        reason = complaint_data.get("priority_reason")
        if score is None or not isinstance(score, int):
            score, reason = calculate_priority_score(
                urgency=complaint_data.get("urgency", "medium"),
                categories=raw_cats[:3],
                raw_text=complaint_data.get("raw_text", ""),
                support_count=complaint_data.get("support_count", 1)
            )

        doc = {
            "id": complaint_id,
            "raw_text": complaint_data.get("raw_text", ""),
            "area_type": complaint_data.get("area_type", "urban"),
            "categories": raw_cats[:3],
            "ai_categories": complaint_data.get("ai_categories", raw_cats[:3]),
            "manual_categories": complaint_data.get("manual_categories", []),
            "location": complaint_data.get("location", "unspecified"),
            "state": complaint_data.get("state", "unspecified"),
            "district": complaint_data.get("district", "unspecified"),
            "locality": complaint_data.get("locality", "unspecified"),
            "urgency": complaint_data.get("urgency", "medium"),
            "priority_score": max(0, min(100, int(score))),
            "priority_reason": reason or f"Priority: {score}/100",
            "summary": complaint_data.get("summary", ""),
            "original_language": complaint_data.get("original_language", "English"),
            "user_id": complaint_data.get("user_id", "anonymous"),
            "support_count": complaint_data.get("support_count", 1),
            "high_priority": complaint_data.get("high_priority", score >= 75 or complaint_data.get("support_count", 1) >= 100000),
            "timestamp": complaint_data.get("timestamp", time.time()),
            "status": complaint_data.get("status", "pending"),
            "classified_by": complaint_data.get("classified_by", "gemini"),
            "current_level": complaint_data.get("current_level", "district"),
            "expected_resolution_days": complaint_data.get("expected_resolution_days", (
                7 if complaint_data.get("urgency") == "high" else
                14 if complaint_data.get("urgency") == "medium" else 30
            ))
        }

        if self.use_cloud_firestore and self.db:
            try:
                self.db.collection(COMPLAINTS_COLLECTION).document(complaint_id).set(doc)
                return doc
            except Exception as e:
                logger.error(f"Firestore cloud write error: {e}")

        # Local storage fallback
        data = self._load_local_data()
        if COMPLAINTS_COLLECTION not in data:
            data[COMPLAINTS_COLLECTION] = []
        data[COMPLAINTS_COLLECTION].insert(0, doc)
        self._save_local_data(data)
        return doc

    def get_complaints(
        self,
        area_type: Optional[str] = None,
        category: Optional[str] = None,
        urgency: Optional[str] = None,
        state: Optional[str] = None,
        district: Optional[str] = None,
        locality: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Retrieve complaints with optional filtering matching across Firestore and local storage."""
        if self.use_cloud_firestore and self.db:
            try:
                query = self.db.collection(COMPLAINTS_COLLECTION)
                if area_type and area_type.lower() != "all":
                    query = query.where("area_type", "==", area_type)
                if category and category.lower() != "all":
                    query = query.where("categories", "array_contains", category)
                if urgency and urgency.lower() != "all":
                    query = query.where("urgency", "==", urgency)
                if state and state != "All States":
                    query = query.where("state", "==", state)
                if district and district != "All Districts":
                    query = query.where("district", "==", district)
                if locality and locality != "unspecified":
                    query = query.where("locality", "==", locality)

                docs = query.limit(limit).stream()
                results = [d.to_dict() for d in docs]

                if search:
                    term = search.lower()
                    results = [
                        c for c in results
                        if (
                            term in c.get("raw_text", "").lower() or
                            term in c.get("summary", "").lower() or
                            term in c.get("location", "").lower() or
                            any(term in str(cat).lower() for cat in c.get("categories", []))
                        )
                    ]
                return results
            except Exception as e:
                logger.error(f"Firestore cloud query error: {e}")

        # Local storage fallback
        data = self._load_local_data()
        complaints = data.get(COMPLAINTS_COLLECTION, [])

        results = []
        for c in complaints:
            if area_type and area_type.lower() != "all" and c.get("area_type") != area_type:
                continue

            if category and category.lower() != "all":
                c_cats = c.get("categories", [])
                if isinstance(c_cats, str):
                    c_cats = [c_cats]
                legacy_cat = c.get("category")
                if category not in c_cats and legacy_cat != category:
                    continue

            if urgency and urgency.lower() != "all" and c.get("urgency") != urgency:
                continue
            if state and state != "All States" and c.get("state") != state:
                continue
            if district and district != "All Districts" and c.get("district") != district:
                continue
            if locality and locality != "unspecified" and c.get("locality") != locality:
                continue

            if search:
                term = search.lower()
                c_cats = c.get("categories", [])
                text_matches = (
                    term in c.get("raw_text", "").lower() or
                    term in c.get("summary", "").lower() or
                    term in c.get("location", "").lower() or
                    any(term in str(cat).lower() for cat in c_cats)
                )
                if not text_matches:
                    continue
            results.append(c)

        return results[:limit]

    def get_complaint_by_id(self, complaint_id: str) -> Optional[Dict[str, Any]]:
        """Fetch a single complaint document."""
        if self.use_cloud_firestore and self.db:
            try:
                doc = self.db.collection(COMPLAINTS_COLLECTION).document(complaint_id).get()
                if doc.exists:
                    return doc.to_dict()
            except Exception as e:
                logger.error(f"Firestore get error: {e}")

        data = self._load_local_data()
        for c in data.get(COMPLAINTS_COLLECTION, []):
            if c.get("id") == complaint_id:
                return c
        return None

    def increment_support(self, complaint_id: str, amount: int = 1) -> Optional[Dict[str, Any]]:
        """Increment support_count using atomic increment and update priority score if needed."""
        if self.use_cloud_firestore and self.db:
            try:
                from firebase_admin import firestore as fa_firestore
                doc_ref = self.db.collection(COMPLAINTS_COLLECTION).document(complaint_id)
                doc_ref.update({
                    "support_count": fa_firestore.firestore.Increment(amount)
                })
                snapshot = doc_ref.get()
                if not snapshot.exists:
                    return None
                current = snapshot.to_dict()
                if current.get("support_count", 0) >= 100000 and not current.get("high_priority", False):
                    doc_ref.update({"high_priority": True})
                    current["high_priority"] = True
                return current
            except Exception as e:
                logger.error(f"Firestore cloud support increment error: {e}")

        # Local storage fallback
        data = self._load_local_data()
        updated_doc = None
        for c in data.get(COMPLAINTS_COLLECTION, []):
            if c.get("id") == complaint_id:
                c["support_count"] = c.get("support_count", 0) + amount
                if c["support_count"] >= 100000:
                    c["high_priority"] = True
                # Re-calculate priority score with support weight
                score, reason = calculate_priority_score(
                    urgency=c.get("urgency", "medium"),
                    categories=c.get("categories", ["roads"]),
                    raw_text=c.get("raw_text", ""),
                    support_count=c["support_count"]
                )
                c["priority_score"] = score
                c["priority_reason"] = reason
                updated_doc = c
                break

        if updated_doc:
            self._save_local_data(data)

        return updated_doc

    def update_complaint_status(self, complaint_id: str, status: str, current_level: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Update complaint governance resolution status in Firestore and local storage."""
        update_fields = {"status": status}
        if current_level:
            update_fields["current_level"] = current_level

        if self.use_cloud_firestore and self.db:
            try:
                doc_ref = self.db.collection(COMPLAINTS_COLLECTION).document(complaint_id)
                doc_ref.update(update_fields)
                snapshot = doc_ref.get()
                if snapshot.exists:
                    return snapshot.to_dict()
            except Exception as e:
                logger.error(f"Firestore cloud status update error: {e}")

        # Local storage fallback
        data = self._load_local_data()
        updated_doc = None
        for c in data.get(COMPLAINTS_COLLECTION, []):
            if c.get("id") == complaint_id:
                c["status"] = status
                if current_level:
                    c["current_level"] = current_level
                updated_doc = c
                break
        if updated_doc:
            self._save_local_data(data)
        return updated_doc

    def get_complaints_by_user(self, user_id: str) -> List[Dict[str, Any]]:
        """Fetch all complaints submitted by a specific citizen, newest first."""
        if self.use_cloud_firestore and self.db:
            try:
                query = self.db.collection(COMPLAINTS_COLLECTION).where("user_id", "==", user_id)
                docs = query.stream()
                results = sorted([d.to_dict() for d in docs], key=lambda x: x.get("timestamp", 0), reverse=True)
                return results
            except Exception as e:
                logger.error(f"Firestore get_complaints_by_user error: {e}")

        data = self._load_local_data()
        results = [c for c in data.get(COMPLAINTS_COLLECTION, []) if c.get("user_id") == user_id]
        results.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        return results

    # --- Officials Methods ---

    def get_official(self, official_id: str) -> Optional[Dict[str, Any]]:
        """Lookup official profile from Cloud Firestore, local storage, or fallback seed list."""
        if self.use_cloud_firestore and self.db:
            try:
                doc = self.db.collection(OFFICIALS_COLLECTION).document(official_id).get()
                if doc.exists:
                    return doc.to_dict()
            except Exception as e:
                logger.error(f"Firestore official lookup error: {e}")

        try:
            data = self._load_local_data()
            for o in data.get(OFFICIALS_COLLECTION, []):
                if o.get("official_id") == official_id:
                    return o
        except Exception:
            pass

        for o in INITIAL_OFFICIALS:
            if o.get("official_id") == official_id:
                return o
        return None

    def verify_official(self, official_id: str, password: str) -> Optional[Dict[str, Any]]:
        """Authenticate official credentials using bcrypt hash verification."""
        official = self.get_official(official_id)
        if not official:
            return None

        hash_to_check = official.get("password_hash") or official.get("password", "")
        if verify_password(password, hash_to_check):
            return {
                "official_id": official["official_id"],
                "name": official["name"],
                "department": official["department"],
                "level": official.get("level", "national"),
                "jurisdiction": official.get("jurisdiction", {
                    "state": official.get("state") if official.get("state") != "All States" else None,
                    "district": official.get("district") if official.get("district") != "All Districts" else None,
                    "locality": None
                }),
                "state": official.get("state", "All States"),
                "district": official.get("district", "All Districts")
            }
        return None


# Global singleton instance
firestore_service = FirestoreService()
