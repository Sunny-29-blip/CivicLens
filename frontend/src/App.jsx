import React, { useState, useEffect, lazy, Suspense } from 'react';
import Navbar from './components/Navbar';
import UnifiedAuthModal from './components/UnifiedAuthModal';
import ComplaintStudio from './components/ComplaintStudio';
import Footer from './components/Footer';
import './App.css';

// Secondary views are code-split so the first page only downloads what it renders.
// The officials dashboard pulls in Recharts + the India map, which used to be bundled
// into the single 2.8 MB script every visitor had to download and parse up front.
const loadPublicFeed = () => import('./components/PublicFeed');
const loadOfficialsDashboard = () => import('./components/OfficialsDashboard');
const loadMyIssuesPage = () => import('./components/MyIssuesPage');
const PublicFeed = lazy(loadPublicFeed);
const OfficialsDashboard = lazy(loadOfficialsDashboard);
const MyIssuesPage = lazy(loadMyIssuesPage);

const ViewFallback = () => (
  <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navy-soft)', fontSize: '14px' }}>
    Loading…
  </div>
);

export default function App() {
  const [currentTab, setCurrentTab] = useState('studio'); // 'studio' | 'feed'
  
  // Single active session concept: { role: 'citizen' | 'official', profile: {...} } or null
  const [session, setSession] = useState(null);
  const [authModal, setAuthModal] = useState({ isOpen: false, mode: 'select' });
  const [highlightedIssueId, setHighlightedIssueId] = useState(null);

  // Load single persisted session on boot
  useEffect(() => {
    try {
      const stored = localStorage.getItem('civiclens_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && (parsed.role === 'citizen' || parsed.role === 'official')) {
          setSession(parsed);
        }
      }
    } catch (e) {
      console.warn('Could not read session from localStorage', e);
    }
  }, []);

  // Warm the other views' chunks once the first page is idle, so switching views is instant.
  useEffect(() => {
    const prefetch = () => {
      loadOfficialsDashboard();
      loadPublicFeed();
      loadMyIssuesPage();
    };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(prefetch, 1500);
    return () => clearTimeout(t);
  }, []);

  const handleOpenAuth = (mode = 'select') => {
    setAuthModal({ isOpen: true, mode });
  };

  const handleCloseAuth = () => {
    setAuthModal(prev => ({ ...prev, isOpen: false }));
  };

  // Citizen Login (sets authenticated citizen session)
  const handleCitizenAuthSuccess = (citizenData) => {
    const newSession = { role: 'citizen', profile: citizenData };
    setSession(newSession);
    localStorage.setItem('civiclens_session', JSON.stringify(newSession));
    handleCloseAuth();
  };

  // Official Login (sets authenticated 4-tier official session)
  const handleOfficialLoginSuccess = (officialProfile) => {
    const newSession = { role: 'official', profile: officialProfile };
    setSession(newSession);
    localStorage.setItem('civiclens_session', JSON.stringify(newSession));
    handleCloseAuth();
  };

  // Universal Logout (clears session & returns safely to public view)
  const handleLogout = () => {
    setSession(null);
    localStorage.removeItem('civiclens_session');
    setCurrentTab('studio');
  };

  const handleViewInFeed = (issueId) => {
    setHighlightedIssueId(issueId);
    setCurrentTab('feed');
    setTimeout(() => {
      const el = document.getElementById(`issue-${issueId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 200);
  };

  const isOfficial = session?.role === 'official';

  return (
    <div className="app-container" id="top">
      {/* Top Navigation */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        session={session}
        onOpenAuth={(mode) => handleOpenAuth(mode || 'select')}
        onLogout={handleLogout}
      />

      {/* Main View Area */}
      <main style={{ flex: 1 }}>
        <Suspense fallback={<ViewFallback />}>
        {/* If official is logged in: show ONLY officials dashboard */}
        {isOfficial ? (
          <OfficialsDashboard
            session={session}
            onLogout={handleLogout}
          />
        ) : (
          /* Citizen / Public Views */
          <>
            {currentTab === 'studio' && (
              <ComplaintStudio
                session={session}
                onRequireAuth={() => handleOpenAuth('citizen')}
                onViewInFeed={handleViewInFeed}
                onNavigateToFeed={() => setCurrentTab('feed')}
              />
            )}

            {currentTab === 'feed' && (
              <PublicFeed
                session={session}
                onOpenReport={() => setCurrentTab('studio')}
                onOpenAuth={() => handleOpenAuth('citizen')}
                highlightedId={highlightedIssueId}
              />
            )}

            {currentTab === 'my-issues' && (
              <MyIssuesPage
                session={session}
                onOpenReport={() => setCurrentTab('studio')}
              />
            )}
          </>
        )}
        </Suspense>
      </main>

      {/* Unified CivicLens Authentication Portal (Citizen & Official) */}
      <UnifiedAuthModal
        key={`${authModal.isOpen}-${authModal.mode}`}
        isOpen={authModal.isOpen}
        onClose={handleCloseAuth}
        initialMode={authModal.mode}
        onCitizenAuthSuccess={handleCitizenAuthSuccess}
        onOfficialAuthSuccess={handleOfficialLoginSuccess}
      />

      {/* Footer */}
      <Footer
        setCurrentTab={setCurrentTab}
        onOpenReport={() => setCurrentTab('studio')}
        onSwitchFeed={() => setCurrentTab('feed')}
      />
    </div>
  );
}
