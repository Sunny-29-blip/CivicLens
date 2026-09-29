import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_api_health_endpoint():
    """Verify /api/health endpoint returns healthy status, storage mode, and Gemini status (Part A & C)."""
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert data["service"] == "civiclens-backend"
    assert "storage" in data
    assert data["storage"] in ["firestore", "local_json"]
    assert "gemini" in data


def test_citizen_auth_flow():
    """Test OTP issuance and validation."""
    # 1. Send OTP
    send_res = client.post("/auth/send-otp", json={"phone_number": "9876543210"})
    assert send_res.status_code == 200
    assert send_res.json()["success"] is True

    # 2. Verify with wrong OTP -> 401
    bad_res = client.post("/auth/verify-otp", json={"phone_number": "9876543210", "otp": "000000"})
    assert bad_res.status_code == 401

    # 3. Verify with correct Demo OTP 123456
    good_res = client.post("/auth/verify-otp", json={"phone_number": "9876543210", "otp": "123456", "name": "Aarav Sharma"})
    assert good_res.status_code == 200
    data = good_res.json()
    assert data["success"] is True
    assert data["name"] == "Aarav Sharma"
    assert "token" in data


def test_complaint_submission_and_gemini_categorization():
    """Test AI complaint submission returning categories array and locality (Part A, B, D)."""
    payload = {
        "text": "Hamare Rampur gaon mein 3 hafte se bijli transformer jala hua hai, fasal suk rahi hai khet me.",
        "user_id": "usr-test-99",
        "state": "Uttar Pradesh",
        "district": "Varanasi"
    }
    res = client.post("/requests/submit", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["area_type"] == "rural"
    assert isinstance(data["categories"], list)
    assert len(data["categories"]) >= 1
    assert "electricity" in data["categories"] or "irrigation_water" in data["categories"]
    assert data["urgency"] == "high"
    assert data["state"] == "Uttar Pradesh"
    assert "summary" in data
    assert "id" in data
    assert "classified_by" in data
    assert data["classified_by"] in ["gemini", "heuristic_fallback"]


def test_dual_issue_submission_part_b():
    """Part B: Submit dual issue grievance and verify area_type=rural and both categories."""
    payload = {
        "text": "The road to our village PHC is broken and the health centre has had no doctor for two months.",
        "user_id": "usr-test-dual"
    }
    res = client.post("/requests/submit", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["area_type"] == "rural"
    assert "roads" in data["categories"]
    assert "healthcare_access" in data["categories"]


def test_urban_multi_label_roads_traffic_submission():
    """Primary Bug Regression: Outer Ring Road Silk Board potholes + traffic jams."""
    payload = {
        "text": "Outer Ring Road near Silk Board Junction has massive crater potholes causing 2-hour daily traffic jams and dangerous accidents for two-wheelers.",
        "user_id": "usr-test-silkboard"
    }
    res = client.post("/requests/submit", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["area_type"] == "urban"
    assert "roads" in data["categories"]
    assert "traffic" in data["categories"]
    assert len(data["categories"]) >= 2
    assert data["urgency"] == "high"


def test_public_feed_and_support_threshold():
    """Test public feed listing and support increment."""
    import time
    feed_res = client.get("/public/feed")
    assert feed_res.status_code == 200
    feed_data = feed_res.json()
    assert "issues" in feed_data
    assert len(feed_data["issues"]) > 0

    target_id = feed_data["issues"][0]["id"]
    initial_supports = feed_data["issues"][0]["support_count"]

    # Authenticate fresh citizen first (support endpoint is auth-gated & duplicate-checked per citizen)
    phone = f"99{int(time.time()*1000) % 100000000:08d}"
    auth_res = client.post("/auth/verify-otp", json={"phone_number": phone, "otp": "123456", "name": "Test Supporter", "email": "supporter@example.com"})
    assert auth_res.status_code == 200
    cit_token = auth_res.json()["token"]

    # Upvote by 1
    sup_res = client.post(
        f"/public/issues/{target_id}/support",
        headers={"Authorization": f"Bearer {cit_token}"}
    )
    assert sup_res.status_code == 200
    assert sup_res.json()["support_count"] == initial_supports + 1


def test_officials_portal_and_hotspots_calculation():
    """Test official login, hotspot calculation, and status update."""
    # 1. Official login
    login_res = client.post("/officials/login", json={"official_id": "admin", "password": "civic2026"})
    assert login_res.status_code == 200
    login_data = login_res.json()
    assert login_data["official"]["name"] == "Dr. Rajeshwar Rao, IAS"
    assert login_data["official"]["level"] == "national"
    token = login_data["token"]

    # 2. Get Hotspots with Priority Score calculation
    hotspots_res = client.get(f"/officials/hotspots?token={token}")
    assert hotspots_res.status_code == 200
    hotspots = hotspots_res.json()
    assert len(hotspots) > 0

    top_hotspot = hotspots[0]
    assert "priority_score" in top_hotspot
    assert "formula_breakdown" in top_hotspot
    assert top_hotspot["priority_score"] > 0

    # 3. Status update
    complaint_id = top_hotspot["complaints"][0]["id"]
    status_res = client.patch(f"/officials/complaints/{complaint_id}/status?token={token}", json={"status": "in_progress"})
    assert status_res.status_code == 200
    assert status_res.json()["new_status"] == "in_progress"


def test_officials_server_side_scope_enforcement_part_d():
    """Part D: Verify district officer cannot pull data outside their assigned district."""
    # 1. Login as Varanasi District Officer
    login_res = client.post("/officials/login", json={"official_id": "dm_varanasi", "password": "varanasi2026"})
    assert login_res.status_code == 200
    v_token = login_res.json()["token"]

    # 2. Attempt to request Delhi data with dm_varanasi token -> server overrides to Varanasi
    dash_res = client.get(f"/officials/dashboard-data?token={v_token}&drill_state=Delhi")
    assert dash_res.status_code == 200
    dash_data = dash_res.json()

    # All returned complaints must belong exclusively to Varanasi
    for c in dash_data["complaints"]:
        assert c["district"] == "Varanasi"
        assert c["state"] == "Uttar Pradesh"
