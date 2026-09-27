import React from 'react';

export default function Footer({ setCurrentTab, onOpenReport, onSwitchFeed }) {
  const year = new Date().getFullYear();

  const handleReportClick = () => {
    if (setCurrentTab) setCurrentTab('studio');
    if (onOpenReport) onOpenReport();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      const el = document.getElementById('report-section') || document.getElementById('complaint-form-card');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  const handleFeedClick = () => {
    if (setCurrentTab) setCurrentTab('feed');
    if (onSwitchFeed) onSwitchFeed();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer style={{
      background: 'var(--ice)',
      borderTop: '1px solid var(--line)',
      padding: '28px 6% 35px',
      marginTop: 'auto',
      marginBottom: '7px'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: '20px',
      }}>

        {/* ── Left: Brand ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '160px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '20px', height: '20px', flexShrink: 0
            }}>
              <svg viewBox="0 0 26 26" fill="none" width="20" height="20">
                <circle cx="13" cy="13" r="11" stroke="#1656e0" strokeWidth="1.8" />
                <circle cx="13" cy="13" r="4.5" fill="#1656e0" />
              </svg>
            </span>
            <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--navy)', letterSpacing: '-0.01em' }}>
              CivicLens
            </span>
          </div>
          <div style={{ fontSize: '14px', color: 'var(--navy-soft)', lineHeight: 1.5, maxWidth: '240px' }}>
            Civic infrastructure intelligence for India.
          </div>
        </div>

        {/* ── Centre: Quick links ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--navy-soft)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
            Quick Links
          </div>
          <button
            type="button"
            id="footer-link-report"
            onClick={handleReportClick}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: '14.5px', color: 'var(--navy-soft)', textAlign: 'left',
              fontFamily: 'inherit', transition: 'color 0.15s ease',
            }}
            onMouseEnter={e => e.target.style.color = 'var(--blue)'}
            onMouseLeave={e => e.target.style.color = 'var(--navy-soft)'}
          >
            Report an Issue
          </button>
          <button
            type="button"
            id="footer-link-feed"
            onClick={handleFeedClick}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: '14.5px', color: 'var(--navy-soft)', textAlign: 'left',
              fontFamily: 'inherit', transition: 'color 0.15s ease',
            }}
            onMouseEnter={e => e.target.style.color = 'var(--blue)'}
            onMouseLeave={e => e.target.style.color = 'var(--navy-soft)'}
          >
            Public Issues
          </button>
        </div>

        {/* ── Right: Credits ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-end', textAlign: 'right', minWidth: '200px' }}>
          <div style={{ fontSize: '14px', color: 'var(--navy-soft)' }}>
            © {year} CivicLens
          </div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--navy-soft)' }}>
            Built by Srinivas, Uday and Surendra.
          </div>
        </div>

      </div>
    </footer>
  );
}
