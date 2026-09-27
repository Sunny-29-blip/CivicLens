import React, { useState, useEffect } from 'react';
import { CheckCircle2, ClipboardList } from 'lucide-react';
import { api } from '../services/api';

/* ─── My Reported Issues Page ────────────────────────────────────────────── */
export default function MyIssuesPage({ session, onOpenReport }) {
  const [myIssues, setMyIssues] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session?.role !== 'citizen' || !session?.profile?.user_id) return;
    setLoading(true);
    api.getMyIssues(session.profile.user_id)
      .then(setMyIssues)
      .catch(() => setMyIssues([]))
      .finally(() => setLoading(false));
  }, [session]);

  const STATUS_STYLES = {
    pending:     { bg: 'rgba(92, 114, 144, 0.08)',  color: 'var(--navy-soft)',    dotColor: 'var(--navy-soft)', label: 'Pending' },
    in_progress: { bg: 'rgba(217, 119, 6, 0.08)',   color: 'var(--amber-text)',   dotColor: 'var(--amber)',     label: 'In Progress' },
    resolved:    { bg: 'rgba(5, 150, 105, 0.08)',   color: 'var(--emerald-text)', dotColor: 'var(--emerald)',   label: 'Resolved' }
  };
  const LEVEL_LABELS = {
    local:    { text: 'Local Office',   bg: 'transparent', border: '1px solid var(--line)', color: 'var(--navy-soft)' },
    district: { text: 'District Level', bg: 'transparent', border: '1px solid var(--line)', color: 'var(--navy-soft)' },
    state:    { text: 'State Level',    bg: 'transparent', border: '1px solid var(--line)', color: 'var(--navy-soft)' },
    national: { text: 'National Level', bg: 'transparent', border: '1px solid var(--line)', color: 'var(--navy-soft)' }
  };

  const getEstDate = (issue) => {
    const d = new Date(((issue.timestamp || 0) + (issue.expected_resolution_days || 14) * 86400) * 1000);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const getDaysLeft = (issue) => {
    const resolveAt = ((issue.timestamp || 0) + (issue.expected_resolution_days || 14) * 86400) * 1000;
    return Math.ceil((resolveAt - Date.now()) / 86400000);
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '88px 24px 64px' }}>
      {/* Page header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <ClipboardList size={22} color="var(--blue)" />
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--navy)', margin: 0 }}>
            My Reported Issues
          </h1>
        </div>
        <p style={{ color: 'var(--navy-soft)', fontSize: '14px', margin: 0 }}>
          Track the status, handling tier, and estimated resolution of civic issues you have submitted.
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--navy-soft)', fontSize: '13px' }}>
          Loading your issues…
        </div>
      ) : myIssues.length === 0 ? (
        <div style={{
          maxWidth: '480px', margin: '0 auto', textAlign: 'center', padding: '56px 24px',
          background: 'var(--ice)', border: '1px dashed var(--sky)', borderRadius: 'var(--radius-md)'
        }}>
          <CheckCircle2 size={40} color="var(--sky)" style={{ margin: '0 auto 14px', display: 'block' }} />
          <h3 style={{ fontSize: '16px', color: 'var(--navy)', margin: '0 0 8px' }}>No reported issues yet</h3>
          <p style={{ fontSize: '13.5px', color: 'var(--navy-soft)', margin: '0 0 20px' }}>
            You haven&apos;t submitted any issues yet.
          </p>
          {onOpenReport && (
            <button
              type="button"
              className="btn-primary"
              onClick={onOpenReport}
              style={{ margin: '0 auto', justifyContent: 'center' }}
            >
              Report an Issue
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {myIssues.map((issue) => {
            const st = STATUS_STYLES[issue.status] || STATUS_STYLES.pending;
            const lv = LEVEL_LABELS[issue.current_level] || LEVEL_LABELS.district;
            const daysLeft = getDaysLeft(issue);
            const isResolved = issue.status === 'resolved';
            return (
              <div key={issue.id} style={{
                background: 'var(--white)', border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)', padding: '18px 22px',
                display: 'flex', flexDirection: 'column', gap: '12px',
                boxShadow: 'var(--shadow-sm)'
              }}>
                {/* Row 1: summary + status badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '14.5px', color: 'var(--navy)', lineHeight: 1.4 }}>
                      {issue.summary || issue.raw_text}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--navy-soft)', marginTop: '4px' }}>
                      {issue.locality || issue.location}
                      {' · '}
                      {issue.timestamp
                        ? new Date(issue.timestamp * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '11px', fontWeight: 500, padding: '2px 8px', whiteSpace: 'nowrap',
                    borderRadius: 'var(--radius-full)', background: st.bg, color: st.color,
                    display: 'inline-flex', alignItems: 'center', gap: '5px'
                  }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: st.dotColor, flexShrink: 0 }} />
                    {st.label}
                  </span>
                </div>

                {/* Row 2: category chips + tier badge + resolution */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {(issue.categories || []).slice(0, 2).map((cat, i) => (
                    <span key={i} style={{
                      fontSize: '11px', fontWeight: 500, padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      background: 'transparent', color: 'var(--navy-soft)',
                      border: '1px solid var(--line)', textTransform: 'capitalize'
                    }}>{cat.replace(/_/g, ' ')}</span>
                  ))}
                  <span style={{
                    fontSize: '11px', fontWeight: 500, padding: '2px 8px',
                    borderRadius: 'var(--radius-full)', background: lv.bg, color: lv.color,
                    border: lv.border
                  }}>⚙ {lv.text}</span>

                  <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--navy-soft)' }}>
                    {isResolved ? (
                      <span style={{ color: '#047857', fontWeight: 600 }}>✓ Resolved</span>
                    ) : (
                      <span>
                        <span
                          title="Heuristic estimate based on urgency — not a guarantee"
                          style={{ cursor: 'help', borderBottom: '1px dotted var(--navy-soft)' }}
                        >Est. resolution</span>
                        {' '}by {getEstDate(issue)}
                        {daysLeft > 0 ? ` (~${daysLeft}d remaining)` : ' (overdue)'}
                        <span style={{
                          marginLeft: '6px', fontSize: '10px', color: 'var(--navy-soft)',
                          background: 'var(--ice)', border: '1px solid var(--line)',
                          borderRadius: '4px', padding: '1px 5px', verticalAlign: 'middle'
                        }}>estimated</span>
                      </span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
