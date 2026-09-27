// In production on Vercel, use relative paths ("") so all API calls hit the same domain seamlessly.
// In local development, respect VITE_API_URL or fallback to "http://localhost:8000".
const API_BASE_URL = (import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== "")
  ? import.meta.env.VITE_API_URL
  : (import.meta.env.PROD ? "" : "http://localhost:8000");

/**
 * CivicLens Unified API Client
 */
export const api = {
  // Citizen Email/Password Authentication
  async citizenSignUp(name, email, password) {
    const res = await fetch(`${API_BASE_URL}/auth/citizen/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Registration failed" }));
      throw new Error(err.detail || "Registration failed. Please check your details.");
    }
    return res.json();
  },

  async citizenLogin(email, password) {
    const res = await fetch(`${API_BASE_URL}/auth/citizen/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Login failed" }));
      throw new Error(err.detail || "We couldn't sign you in with those credentials.");
    }
    return res.json();
  },

  async citizenGoogleAuth(email, name = null, uid = null, idToken = null) {
    const res = await fetch(`${API_BASE_URL}/auth/citizen/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, uid, id_token: idToken })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Google sign-in failed" }));
      throw new Error(err.detail || "Google sign-in could not be completed.");
    }
    return res.json();
  },

  async forgotPassword(email) {
    const res = await fetch(`${API_BASE_URL}/auth/citizen/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Request failed" }));
      throw new Error(err.detail || "Failed to dispatch password reset link.");
    }
    return res.json();
  },

  // Citizen Phone Auth (SMS)
  async sendOtp(phoneNumber) {
    const res = await fetch(`${API_BASE_URL}/auth/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: phoneNumber })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Failed to send OTP" }));
      throw new Error(err.detail || "Failed to send OTP");
    }
    return res.json();
  },

  async verifyOtp(phoneNumber, otp, name) {
    const res = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: phoneNumber, otp, name })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Invalid OTP" }));
      throw new Error(err.detail || "Invalid OTP code.");
    }
    return res.json();
  },

  // Government Officials Authentication (4-Tier)
  async officialLogin(officialId, password) {
    const res = await fetch(`${API_BASE_URL}/officials/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ official_id: officialId, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Invalid official credentials" }));
      throw new Error(err.detail || "Invalid official credentials. Please check your ID and password.");
    }
    return res.json();
  },

  // Complaint Analysis (Step 3 - Review before persistence)
  async analyzeComplaint(text, state, district, locality, manualCategories = []) {
    const res = await fetch(`${API_BASE_URL}/requests/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        state,
        district,
        locality,
        manual_categories: manualCategories
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Analysis failed" }));
      throw new Error(err.detail || "Failed to analyze complaint with Gemini AI");
    }
    return res.json();
  },

  // Complaint Submission via Gemini + Citizen-Confirmed Categories (Step 5)
  async submitComplaint(text, userId, state, district, locality, confirmedCategories = null, manualCategories = []) {
    const res = await fetch(`${API_BASE_URL}/requests/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        user_id: userId,
        state,
        district,
        locality,
        confirmed_categories: confirmedCategories,
        manual_categories: manualCategories
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Submission failed" }));
      throw new Error(err.detail || "Failed to submit complaint");
    }
    return res.json();
  },

  // Fetch Complaints
  async getComplaints(filters = {}) {
    const params = new URLSearchParams();
    if (filters.area_type) params.append("area_type", filters.area_type);
    if (filters.category) params.append("category", filters.category);
    if (filters.urgency) params.append("urgency", filters.urgency);
    if (filters.state) params.append("state", filters.state);
    if (filters.district) params.append("district", filters.district);
    if (filters.locality) params.append("locality", filters.locality);
    if (filters.search) params.append("search", filters.search);

    const res = await fetch(`${API_BASE_URL}/requests?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch complaints");
    return res.json();
  },

  // Public Feed & Support
  async getPublicFeed(filters = {}) {
    const params = new URLSearchParams();
    if (filters.area_type) params.append("area_type", filters.area_type);
    if (filters.category) params.append("category", filters.category);
    if (filters.state) params.append("state", filters.state);
    if (filters.sort_by) params.append("sort_by", filters.sort_by);

    const res = await fetch(`${API_BASE_URL}/public/feed?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch public feed");
    return res.json();
  },

  // Auth-aware support: requires citizen session token, server enforces one-vote-per-user
  async supportIssue(complaintId, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE_URL}/public/issues/${complaintId}/support`, {
      method: 'POST',
      headers,
      body: JSON.stringify({})
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Support failed' }));
      throw new Error(err.detail || 'Failed to record support');
    }
    return res.json();
  },

  // Officials Portal Dashboard Data & Hotspots
  async getDashboardData(token, drillState = null, drillDistrict = null) {
    const params = new URLSearchParams();
    if (token) params.append("token", token);
    if (drillState) params.append("drill_state", drillState);
    if (drillDistrict) params.append("drill_district", drillDistrict);

    const res = await fetch(`${API_BASE_URL}/officials/dashboard-data?${params.toString()}`, {
      headers: token ? { "Authorization": `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error("Failed to fetch dashboard data");
    return res.json();
  },

  async getHotspots(token = null, filters = {}) {
    const params = new URLSearchParams();
    if (token) params.append("token", token);
    if (filters.state) params.append("state", filters.state);
    if (filters.district) params.append("district", filters.district);
    if (filters.category) params.append("category", filters.category);
    if (filters.area_type) params.append("area_type", filters.area_type);

    const res = await fetch(`${API_BASE_URL}/officials/hotspots?${params.toString()}`, {
      headers: token ? { "Authorization": `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error("Failed to fetch hotspots matrix");
    return res.json();
  },

  async updateComplaintStatus(complaintId, status) {
    const res = await fetch(`${API_BASE_URL}/officials/complaints/${complaintId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error("Failed to update status");
    return res.json();
  },

  // Officials: map data for choropleth (distinct complaint counts per region)
  async getMapData(token) {
    const params = new URLSearchParams();
    if (token) params.append('token', token);
    const res = await fetch(`${API_BASE_URL}/officials/map-data?${params.toString()}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error('Failed to fetch map data');
    return res.json();
  },

  // Citizen: fetch own submitted issues
  async getMyIssues(userId) {
    const res = await fetch(`${API_BASE_URL}/requests/citizen/my-issues?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error("Failed to fetch your issues");
    return res.json();
  },

  // Health Check
  async checkHealth() {
    const res = await fetch(`${API_BASE_URL}/api/health`);
    if (!res.ok) throw new Error("Health check failed");
    return res.json();
  }
};
