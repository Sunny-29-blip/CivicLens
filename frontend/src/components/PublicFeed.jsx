import React, { useState, useEffect } from 'react';
import {
  ThumbsUp, Search, MapPin,
  Clock, ShieldAlert, Check, ChevronDown, ChevronUp,
  TrendingUp, Users, AlertCircle
} from 'lucide-react';
import { api } from '../services/api';

/* ─── Status pill ─────────────────────────────────────────────────────────── */
function StatusPill({ status }) {
  const map = {
    resolved: { label: 'Resolved', dotColor: 'var(--emerald)', bg: 'rgba(5, 150, 105, 0.08)', color: 'var(--emerald-text)' },
    in_progress: { label: 'In Progress', dotColor: 'var(--amber)', bg: 'rgba(217, 119, 6, 0.08)', color: 'var(--amber-text)' },
    pending: { label: 'Open', dotColor: 'var(--navy-soft)', bg: 'rgba(92, 114, 144, 0.08)', color: 'var(--navy-soft)' },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      fontSize: '11px', fontWeight: 500, padding: '2px 8px',
      borderRadius: 'var(--radius-full)', background: s.bg, color: s.color,
      display: 'inline-flex', alignItems: 'center', gap: '5px'
    }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: s.dotColor, flexShrink: 0 }} />
      {s.label}
    </span>
  );
}

/* ─── Issue card ─────────────────────────────────────────────────────────── */
function IssueCard({ issue, isHighlighted, isSupported, onSupport }) {
  const [expanded, setExpanded] = useState(false);
  const cats = issue.categories || (issue.category ? [issue.category] : ['roads']);
  const priorityScore = issue.priority_score ?? 50;
  const priorityLabel = priorityScore >= 75 ? 'High' : priorityScore >= 40 ? 'Medium' : 'Low';

  // Location: show locality + district, state on second line
  const primaryLoc = issue.locality && issue.locality !== 'unspecified'
    ? issue.locality
    : issue.district || issue.location || '';
  const secondaryLoc = [
    issue.locality && issue.locality !== 'unspecified' ? issue.district : null,
    issue.state && issue.state !== 'unspecified' ? issue.state : null
  ].filter(Boolean).join(', ');

  const date = issue.timestamp
    ? new Date(issue.timestamp * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <div
      id={`issue-${issue.id}`}
      className="issue-card-hover"
      style={{
        background: isHighlighted ? 'var(--ice)' : 'var(--white)',
        border: isHighlighted ? '2px solid var(--blue)' : '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
        transition: 'all 0.2s ease'
      }}
    >
      {/* Card body — always visible */}
      <div style={{ padding: '18px 20px' }}>
        {/* Row 1: location + date */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
            <MapPin size={14} color="var(--rose)" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--navy)', lineHeight: 1.25 }}>{primaryLoc}</div>
              {secondaryLoc && <div style={{ fontSize: '12px', fontWeight: 400, color: 'var(--navy-soft)', marginTop: '2px' }}>{secondaryLoc}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <StatusPill status={issue.status} />
            {date && (
              <span style={{ fontSize: '11px', color: 'var(--navy-soft)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <Clock size={11} /> {date}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: category chips + priority */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px', alignItems: 'center' }}>
          {cats.slice(0, 3).map((cat, idx) => (
            <span key={idx} style={{
              background: 'transparent', color: 'var(--navy-soft)',
              border: '1px solid var(--line)',
              padding: '2px 8px', borderRadius: 'var(--radius-full)',
              fontSize: '11px', fontWeight: 500, textTransform: 'capitalize'
            }}>
              {cat.replace(/_/g, ' ')}
            </span>
          ))}
          <span style={{
            fontSize: '11px', fontWeight: 600, padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            background: priorityScore >= 75 ? 'var(--rose-bg)' : priorityScore >= 40 ? 'var(--amber-bg)' : 'var(--emerald-bg)',
            color: priorityScore >= 75 ? 'var(--rose-text)' : priorityScore >= 40 ? 'var(--amber-text)' : 'var(--emerald-text)',
            border: `1px solid ${priorityScore >= 75 ? 'var(--rose-border)' : priorityScore >= 40 ? 'var(--amber-border)' : 'var(--emerald-border)'}`
          }}>
            {priorityLabel} priority · {priorityScore}/100
          </span>
          <span style={{
            fontSize: '11px', fontWeight: 500,
            marginLeft: 'auto',
            background: 'transparent',
            color: 'var(--navy-soft)',
            border: '1px solid var(--line)',
            padding: '2px 8px', borderRadius: 'var(--radius-full)',
            textTransform: 'capitalize'
          }}>
            {issue.area_type === 'rural' ? 'Rural Area' : 'Urban Area'}
          </span>
        </div>

        {/* Row 3: short summary */}
        <p style={{
          fontSize: '13.5px', fontWeight: 400, color: 'var(--navy)',
          lineHeight: 1.5, margin: '0 0 14px',
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden'
        }}>
          {issue.summary || issue.raw_text}
        </p>

        {/* Row 4: actions */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: '10px', paddingTop: '12px', borderTop: '1px solid var(--line)'
        }}>
          {/* Support button */}
          <button
            type="button"
            onClick={onSupport}
            style={{
              background: isSupported ? 'var(--emerald-bg)' : 'var(--white)',
              color: isSupported ? '#047857' : 'var(--navy)',
              border: isSupported ? '1px solid var(--emerald)' : '1px solid var(--line)',
              padding: '7px 14px', borderRadius: 'var(--radius-full)',
              fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            {isSupported ? <Check size={14} /> : <ThumbsUp size={14} />}
            <span>{isSupported ? "You're counted." : "I'm Affected Too"}</span>
            <strong style={{
              marginLeft: '2px', background: 'rgba(0,0,0,0.06)',
              padding: '1px 6px', borderRadius: '10px', fontSize: '11px'
            }}>
              <Users size={10} style={{ verticalAlign: 'middle', marginRight: '2px' }} />
              {issue.support_count?.toLocaleString()}
            </strong>
          </button>

          {/* View details toggle */}
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            style={{
              background: 'none', border: '1px solid var(--line)',
              color: 'var(--navy-soft)', padding: '7px 12px',
              borderRadius: 'var(--radius-full)', fontSize: '12px',
              fontWeight: 500, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: '4px'
            }}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? 'Collapse' : 'View details'}
          </button>
        </div>
      </div>

      {/* Expandable details panel */}
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--line)',
          background: 'var(--ice)',
          padding: '16px 20px',
          display: 'flex', flexDirection: 'column', gap: '10px'
        }}>
          {/* Original text */}
          {issue.raw_text && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--navy-soft)', textTransform: 'uppercase', marginBottom: '4px' }}>
                Original Complaint ({issue.original_language || 'English'})
              </div>
              <div style={{
                fontSize: '13px', color: 'var(--navy)', lineHeight: 1.5,
                background: 'var(--white)', border: '1px solid var(--line)',
                borderLeft: '3px solid var(--blue)', borderRadius: 'var(--radius-sm)',
                padding: '10px 14px'
              }}>
                "{issue.raw_text}"
              </div>
            </div>
          )}

          {/* Metadata grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' }}>
            {[
              { label: 'State', value: issue.state },
              { label: 'District', value: issue.district },
              { label: 'Locality', value: issue.locality && issue.locality !== 'unspecified' ? issue.locality : '—' },
              { label: 'Urgency', value: issue.urgency || '—' },
              { label: 'Priority Score', value: `${priorityScore}/100` },
              { label: 'Submitted', value: date || '—' },
              { label: 'Community Support', value: `${issue.support_count?.toLocaleString()} citizens` },
            ].map(({ label, value }) => value ? (
              <div key={label} style={{
                background: 'var(--white)', border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)', padding: '8px 12px'
              }}>
                <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--navy-soft)', textTransform: 'uppercase', marginBottom: '2px' }}>{label}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy)', textTransform: 'capitalize' }}>{value}</div>
              </div>
            ) : null)}
          </div>

          {/* All categories */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--navy-soft)', textTransform: 'uppercase', marginBottom: '5px' }}>All Categories</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {cats.map((cat, idx) => (
                <span key={idx} style={{
                  background: 'transparent', color: 'var(--navy-soft)',
                  border: '1px solid var(--line)',
                  padding: '2px 8px', borderRadius: 'var(--radius-full)',
                  fontSize: '11px', fontWeight: 500, textTransform: 'capitalize'
                }}>
                  {cat.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main PublicFeed ─────────────────────────────────────────────────────── */
export default function PublicFeed({ session, onOpenReport, onOpenAuth, highlightedId }) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [areaFilter, setAreaFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [sortBy, setSortBy] = useState('support');
  const [searchTerm, setSearchTerm] = useState('');
  const [supportedMap, setSupportedMap] = useState({});
  const [toast, setToast] = useState('');

  const isCitizen = session?.role === 'citizen';
  const citizenToken = session?.profile?.token || null;

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const fetchFeed = async () => {
    setLoading(true);
    try {
      const data = await api.getPublicFeed({
        area_type: areaFilter || undefined,
        category: categoryFilter || undefined,
        state: stateFilter || undefined,
        sort_by: sortBy
      });
      setIssues(data.issues || []);
    } catch (err) {
      console.error('Failed to fetch public feed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFeed(); }, [areaFilter, categoryFilter, stateFilter, sortBy]);

  const handleSupport = async (issueId) => {
    // Guard: must be signed in
    if (!isCitizen) {
      showToast('Sign in first.');
      if (onOpenAuth) onOpenAuth();
      return;
    }

    // Already voted locally (optimistic check)
    if (supportedMap[issueId]) return;

    try {
      const res = await api.supportIssue(issueId, citizenToken);
      if (res.already_voted) {
        // Server says already voted — mark locally and stay silent
        setSupportedMap(prev => ({ ...prev, [issueId]: true }));
        return;
      }
      // New vote recorded
      setSupportedMap(prev => ({ ...prev, [issueId]: true }));
      setIssues(prev => prev.map(i =>
        i.id === issueId
          ? { ...i, support_count: res.support_count, high_priority: res.high_priority }
          : i
      ));
      showToast('Your support has been recorded. Thank you!');
    } catch (err) {
      if (err.message?.toLowerCase().includes('sign in')) {
        showToast('Sign in first.');
        if (onOpenAuth) onOpenAuth();
      } else {
        showToast(err.message || 'Something went wrong. Please try again.');
      }
    }
  };

  const filteredIssues = issues.filter(issue => {
    const cats = issue.categories || (issue.category ? [issue.category] : ['roads']);
    if (categoryFilter && !cats.includes(categoryFilter)) return false;
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (issue.summary || '').toLowerCase().includes(term) ||
      (issue.location || '').toLowerCase().includes(term) ||
      cats.some(c => c.toLowerCase().includes(term)) ||
      (issue.raw_text || '').toLowerCase().includes(term) ||
      (issue.state || '').toLowerCase().includes(term) ||
      (issue.locality || '').toLowerCase().includes(term)
    );
  });

  // Featured issue: top issue by support or priority
  const featuredIssue = filteredIssues.find(i => i.high_priority || (i.priority_score && i.priority_score >= 75));
  const mainIssues = filteredIssues.filter(i => i !== featuredIssue);

  return (
    <div style={{ padding: '88px 6% 60px', maxWidth: '900px', margin: '0 auto' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 300,
          background: 'var(--navy)', color: 'var(--white)',
          padding: '13px 20px', borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-lg)', border: '1px solid var(--sky)',
          display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px'
        }}>
          <AlertCircle size={16} color="var(--cyan)" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header */}
      <section style={{ paddingBottom: '24px' }}>
        <div className="eyebrow" style={{ marginBottom: '12px' }}>
          <span className="dot" style={{ background: 'var(--cyan)' }}></span>
          <span>Community-Backed Civic Issues</span>
        </div>
        <h1 style={{ fontSize: '30px', marginBottom: '6px' }}>Explore Public Issues</h1>
        <p style={{ fontSize: '14.5px', color: 'var(--navy-soft)', maxWidth: '560px', margin: 0 }}>
          Browse verified civic issues across India. Back issues affecting your area to help prioritise government response.
        </p>
      </section>

      {/* Filters */}
      <div style={{
        background: 'var(--white)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: '24px',
        display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
          <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)} className="select-input" style={{ fontSize: '12.5px' }}>
            <option value="">All Regions</option>
            <option value="rural">Rural</option>
            <option value="urban">Urban</option>
          </select>

          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="select-input" style={{ fontSize: '12.5px' }}>
            <option value="">All Categories</option>
            <option value="roads">Roads &amp; Transport</option>
            <option value="traffic">Traffic</option>
            <option value="electricity">Electricity / Power</option>
            <option value="water_shortage">Water Shortage</option>
            <option value="pollution">Pollution &amp; Waste</option>
            <option value="irrigation_water">Irrigation Water</option>
            <option value="healthcare_access">Healthcare Access</option>
            <option value="network_coverage">Network Coverage</option>
          </select>

          <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} className="select-input" style={{ fontSize: '12.5px' }}>
            <option value="">All States</option>
            <option value="Karnataka">Karnataka</option>
            <option value="Telangana">Telangana</option>
            <option value="Uttar Pradesh">Uttar Pradesh</option>
            <option value="Delhi">Delhi</option>
            <option value="Bihar">Bihar</option>
            <option value="Maharashtra">Maharashtra</option>
            <option value="Rajasthan">Rajasthan</option>
            <option value="Haryana">Haryana</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--navy-soft)' }} />
            <input
              type="text"
              placeholder="Search issues, city..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                padding: '7px 12px 7px 28px', borderRadius: 'var(--radius-full)',
                border: '1px solid var(--line)', fontSize: '12.5px',
                width: '170px', background: 'var(--ice)', outline: 'none'
              }}
            />
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="select-input"
            style={{ fontWeight: 600, color: 'var(--blue)', fontSize: '12.5px' }}
          >
            <option value="support">Most Backed</option>
            <option value="recent">Most Recent</option>
          </select>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--navy-soft)' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            border: '3px solid var(--line)', borderTopColor: 'var(--blue)',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 12px'
          }} />
          <div style={{ fontSize: '13px' }}>Loading issues...</div>
        </div>
      ) : filteredIssues.length === 0 ? (
        <div style={{
          background: 'var(--white)', border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)', padding: '48px 24px',
          textAlign: 'center', boxShadow: 'var(--shadow-sm)'
        }}>
          <ShieldAlert size={32} color="var(--navy-soft)" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>No public issues match these filters.</h3>
          <p style={{ color: 'var(--navy-soft)', fontSize: '13.5px', margin: '0 0 16px' }}>
            Try adjusting your filters or report a new issue.
          </p>
          <button className="btn-primary" style={{ margin: '0 auto' }} onClick={onOpenReport}>
            Report an Issue
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {/* Featured issue strip — Part D/E */}
          {featuredIssue && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '11px', fontWeight: 700, color: 'var(--rose)',
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px'
              }}>
                <TrendingUp size={13} />
                <span>Priority Issue</span>
              </div>
              <IssueCard
                issue={featuredIssue}
                isHighlighted={highlightedId === featuredIssue.id}
                isSupported={!!supportedMap[featuredIssue.id]}
                onSupport={() => handleSupport(featuredIssue.id)}
              />
            </div>
          )}

          {/* Issue count */}
          <div style={{ fontSize: '12.5px', color: 'var(--navy-soft)', marginBottom: '12px', fontWeight: 500 }}>
            {filteredIssues.length} issue{filteredIssues.length !== 1 ? 's' : ''} in this view
          </div>

          {/* Issue list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {mainIssues.map(issue => (
              <IssueCard
                key={issue.id}
                issue={issue}
                isHighlighted={highlightedId === issue.id}
                isSupported={!!supportedMap[issue.id]}
                onSupport={() => handleSupport(issue.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
