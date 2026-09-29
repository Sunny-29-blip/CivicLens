import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, MicOff, Send, Sparkles, AlertCircle, CheckCircle2, 
  MapPin, Gauge, Layers, FileText, ArrowRight, RefreshCw,
  Languages, AlertTriangle, Plus, X, ShieldAlert, Check
} from 'lucide-react';
import { api } from '../services/api';

const SAMPLE_PROMPTS_POOL = [
  {
    label: "Urban Bangalore — Roads + Traffic",
    text: "Outer Ring Road near Silk Board Junction has massive crater potholes causing 2-hour daily traffic jams and dangerous accidents for two-wheelers.",
    state: "Karnataka",
    district: "Bengaluru Urban",
    locality: "Silk Board"
  },
  {
    label: "Urban Hyderabad — Water + Pollution",
    text: "Garbage has been dumped around the public water source in Kukatpally, Hyderabad, Telangana and the water is becoming unsafe to drink.",
    state: "Telangana",
    district: "Hyderabad",
    locality: "Kukatpally"
  },
  {
    label: "Rural UP (Hindi) — Transformer + Irrigation",
    text: "Hamare Rampur gaon mein 3 hafte se transformer jala hua hai. Fasal suk rahi hai aur tube well nahi chal pa rahe.",
    state: "Uttar Pradesh",
    district: "Varanasi",
    locality: "Rampur"
  },
  {
    label: "Rural Bihar — Roads + Health Access",
    text: "The road to our village PHC in Phulparas is broken with deep mud and the health centre has had no doctor for two months.",
    state: "Bihar",
    district: "Madhubani",
    locality: "Phulparas"
  },
  {
    label: "Urban Delhi — Pollution + Sanitation",
    text: "Severe industrial waste burning and blocked open storm drains in Okhla Phase 2 causing toxic smog and respiratory issues for local residents.",
    state: "Delhi",
    district: "Delhi",
    locality: "Okhla"
  },
  {
    label: "Rural Maharashtra — Drought + Power",
    text: "Amchya gaavat 10 divasapasun vij puravatha band ahe, shetitalya panipuryavthyala motha phatka basla ahe.",
    state: "Maharashtra",
    district: "Pune",
    locality: "Baramati"
  },
  {
    label: "Urban Chennai — Roads + Water Shortage",
    text: "Metro water pipelines ruptured during road widening in Velachery, leaving residential blocks without municipal drinking water for 5 days.",
    state: "Tamil Nadu",
    district: "Chennai",
    locality: "Velachery"
  },
  {
    label: "Rural Rajasthan — Network + Healthcare",
    text: "No mobile network connectivity in Pokhran rural belt for 2 weeks, preventing villagers from booking emergency ambulances and telehealth consultations.",
    state: "Rajasthan",
    district: "Jaisalmer",
    locality: "Pokhran"
  },
  {
    label: "Urban Kolkata — Waste Dumping + Drainage",
    text: "Severe municipal garbage accumulation and waterlogging around Gariahat market following monsoon rain, creating severe public health hazard.",
    state: "West Bengal",
    district: "Kolkata",
    locality: "Gariahat"
  },
  {
    label: "Rural Punjab — Canal Gate + Power Cut",
    text: "Canal distributary breach in Khanna block flooding standing wheat crop while frequent 12-hour unscheduled power cuts prevent drainage pumps from operating.",
    state: "Punjab",
    district: "Ludhiana",
    locality: "Khanna"
  }
];

const CANONICAL_CATEGORIES = [
  { id: "roads", label: "Roads & Potholes", area: "both" },
  { id: "traffic", label: "Traffic Congestion", area: "urban" },
  { id: "electricity", label: "Electricity & Power", area: "both" },
  { id: "water_shortage", label: "Water Supply & Shortage", area: "urban" },
  { id: "pollution", label: "Pollution & Waste Dumping", area: "urban" },
  { id: "infra_quality", label: "Infrastructure Quality", area: "urban" },
  { id: "road_expansion", label: "Road Expansion Work", area: "urban" },
  { id: "irrigation_water", label: "Irrigation & Canals", area: "rural" },
  { id: "healthcare_access", label: "Healthcare & PHC Access", area: "rural" },
  { id: "network_coverage", label: "Mobile Network Coverage", area: "rural" }
];

const CANONICAL_STATES = [
  "Delhi", "Karnataka", "Telangana", "Uttar Pradesh", "Maharashtra",
  "Bihar", "Rajasthan", "Haryana", "Tamil Nadu", "West Bengal",
  "Gujarat", "Kerala", "Madhya Pradesh", "Andhra Pradesh", "Punjab", "Odisha"
];

const VOICE_LANGUAGES = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'हिन्दी (Hindi)' },
  { code: 'ur-IN', label: 'اردو (Urdu)' },
  { code: 'gu-IN', label: 'ગુજરાતી (Gujarati)' },
  { code: 'as-IN', label: 'অসমীয়া (Assamese)' },
  // Note: Bhojpuri has no separate standard Web Speech API locale; hi-IN is used as the closest transcription acoustic model fallback.
  { code: 'hi-IN', label: 'भोजपुरी (Bhojpuri)' },
  { code: 'ml-IN', label: 'മലയാളം (Malayalam)' },
  { code: 'te-IN', label: 'తెలుగు (Telugu)' },
  { code: 'ta-IN', label: 'தமிழ் (Tamil)' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ (Kannada)' },
  { code: 'bn-IN', label: 'বাংলা (Bengali)' },
  { code: 'mr-IN', label: 'मराठी (Marathi)' }
];

const PROGRESS_STEPS = [
  "Analyzing complaint text...",
  "Understanding language & context...",
  "Identifying multi-label civic issues...",
  "Verifying canonical jurisdiction...",
  "Calculating 0–100 priority score..."
];

export default function ComplaintStudio({ session, onRequireAuth, onViewInFeed, onNavigateToFeed }) {
  const [text, setText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [voiceLang, setVoiceLang] = useState('en-IN');
  const [state, setState] = useState('Karnataka');
  const [district, setDistrict] = useState('Bengaluru Urban');
  const [locality, setLocality] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  
  // Loading & 5-step progress
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [error, setError] = useState('');

  // Analysis result and editable categories
  const [analyzedData, setAnalyzedData] = useState(null);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [aiCategories, setAiCategories] = useState([]);
  const [manualCategories, setManualCategories] = useState([]);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [submittedDoc, setSubmittedDoc] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activePrompts] = useState(() => {
    return [...SAMPLE_PROMPTS_POOL].sort(() => 0.5 - Math.random()).slice(0, 4);
  });

  const recognitionRef = useRef(null);

  const initSpeechRecognition = (lang) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event) => {
      let finalChunk = '';
      let liveInterim = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalChunk += event.results[i][0].transcript + ' ';
        } else {
          liveInterim += event.results[i][0].transcript;
        }
      }

      if (finalChunk) {
        setText((prev) => (prev ? `${prev.trim()} ${finalChunk.trim()}` : finalChunk.trim()));
      }
      setInterimText(liveInterim);
    };

    recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      setIsRecording(false);
      setInterimText('');
    };

    recognition.onend = () => {
      setIsRecording(false);
      setInterimText('');
    };

    return recognition;
  };

  // Initialize browser speech recognition engine on mount
  useEffect(() => {
    recognitionRef.current = initSpeechRecognition(voiceLang);
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* noop on teardown */ }
      }
    };
  }, [voiceLang]);

  // Handle runtime microphone language change
  const handleLanguageChange = (newLang) => {
    setVoiceLang(newLang);
    const wasRecording = isRecording;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* noop */ }
    }
    const newRec = initSpeechRecognition(newLang);
    recognitionRef.current = newRec;
    if (wasRecording && newRec) {
      try {
        newRec.start();
        setIsRecording(true);
      } catch { /* noop */ }
    }
  };

  // Toggle microphone dictation state
  const toggleRecording = () => {
    if (!speechSupported) {
      alert('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isRecording) {
      try { recognitionRef.current?.stop(); } catch { /* noop */ }
      setIsRecording(false);
      setInterimText('');
    } else {
      try {
        if (!recognitionRef.current) {
          recognitionRef.current = initSpeechRecognition(voiceLang);
        }
        recognitionRef.current?.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Failed to start speech recognition:', err);
      }
    }
  };

  const handleApplyPrompt = (prompt) => {
    setText(prompt.text);
    if (prompt.state) setState(prompt.state);
    if (prompt.district) setDistrict(prompt.district);
    if (prompt.locality) setLocality(prompt.locality);
  };

  // Step 3: Analyze with Gemini
  const handleAnalyze = async (e) => {
    if (e) e.preventDefault();
    if (!text.trim() || text.trim().length < 5) {
      setError('Please write or speak at least a short description of the issue.');
      return;
    }

    setError('');
    setLoading(true);
    setProgressStep(0);
    setAnalyzedData(null);
    setSubmittedDoc(null);

    // Progress animation intervals
    const interval = setInterval(() => {
      setProgressStep((prev) => (prev < 4 ? prev + 1 : prev));
    }, 450);

    try {
      const result = await api.analyzeComplaint(
        text,
        state,
        district,
        locality,
        manualCategories
      );
      clearInterval(interval);
      setProgressStep(4);
      setAnalyzedData(result);
      setSelectedCategories(result.categories || []);
      setAiCategories(result.ai_categories || []);
      setManualCategories(result.manual_categories || []);
    } catch (err) {
      clearInterval(interval);
      setError(err.message || 'Failed to analyze complaint.');
    } finally {
      setLoading(false);
    }
  };

  // Category chip removal
  const handleRemoveCategory = (catToRemove) => {
    if (selectedCategories.length <= 1) {
      alert("An issue must have at least 1 civic category.");
      return;
    }
    const updated = selectedCategories.filter((c) => c !== catToRemove);
    setSelectedCategories(updated);
    setManualCategories((prev) => prev.filter((c) => c !== catToRemove));
  };

  // Manual category addition
  const handleAddCategory = (categoryKey) => {
    if (selectedCategories.includes(categoryKey)) return;
    if (selectedCategories.length >= 3) {
      alert("Maximum 3 categories allowed per issue.");
      return;
    }
    const updated = [...selectedCategories, categoryKey];
    setSelectedCategories(updated);
    if (!manualCategories.includes(categoryKey) && !aiCategories.includes(categoryKey)) {
      setManualCategories((prev) => [...prev, categoryKey]);
    }
    setShowCategoryPicker(false);
  };

  // Final submission to Firestore
  const handleFinalSubmit = async () => {
    if (!text.trim()) return;
    setIsSubmitting(true);
    setError('');

    const userId = session?.profile ? session.profile.user_id : 'guest-citizen';

    try {
      const result = await api.submitComplaint(
        text,
        userId,
        analyzedData?.state || state,
        analyzedData?.district || district,
        analyzedData?.locality || locality,
        selectedCategories,
        manualCategories,
        analyzedData
      );
      setSubmittedDoc(result);
    } catch (err) {
      setError(err.message || 'Failed to submit issue.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setText('');
    setInterimText('');
    setAnalyzedData(null);
    setSelectedCategories([]);
    setAiCategories([]);
    setManualCategories([]);
    setSubmittedDoc(null);
    setError('');
  };

  return (
    <div>
      {/* ============ 1. 100VH FULL HERO LANDING SECTION ============ */}
      <div className="hero-landing-wrapper">
        <section className="hero">
          <div className="hero-grid">
            <div>
              <div className="eyebrow">
                <span className="dot"></span>
                <span>AI for Digital Public Infrastructure & Governance</span>
              </div>
              <h1>Report <span>Your Issue</span></h1>
              <p>
                CivicLens combines Google Gemini multilingual intelligence with deterministic jurisdiction verification to classify compound civic issues, eliminate hallucinations, and compute explainable 0–100 governance priority scores.
              </p>
              <div className="hero-actions">
                <a 
                  href="#report-section" 
                  onClick={(e) => { 
                    e.preventDefault(); 
                    document.getElementById('report-section')?.scrollIntoView({ behavior: 'smooth' }); 
                  }}
                  className="btn-primary"
                >
                  Open the lens
                </a>
                <button 
                  type="button" 
                  onClick={onNavigateToFeed}
                  className="btn-secondary"
                >
                  Explore Public Feed →
                </button>
              </div>
              <div className="hero-stats">
                <div>
                  <div className="stat-num">100%</div>
                  <div className="stat-label">Multi-Category Ingestion</div>
                </div>
                <div>
                  <div className="stat-num">24/7</div>
                  <div className="stat-label">Multilingual Voice Intake</div>
                </div>
                <div>
                  <div className="stat-num">0–100</div>
                  <div className="stat-label">Explainable Priority Index</div>
                </div>
              </div>
            </div>

            {/* Spectacles Graphic SVG */}
            <div className="specs-wrap">
              <div className="specs-graphic">
                <svg viewBox="0 0 320 150" fill="none">
                  <defs>
                    <linearGradient id="glass" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#ffffff" />
                      <stop offset="35%" stopColor="#bfe0ff" />
                      <stop offset="70%" stopColor="#1656e0" />
                      <stop offset="100%" stopColor="#3fc7ff" />
                    </linearGradient>
                    <clipPath id="clipLeft"><rect x="36" y="42" width="92" height="68" rx="28" /></clipPath>
                    <clipPath id="clipRight"><rect x="192" y="42" width="92" height="68" rx="28" /></clipPath>
                  </defs>

                  {/* Temple Arms */}
                  <path d="M40 56 L-14 30" stroke="#0a2e86" strokeWidth="7" strokeLinecap="round" />
                  <circle cx="40" cy="56" r="6.5" fill="#1656e0" />
                  <path d="M280 56 L334 30" stroke="#0a2e86" strokeWidth="7" strokeLinecap="round" />
                  <circle cx="280" cy="56" r="6.5" fill="#1656e0" />

                  {/* Bridge */}
                  <path d="M128 58 Q160 46 192 58" stroke="#0a2e86" strokeWidth="7" strokeLinecap="round" />

                  {/* Left Lens */}
                  <g>
                    <rect x="36" y="42" width="92" height="68" rx="28" fill="url(#glass)" transform="rotate(-4 82 76)" />
                    <rect x="36" y="42" width="92" height="68" rx="28" fill="none" stroke="#0a2e86" strokeWidth="7" transform="rotate(-4 82 76)" />
                    <rect className="specs-shine" x="46" y="30" width="24" height="90" rx="12" fill="#ffffff" clipPath="url(#clipLeft)" />
                  </g>

                  {/* Right Lens */}
                  <g>
                    <rect x="192" y="42" width="92" height="68" rx="28" fill="url(#glass)" transform="rotate(4 238 76)" />
                    <rect x="192" y="42" width="92" height="68" rx="28" fill="none" stroke="#0a2e86" strokeWidth="7" transform="rotate(4 238 76)" />
                    <rect className="specs-shine right" x="250" y="30" width="24" height="90" rx="12" fill="#ffffff" clipPath="url(#clipRight)" />
                  </g>
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* ============ FEATURE / CAPABILITY STRIP ============ */}
        <div className="trust-strip">
          <div className="trust-track">
            <span>Urban & Rural Taxonomies</span><span className="dot-sep">✦</span>
            <span>Multi-Category Detection</span><span className="dot-sep">✦</span>
            <span>Canonical Jurisdiction System</span><span className="dot-sep">✦</span>
            <span>Google Gemini Structured AI</span><span className="dot-sep">✦</span>
            <span>Explainable 0–100 Priority</span><span className="dot-sep">✦</span>
            <span>4-Tier Governance Scoping</span><span className="dot-sep">✦</span>
            <span>Citizen Verification & Edits</span><span className="dot-sep">✦</span>
            <span>Urban & Rural Taxonomies</span><span className="dot-sep">✦</span>
            <span>Multi-Category Detection</span><span className="dot-sep">✦</span>
            <span>Canonical Jurisdiction System</span><span className="dot-sep">✦</span>
          </div>
        </div>
      </div>

      {/* ============ 2. REPORT INFRASTRUCTURE ISSUE (BELOW THE FOLD) ============ */}
      <div id="report-section">
        <div className="section-header">
          <h2>Submit Infrastructure Issue</h2>
          <p>
            Report local roads, power disruptions, water shortages, or health access issues. Gemini AI will extract multiple civic categories and evaluate governance priority.
          </p>
        </div>

        {/* Auth Gate — shown when NOT signed in as citizen */}
        {(!session || session.role !== 'citizen') ? (
          <div style={{
            maxWidth: '560px',
            margin: '0 auto 48px',
            background: 'var(--ice)',
            border: '1.5px dashed var(--sky)',
            borderRadius: 'var(--radius-md)',
            padding: '48px 36px',
            textAlign: 'center',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: 'var(--white)', border: '1px solid var(--sky)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 18px', color: 'var(--blue)'
            }}>
              <ShieldAlert size={28} />
            </div>
            <h3 style={{ fontSize: '20px', margin: '0 0 10px', color: 'var(--navy)' }}>
              Sign in to report an issue
            </h3>
            <p style={{ fontSize: '13.5px', color: 'var(--navy-soft)', margin: '0 auto 24px', maxWidth: '360px', lineHeight: '1.6' }}>
              You need a verified citizen account to submit an issue. Your identity helps officials respond to the right person and location.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={onRequireAuth}
              style={{ margin: '0 auto', justifyContent: 'center', fontSize: '14px', padding: '12px 28px' }}
            >
              <ArrowRight size={16} />
              <span>Sign In to Report</span>
            </button>
          </div>
        ) : (
          <div className="studio-layout">
            {/* Left Form Card */}
            <div className="studio-card">
            <div className="studio-header">
              <div className="studio-title">
                <FileText size={20} color="var(--blue)" />
                <span>Issue Description</span>
              </div>
              
              {session?.role === 'citizen' ? (
                <span style={{ fontSize: '12px', color: 'var(--emerald)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span className="live-status-dot" /> Logged in as {session.profile.name}
                </span>
              ) : (
                <button 
                  type="button" 
                  onClick={onRequireAuth} 
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--blue)',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  + Link Mobile Phone
                </button>
              )}
            </div>

            {error && (
              <div style={{
                background: 'var(--rose-bg)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: 'var(--rose)',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '13px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleAnalyze}>
              {/* Voice Recording Control Bar */}
              <div className="voice-panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    type="button"
                    onClick={toggleRecording}
                    className={`mic-btn ${isRecording ? 'listening' : ''}`}
                    title={isRecording ? 'Stop recording' : 'Click to dictate complaint'}
                  >
                    {isRecording ? <MicOff size={22} /> : <Mic size={22} />}
                  </button>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--navy)' }}>
                      {isRecording ? 'Listening now...' : 'Voice Dictation'}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--navy-soft)' }}>
                      {isRecording ? 'Speak clearly into your microphone' : 'Select language and tap mic to speak'}
                    </div>
                  </div>
                </div>

                {/* Language Selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Languages size={16} color="var(--navy-soft)" />
                  <select
                    value={voiceLang}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="select-input"
                    style={{ fontSize: '14px', padding: '6px 12px', background: 'var(--white)' }}
                  >
                    {VOICE_LANGUAGES.map((lang, idx) => (
                      <option key={`${lang.code}-${idx}`} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>

                  {/* Animated Waveform */}
                  <div className="voice-wave" style={{ marginLeft: '4px' }}>
                    <div className={`wave-bar ${isRecording ? 'active' : ''}`}></div>
                    <div className={`wave-bar ${isRecording ? 'active' : ''}`}></div>
                    <div className={`wave-bar ${isRecording ? 'active' : ''}`}></div>
                    <div className={`wave-bar ${isRecording ? 'active' : ''}`}></div>
                  </div>
                </div>
              </div>

              {/* Speech engine note without emoji */}
              <div style={{ fontSize: '12px', color: 'var(--navy-soft)', margin: '-6px 0 14px 4px', fontStyle: 'normal', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>Voice accuracy for regional languages depends on browser/OS speech recognition engines (English & Hindi offer highest fidelity).</span>
              </div>

              {/* Textarea */}
              <div className="textarea-container">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Describe the problem in English, Hindi, Telugu, or any regional language (e.g. massive potholes near Silk Board causing daily traffic jams, or burnt transformer in Rampur village)..."
                  className="complaint-textarea"
                  rows={4}
                />
                
                {interimText && (
                  <div style={{
                    fontSize: '12.5px',
                    color: 'var(--navy-soft)',
                    background: 'var(--ice)',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    marginTop: '4px',
                    fontStyle: 'italic',
                    border: '1px dashed var(--sky)'
                  }}>
                    🎙️ Dictating: "{interimText}..."
                  </div>
                )}

                <div className="textarea-footer">
                  <span>{text.length} characters</span>
                  <span>Gemini Understands Multi-Issue Complaints</span>
                </div>
              </div>

              {/* Quick Prompts for Hackathon Demo */}
              <div className="quick-prompts">
                <div className="quick-prompts-label">
                  <Sparkles size={13} color="var(--blue)" />
                  <span>Interactive Hackathon Test Cases:</span>
                </div>
                <div className="prompt-chips">
                  {activePrompts.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="prompt-chip"
                      onClick={() => handleApplyPrompt(p)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Canonical State & District Selectors */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px', marginBottom: '20px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: 'var(--navy-soft)', marginBottom: '4px' }}>
                    State / UT Hint (Authoritative)
                  </label>
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="select-input"
                    style={{ width: '100%' }}
                  >
                    {CANONICAL_STATES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: 'var(--navy-soft)', marginBottom: '4px' }}>
                    District / Locality Hint
                  </label>
                  <input
                    type="text"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    placeholder="e.g. Hyderabad, Bengaluru Urban, Varanasi"
                    className="select-input"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Analyze Button */}
              <button
                type="submit"
                disabled={loading}
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: '14.5px' }}
              >
                {loading ? (
                  <>
                    <RefreshCw size={17} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                    <span>Analyzing with Gemini AI...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={17} />
                    <span>Analyze with Gemini & Review</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Right Result / Review / Final Submission Card */}
          {loading ? (
            /* 5-Step Progress Card */
            <div className="analyzing-progress-card">
              <RefreshCw size={32} color="var(--blue)" style={{ animation: 'spin 1.2s linear infinite', margin: '0 auto 12px' }} />
              <h3 style={{ fontSize: '17px', margin: '0 0 4px', color: 'var(--navy)' }}>
                Gemini AI Pipeline Active
              </h3>
              <p style={{ fontSize: '12.5px', color: 'var(--navy-soft)', margin: 0 }}>
                Processing multimodal civic intelligence...
              </p>

              <div className="step-indicator-list">
                {PROGRESS_STEPS.map((step, idx) => {
                  const isDone = idx < progressStep;
                  const isCurrent = idx === progressStep;
                  return (
                    <div 
                      key={idx} 
                      className={`step-indicator-item ${isDone ? 'completed' : isCurrent ? 'active' : ''}`}
                    >
                      <div className="step-indicator-dot">
                        {isDone ? <Check size={10} strokeWidth={3} /> : idx + 1}
                      </div>
                      <span>{step}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : analyzedData ? (
            /* Structured Result & Category Editor */
            <div className="result-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                {analyzedData.classified_by === 'heuristic_fallback' ? (
                  <div style={{
                    background: 'var(--amber-bg)',
                    border: '1px solid var(--amber)',
                    color: '#b45309',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}>
                    <AlertTriangle size={13} />
                    <span>Local Fallback Classifier Active</span>
                  </div>
                ) : (
                  <div className="result-badge">
                    <CheckCircle2 size={14} color="var(--blue)" />
                    <span>Google Gemini AI Analyzed</span>
                  </div>
                )}

                <span style={{ fontSize: '11.5px', color: 'var(--navy-soft)' }}>
                  Language: <strong>{analyzedData.original_language}</strong>
                </span>
              </div>

              {/* 0–100 Priority Score Banner */}
              <div className="priority-score-box">
                <div className="priority-score-header">
                  <span style={{ fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.9 }}>
                    Governance Priority Index
                  </span>
                  <div className="priority-score-val">
                    {analyzedData.priority_score} / 100
                  </div>
                </div>
                <div className="priority-score-reason">
                  {analyzedData.priority_reason}
                </div>
              </div>

              {/* Area & Location Information */}
              <div className="result-grid">
                <div className="result-item">
                  <div className="result-label">Area Classification</div>
                  <div className="result-val">
                    <span className={`tag-area ${analyzedData.area_type === 'rural' ? 'tag-rural' : 'tag-urban'}`}>
                      {analyzedData.area_type === 'rural' ? 'Rural Area' : 'Urban Area'}
                    </span>
                  </div>
                </div>

                <div className="result-item">
                  <div className="result-label">Canonical Jurisdiction</div>
                  <div className="result-val">
                    <MapPin size={14} color="var(--rose)" />
                    <span style={{ fontSize: '13px' }}>
                      {analyzedData.district}, {analyzedData.state}
                    </span>
                  </div>
                </div>

                <div className="result-item" style={{ gridColumn: 'span 2' }}>
                  <div className="result-label">Urgency Assessment</div>
                  <div className="result-val">
                    <span className={`urgency-badge urgency-${analyzedData.urgency}`}>
                      <Gauge size={13} />
                      <span>{analyzedData.urgency.toUpperCase()} URGENCY</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Interactive Category Chips with Hover Removal */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--navy-soft)', textTransform: 'uppercase' }}>
                    Detected Categories ({selectedCategories.length}/3)
                  </span>
                  <button 
                    type="button" 
                    className="btn-add-category"
                    onClick={() => setShowCategoryPicker(!showCategoryPicker)}
                  >
                    <Plus size={13} />
                    <span>Add category</span>
                  </button>
                </div>

                {/* Category Chips Container */}
                <div className="category-chips-container">
                  {selectedCategories.map((catKey) => {
                    const isManual = manualCategories.includes(catKey);
                    const formattedName = catKey.replace(/_/g, ' ');
                    return (
                      <span 
                        key={catKey} 
                        className={`category-chip ${isManual ? 'manual' : ''}`}
                        title="Hover to reveal remove button"
                      >
                        <Layers size={13} />
                        <span>{formattedName}</span>
                        <span className="chip-source-tag">
                          {isManual ? 'Citizen' : 'AI'}
                        </span>
                        <button
                          type="button"
                          className="chip-remove-btn"
                          onClick={() => handleRemoveCategory(catKey)}
                          title={`Remove ${formattedName}`}
                          aria-label={`Remove ${formattedName}`}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    );
                  })}
                </div>

                {/* Category Picker Popover */}
                {showCategoryPicker && (
                  <div className="category-picker-modal">
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--navy-soft)', marginBottom: '8px' }}>
                      Select a civic category to add (Max 3 total):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {CANONICAL_CATEGORIES.map((cat) => {
                        const isSelected = selectedCategories.includes(cat.id);
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            disabled={isSelected}
                            className={`picker-category-btn ${isSelected ? 'selected' : ''}`}
                            onClick={() => handleAddCategory(cat.id)}
                          >
                            {isSelected ? '✓ ' : '+ '}{cat.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Summary Box */}
              <div className="summary-box">
                <div className="summary-title">One-Sentence English Summary</div>
                <div className="summary-text">{analyzedData.summary}</div>
              </div>

              {/* Submitted Confirmation or Final Submit Button */}
              {submittedDoc ? (
                <div style={{
                  background: 'var(--emerald-bg)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  padding: '14px',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '14px',
                  textAlign: 'center'
                }}>
                  <div style={{ color: '#047857', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <CheckCircle2 size={18} />
                    <span>Issue Recorded in Firestore!</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#065f46', marginTop: '4px' }}>
                    ID: <code>{submittedDoc.id}</code> · Priority Score: <strong>{submittedDoc.priority_score}/100</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '12px', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ padding: '8px 18px', fontSize: '13px' }}
                      onClick={() => onViewInFeed(submittedDoc.id)}
                    >
                      <span>View in Public Feed</span>
                      <ArrowRight size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '8px 16px', fontSize: '13px' }}
                      onClick={resetForm}
                    >
                      Report Another
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '10px', marginTop: 'auto' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={handleFinalSubmit}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                        <span>Saving to Firestore...</span>
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        <span>Confirm & Submit to Firestore</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={resetForm}
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Idle Placeholder */
            <div className="studio-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', background: 'var(--ice)', borderStyle: 'dashed' }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: 'var(--white)',
                border: '1px solid var(--sky)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 14px',
                color: 'var(--blue)'
              }}>
                <Sparkles size={26} />
              </div>
              <h3 style={{ fontSize: '17px', marginBottom: '6px' }}>
                AI Issue Analysis Studio
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--navy-soft)', maxWidth: '340px', margin: '0 auto 16px', lineHeight: '1.5' }}>
                Type or dictate your infrastructure issue on the left. Gemini will detect multiple civic categories, verify canonical location, compute an explainable 0–100 priority score, and let you edit category tags before final submission.
              </p>
              <div style={{ fontSize: '12px', color: 'var(--navy-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} color="var(--emerald)" />
                <span>Google Cloud Firestore & Gemini Active</span>
              </div>
            </div>
          )}
          </div>
        )}
      </div>
    </div>
  );
}
