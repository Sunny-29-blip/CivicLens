import React, { useState, useEffect, Component } from 'react';
import { 
  Landmark, ShieldAlert, TrendingUp, Filter, 
  Calculator, Eye, LogOut, Check,
  BarChart3, CheckCircle2, Clock, LayoutDashboard, 
  List, MapPin
} from 'lucide-react';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell
} from 'recharts';
import { api } from '../services/api';
import IndiaMap from './IndiaMap';

const COLORS = ['#1656e0', '#3fc7ff', '#0a2e86', '#60a5fa', '#38bdf8', '#818cf8', '#10b981'];

/* ─── Map Error Boundary (Part A + P) ──────────────────────────────────────── */
class MapErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(err, errorInfo) {
    console.error('[IndiaMap] Render error caught by boundary:', err, errorInfo);
    this.setState({ error: err, errorInfo });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          background: 'var(--white)', border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)', padding: '20px',
          boxShadow: 'var(--shadow-sm)', textAlign: 'center',
          color: 'var(--navy-soft)', fontSize: '13px'
        }}>
          <div>Map unavailable — all other dashboard data is unaffected.</div>
          <div style={{
            marginTop: '10px',
            padding: '8px 12px',
            background: '#fee2e2',
            color: '#dc2626',
            borderRadius: '6px',
            fontSize: '12px',
            fontFamily: 'monospace',
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}>
            <strong>Map Error:</strong> {this.state.error?.message || String(this.state.error)}
            {this.state.error?.stack && (
              <div style={{ marginTop: '4px', fontSize: '10px', color: '#7f1d1d' }}>
                {this.state.error.stack}
              </div>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function OfficialsDashboard({ session, onLogout }) {
  const [dashboardData, setDashboardData] = useState(null);
  const [hotspots, setHotspots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drillState, setDrillState] = useState('');
  const [drillDistrict, setDrillDistrict] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedHotspotId, setSelectedHotspotId] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [dashTab, setDashTab] = useState('overview'); // 'overview' | 'hotspots' | 'grievances'
  const [statusFilter, setStatusFilter] = useState('open'); // 'open' | 'all' | 'resolved'

  const official = session?.profile || {
    name: 'Dr. Rajeshwar Rao, IAS',
    department: 'National Infrastructure Mission',
    level: 'national',
    jurisdiction: { state: null, district: null, locality: null },
    state: 'All States',
    district: 'All Districts'
  };

  const token = session?.profile?.token || null;
  const level = official.level || 'national';

  const loadData = async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (categoryFilter) {
        const [dashRes, hotRes] = await Promise.all([
          api.getDashboardData(token, drillState || null, drillDistrict || null),
          api.getHotspots(token, {
            state: drillState || undefined,
            district: drillDistrict || undefined,
            category: categoryFilter || undefined
          })
        ]);
        setDashboardData(dashRes);
        setHotspots(hotRes || []);
      } else {
        const dashRes = await api.getDashboardData(token, drillState || null, drillDistrict || null);
        setDashboardData(dashRes);
        setHotspots(dashRes.hotspots || []);
      }
    } catch (err) {
      console.error('Failed to load officials dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token, drillState, drillDistrict, categoryFilter]);

  const handleUpdateStatus = async (complaintId, newStatus) => {
    setUpdatingId(complaintId);
    try {
      await api.updateComplaintStatus(complaintId, newStatus, token);

      // 1. Optimistic update of main dashboardData (KPIs & complaints list)
      setDashboardData(prev => {
        if (!prev) return prev;
        const prevComplaints = prev.complaints || [];
        const target = prevComplaints.find(c => c.id === complaintId);
        const wasOpen = target && target.status !== 'resolved';

        const updatedComplaints = prevComplaints.map(c => 
          c.id === complaintId ? { ...c, status: newStatus } : c
        );

        const currentOpen = prev.kpis?.open_issues ?? ((prev.kpis?.pending_count || 0) + (prev.kpis?.in_progress_count || 0));

        const newKpis = {
          ...prev.kpis,
          open_issues: wasOpen && newStatus === 'resolved' 
            ? Math.max(0, currentOpen - 1) 
            : prev.kpis?.open_issues,
          pending_count: wasOpen && newStatus === 'resolved' && target?.status === 'pending'
            ? Math.max(0, (prev.kpis?.pending_count || 1) - 1)
            : prev.kpis?.pending_count,
          in_progress_count: wasOpen && newStatus === 'resolved' && target?.status === 'in_progress'
            ? Math.max(0, (prev.kpis?.in_progress_count || 1) - 1)
            : prev.kpis?.in_progress_count,
          resolved_count: wasOpen && newStatus === 'resolved' 
            ? (prev.kpis?.resolved_count || 0) + 1 
            : prev.kpis?.resolved_count
        };

        return {
          ...prev,
          kpis: newKpis,
          complaints: updatedComplaints
        };
      });

      // 2. Optimistic update of hotspots matrix list
      setHotspots(prev => 
        prev.map(h => {
          const updatedList = (h.complaints || []).map(c => 
            c.id === complaintId ? { ...c, status: newStatus } : c
          );
          return {
            ...h,
            complaints: updatedList,
            complaint_count: updatedList.filter(c => c.status !== 'resolved').length
          };
        })
      );

      // Re-sync with server
      loadData();
    } catch (err) {
      console.error('Status update failed:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const kpis = dashboardData?.kpis || {
    total_complaints: 0,
    open_issues: 0,
    high_priority_count: 0,
    pending_count: 0,
    in_progress_count: 0,
    resolved_count: 0,
    average_priority_score: 0,
    total_supporters: 0
  };

  const chartData = dashboardData?.chart_data || [];
  const categoryChartData = dashboardData?.category_chart_data || [];
  const complaints = dashboardData?.complaints || [];

  const getPriorityBadgeClass = (score) => {
    if (score >= 75) return 'urgency-high';
    if (score >= 40) return 'urgency-medium';
    return 'urgency-low';
  };

  /* ─── Internal Tab Nav ──────────────────────────────────────────────────── */
  const NAV_TABS = [
    { id: 'overview',   label: 'Intelligence Overview', icon: LayoutDashboard },
    { id: 'hotspots',   label: 'Ranked Hotspots',       icon: MapPin },
    { id: 'grievances', label: 'All Issues',            icon: List },
  ];

  return (
    <div className="dashboard-container">
      {/* Official Header with Tier Pill */}
      <section style={{ padding: '36px 0 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span className="eyebrow" style={{ fontSize: '11px', padding: '3px 10px', margin: 0 }}>
              <Landmark size={13} color="var(--blue)" />
              <span>{official.department}</span>
            </span>
            <span style={{
              fontSize: '11px',
              fontWeight: 700,
              background: 'var(--navy)',
              color: 'var(--cyan)',
              padding: '3px 10px',
              borderRadius: 'var(--radius-full)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}>
              {level} Tier Scope
            </span>
          </div>

          <h1 style={{ fontSize: '28px', margin: '6px 0' }}>
            Government Intelligence Portal
          </h1>
          <p style={{ fontSize: '13.5px', color: 'var(--navy-soft)', margin: 0 }}>
            Logged in as <strong>{official.name}</strong> · Jurisdiction: {official.state} ({official.district})
            {official.jurisdiction?.locality && ` · Locality: ${official.jurisdiction.locality}`}
            {loading && <span style={{ marginLeft: '10px', color: 'var(--blue)', fontSize: '12px', fontWeight: 600 }}>● Syncing data...</span>}
          </p>
        </div>

        <button className="btn-secondary" onClick={onLogout} style={{ padding: '8px 16px', fontSize: '13px' }}>
          <LogOut size={14} style={{ marginRight: '6px' }} />
          <span>Exit Officials Portal</span>
        </button>
      </section>

      {/* ── 3-Tab Internal Navigation (Part L) ── */}
      <div style={{
        display: 'flex',
        gap: '4px',
        background: 'var(--ice)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-full)',
        padding: '4px',
        marginBottom: '24px',
        overflowX: 'auto',
      }}>
        {NAV_TABS.map(tab => {
          const Icon = tab.icon;
          const active = dashTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setDashTab(tab.id)}
              style={{
                flex: '1 1 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '7px',
                padding: '9px 18px',
                borderRadius: 'var(--radius-full)',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease',
                background: active ? 'var(--navy)' : 'transparent',
                color: active ? 'var(--white)' : 'var(--navy-soft)',
                boxShadow: active ? '0 2px 8px rgba(8, 26, 58, 0.25)' : 'none',
              }}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scope Filtering — shown on overview & hotspots tabs only */}
      {(dashTab === 'overview' || dashTab === 'hotspots') && (
        <div style={{
          background: 'var(--white)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 18px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--navy)' }}>
            <Filter size={16} color="var(--blue)" />
            <span>Scope &amp; Category Filters:</span>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {level === 'national' && (
              <select
                value={drillState}
                onChange={(e) => { setDrillState(e.target.value); setDrillDistrict(''); }}
                className="select-input"
                style={{ fontSize: '12.5px' }}
              >
                <option value="">All States</option>
                <option value="Karnataka">Karnataka</option>
                <option value="Uttar Pradesh">Uttar Pradesh</option>
                <option value="Bihar">Bihar</option>
                <option value="Delhi">Delhi</option>
                <option value="Maharashtra">Maharashtra</option>
                <option value="Rajasthan">Rajasthan</option>
                <option value="Haryana">Haryana</option>
              </select>
            )}

            {(level === 'national' || level === 'state') && (
              <input
                type="text"
                value={drillDistrict}
                onChange={(e) => setDrillDistrict(e.target.value)}
                placeholder="Filter by District..."
                className="select-input"
                style={{ fontSize: '12.5px', width: '160px' }}
              />
            )}

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="select-input"
              style={{ fontSize: '12.5px' }}
            >
              <option value="">All Categories</option>
              <option value="roads">Roads</option>
              <option value="traffic">Traffic</option>
              <option value="electricity">Electricity</option>
              <option value="water_shortage">Water Shortage</option>
              <option value="pollution">Pollution</option>
              <option value="irrigation_water">Irrigation Water</option>
              <option value="healthcare_access">Healthcare Access</option>
              <option value="network_coverage">Network Coverage</option>
            </select>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: OVERVIEW (Part M) — KPIs + charts + map                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {dashTab === 'overview' && (
        <>
          {/* 5-KPI Metric Ribbon */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-icon">
                <ShieldAlert size={22} />
              </div>
              <div>
                <div className="kpi-val">{kpis.total_complaints}</div>
                <div className="kpi-label">Total Complaints</div>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--rose)' }}>
                <TrendingUp size={22} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: 'var(--rose)' }}>{kpis.high_priority_count}</div>
                <div className="kpi-label">High Priority (≥75)</div>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>
                <Clock size={22} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: '#b45309' }}>{kpis.open_issues || (kpis.pending_count + kpis.in_progress_count)}</div>
                <div className="kpi-label">Open Issues</div>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon" style={{ background: 'var(--emerald-bg)', color: 'var(--emerald)' }}>
                <CheckCircle2 size={22} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: '#047857' }}>{kpis.resolved_count}</div>
                <div className="kpi-label">Resolved Issues</div>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon" style={{ background: 'rgba(22, 86, 224, 0.1)', color: 'var(--blue)' }}>
                <Calculator size={22} />
              </div>
              <div>
                <div className="kpi-val" style={{ color: 'var(--blue)' }}>{kpis.average_priority_score} / 100</div>
                <div className="kpi-label">Average Priority</div>
              </div>
            </div>
          </div>

          {/* Visualizations Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '20px', marginBottom: '28px' }}>
            {/* Priority Score Bar Chart */}
            <div style={{
              background: 'var(--white)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: '20px',
              boxShadow: 'var(--shadow-sm)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <BarChart3 size={20} color="var(--blue)" />
                <h3 style={{ fontSize: '18px', margin: 0 }}>
                  {level === 'national' ? 'Avg Priority Index by State' : level === 'state' ? 'Avg Priority Index by District' : 'Avg Priority Index by Locality'}
                </h3>
              </div>

              <div style={{ height: '260px', width: '100%' }}>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 13, fill: '#4b6182' }} angle={-25} textAnchor="end" interval={0} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 13, fill: '#4b6182' }} />
                      <Tooltip 
                        formatter={(val) => [`${val}/100`, 'Priority Score']}
                        contentStyle={{ borderRadius: '8px', border: '1px solid #d7e4f4', fontSize: '14px' }}
                      />
                      <Bar dataKey="priority_score" fill="#1656e0" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navy-soft)', fontSize: '15px' }}>
                    No complaints recorded in this jurisdiction
                  </div>
                )}
              </div>
            </div>

            {/* Category Distribution Chart */}
            <div style={{
              background: 'var(--white)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: '20px',
              boxShadow: 'var(--shadow-sm)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <BarChart3 size={20} color="var(--blue)" />
                <h3 style={{ fontSize: '18px', margin: 0 }}>
                  Category Breakdown
                </h3>
              </div>

              <div style={{ height: '260px', width: '100%' }}>
                {categoryChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={categoryChartData}
                      margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 13, fill: '#4b6182' }}
                        allowDecimals={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        tick={{ fontSize: 13, fill: '#4b6182' }}
                        tickFormatter={(v) => v.replace(/_/g, ' ')}
                      />
                      <Tooltip
                        formatter={(val, name, props) => [`${val} complaints`, props.payload?.name?.replace(/_/g, ' ') || name]}
                        contentStyle={{ borderRadius: '8px', border: '1px solid #d7e4f4', fontSize: '14px' }}
                        cursor={{ fill: 'var(--ice)' }}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {categoryChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navy-soft)', fontSize: '15px' }}>
                    No category data available
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* India Choropleth Map — wrapped in error boundary (Part A + P) */}
          <div style={{ marginBottom: '28px' }}>
            <MapErrorBoundary>
              <IndiaMap token={token} mapData={dashboardData?.map_data} />
            </MapErrorBoundary>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: RANKED HOTSPOTS (Part N)                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {dashTab === 'hotspots' && (
        <>
          {/* Aggregated Hotspots Matrix */}
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: '22px',
            marginBottom: '20px',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '17px', margin: 0 }}>
                Ranked Hotspots &amp; Infrastructure Clusters ({hotspots.length})
              </h3>
              <p style={{ fontSize: '12.5px', color: 'var(--navy-soft)', margin: '4px 0 0' }}>
                Grouped by State, District, Category, and Area Type. Ranked by 0–100 Priority Score.
              </p>
            </div>

            {hotspots.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--line)', color: 'var(--navy-soft)', fontSize: '11.5px', textTransform: 'uppercase' }}>
                      <th style={{ padding: '10px 12px' }}>Hotspot Location</th>
                      <th style={{ padding: '10px 12px' }}>Category</th>
                      <th style={{ padding: '10px 12px' }}>Area</th>
                      <th style={{ padding: '10px 12px' }}>Volume</th>
                      <th style={{ padding: '10px 12px' }}>0–100 Priority Score</th>
                      <th style={{ padding: '10px 12px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hotspots.map((h, index) => {
                      const rowKey = h.hotspot_id || `hotspot-${h.state}-${h.district}-${h.category}-${index}`;
                      const isExpanded = selectedHotspotId === rowKey;
                      const activeHotspotComplaints = (h.complaints || []).filter(c => c.status !== 'resolved');

                      return (
                        <React.Fragment key={rowKey}>
                          <tr
                            className="hotspot-row"
                            style={{
                              borderBottom: isExpanded ? 'none' : '1px solid var(--line)',
                              background: isExpanded ? 'rgba(22, 86, 224, 0.04)' : undefined,
                              transition: 'background 0.15s ease'
                            }}
                          >
                            <td style={{ padding: '12px' }}>
                              <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{h.district || h.state}</div>
                              <div style={{ fontSize: '11.5px', color: 'var(--navy-soft)' }}>{h.state || 'National'}</div>
                            </td>
                            <td style={{ padding: '12px' }}>
                              <span style={{
                                background: 'rgba(22, 86, 224, 0.08)',
                                color: 'var(--blue)',
                                border: '1px solid rgba(22, 86, 224, 0.25)',
                                padding: '3px 9px',
                                borderRadius: 'var(--radius-full)',
                                fontSize: '11.5px',
                                fontWeight: 600,
                                textTransform: 'capitalize'
                              }}>
                                {(h.category || '').replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td style={{ padding: '12px' }}>
                              <span className={`tag-area ${h.area_type === 'rural' ? 'tag-rural' : 'tag-urban'}`}>
                                {h.area_type === 'rural' ? 'Rural' : 'Urban'}
                              </span>
                            </td>
                            <td style={{ padding: '12px' }}>
                              <span style={{ fontWeight: 800, fontSize: '15px', color: 'var(--navy)' }}>
                                {h.complaint_count}
                              </span>{' '}
                              <span style={{ fontSize: '13px', color: 'var(--navy-soft)', fontWeight: 500 }}>
                                issue{h.complaint_count > 1 ? 's' : ''}
                              </span>
                            </td>
                            <td style={{ padding: '12px' }}>
                              <span className={`urgency-badge ${getPriorityBadgeClass(h.priority_score)}`}>
                                {h.priority_score} / 100
                              </span>
                              <div style={{ fontSize: '11px', color: 'var(--navy-soft)', marginTop: '3px' }}>
                                {h.formula_breakdown?.formula_str}
                              </div>
                            </td>
                            <td style={{ padding: '12px' }}>
                              <button
                                type="button"
                                onClick={() => setSelectedHotspotId(prev => prev === rowKey ? null : rowKey)}
                                className={isExpanded ? 'btn-primary' : 'btn-secondary'}
                                style={{ padding: '4px 10px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                <Eye size={12} />
                                <span>{isExpanded ? 'Collapse' : 'Inspect'}</span>
                              </button>
                            </td>
                          </tr>

                          {/* Inline Accordion Detail Drawer */}
                          {isExpanded && (
                            <tr style={{ borderBottom: '1px solid var(--line)' }}>
                              <td colSpan={6} style={{ padding: '0', background: 'transparent' }}>
                                <div style={{
                                  background: 'var(--ice)',
                                  borderLeft: '4px solid var(--blue)',
                                  borderRight: '1px solid var(--line)',
                                  borderBottom: '1px solid var(--line)',
                                  padding: '16px 20px',
                                  margin: '0 0 10px 0',
                                  borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
                                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.03)'
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                    <h4 style={{ fontSize: '14.5px', margin: 0, color: 'var(--navy)' }}>
                                      Inspecting Hotspot: {h.district || h.state} ({h.state || 'National'}) — {(h.category || '').replace(/_/g, ' ').toUpperCase()}
                                    </h4>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--navy-soft)' }}>
                                        {activeHotspotComplaints.length} open issue{activeHotspotComplaints.length === 1 ? '' : 's'}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => setSelectedHotspotId(null)}
                                        style={{
                                          background: 'none',
                                          border: 'none',
                                          color: 'var(--navy-soft)',
                                          fontSize: '11.5px',
                                          cursor: 'pointer',
                                          fontWeight: 600,
                                          textDecoration: 'underline'
                                        }}
                                      >
                                        Close
                                      </button>
                                    </div>
                                  </div>

                                  {activeHotspotComplaints.length === 0 ? (
                                    <div style={{
                                      textAlign: 'center',
                                      padding: '20px',
                                      background: 'var(--white)',
                                      borderRadius: 'var(--radius-sm)',
                                      border: '1px solid var(--line)',
                                      color: '#047857',
                                      fontWeight: 600,
                                      fontSize: '13.5px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '8px'
                                    }}>
                                      <CheckCircle2 size={18} color="var(--emerald)" />
                                      <span>All complaints in this hotspot cluster have been resolved!</span>
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                      {activeHotspotComplaints.map((c) => (
                                        <div key={c.id} style={{
                                          background: 'var(--white)',
                                          border: '1px solid var(--line)',
                                          borderRadius: 'var(--radius-sm)',
                                          padding: '12px 16px',
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'center',
                                          flexWrap: 'wrap',
                                          gap: '10px'
                                        }}>
                                          <div style={{ maxWidth: '600px' }}>
                                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--navy)', lineHeight: 1.4 }}>
                                              {c.summary || c.raw_text}
                                            </div>
                                            <div style={{ fontSize: '11.5px', color: 'var(--navy-soft)', marginTop: '3px' }}>
                                              ID: <code>{c.id}</code> · Locality: {c.locality || c.location || h.district} · Priority: <strong>{c.priority_score || 50}/100</strong>
                                            </div>
                                          </div>

                                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{
                                              fontSize: '11px',
                                              fontWeight: 600,
                                              padding: '2px 8px',
                                              borderRadius: 'var(--radius-full)',
                                              background: c.status === 'resolved' ? 'var(--emerald-bg)' : c.status === 'in_progress' ? 'var(--amber-bg)' : 'var(--ice)',
                                              color: c.status === 'resolved' ? '#047857' : c.status === 'in_progress' ? '#b45309' : 'var(--navy)'
                                            }}>
                                              {(c.status || 'open').toUpperCase()}
                                            </span>

                                            <button
                                              type="button"
                                              disabled={updatingId === c.id}
                                              onClick={() => handleUpdateStatus(c.id, 'resolved')}
                                              className="btn-primary"
                                              style={{ padding: '5px 10px', fontSize: '11px', background: 'var(--emerald)', whiteSpace: 'nowrap' }}
                                            >
                                              <Check size={12} />
                                              <span>Mark Resolved</span>
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--navy-soft)', fontSize: '13px' }}>
                Not enough data for hotspot analysis in this jurisdiction.
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: ALL GRIEVANCES (Part O)                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {dashTab === 'grievances' && (() => {
        const filteredComplaints = complaints.filter(c => {
          if (statusFilter === 'open') return c.status !== 'resolved';
          if (statusFilter === 'resolved') return c.status === 'resolved';
          return true; // 'all'
        });

        return (
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: '22px',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ fontSize: '17px', margin: 0 }}>
                  All Scoped Citizen Issues ({filteredComplaints.length})
                </h3>
                <p style={{ fontSize: '12.5px', color: 'var(--navy-soft)', margin: '4px 0 0' }}>
                  Jurisdiction-filtered. Showing {statusFilter === 'open' ? 'open issues only (default)' : statusFilter === 'resolved' ? 'resolved issues' : 'all issues'}.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="select-input"
                  style={{ fontSize: '12.5px', fontWeight: 600 }}
                >
                  <option value="open">Status: Open (Default)</option>
                  <option value="all">Status: All Statuses</option>
                  <option value="resolved">Status: Resolved Only</option>
                </select>

                {level === 'national' && (
                  <select
                    value={drillState}
                    onChange={(e) => { setDrillState(e.target.value); setDrillDistrict(''); }}
                    className="select-input"
                    style={{ fontSize: '12.5px' }}
                  >
                    <option value="">All States</option>
                    <option value="Karnataka">Karnataka</option>
                    <option value="Uttar Pradesh">Uttar Pradesh</option>
                    <option value="Bihar">Bihar</option>
                    <option value="Delhi">Delhi</option>
                    <option value="Maharashtra">Maharashtra</option>
                  </select>
                )}
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="select-input"
                  style={{ fontSize: '12.5px' }}
                >
                  <option value="">All Categories</option>
                  <option value="roads">Roads</option>
                  <option value="traffic">Traffic</option>
                  <option value="electricity">Electricity</option>
                  <option value="water_shortage">Water Shortage</option>
                  <option value="pollution">Pollution</option>
                </select>
              </div>
            </div>

            {filteredComplaints.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--line)', color: 'var(--navy-soft)', fontSize: '11.5px', textTransform: 'uppercase' }}>
                      <th style={{ padding: '10px 12px' }}>Complaint ID</th>
                      <th style={{ padding: '10px 12px' }}>Summary &amp; Text</th>
                      <th style={{ padding: '10px 12px' }}>Categories</th>
                      <th style={{ padding: '10px 12px' }}>Jurisdiction</th>
                      <th style={{ padding: '10px 12px' }}>Priority</th>
                      <th style={{ padding: '10px 12px' }}>Status</th>
                      <th style={{ padding: '10px 12px' }}>Resolution Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredComplaints.map((c) => {
                      const rawCats = c.categories || [c.category || 'roads'];
                      return (
                        <tr key={c.id} className="hotspot-row" style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={{ padding: '12px' }}>
                            <code style={{ fontSize: '11.5px', color: 'var(--blue)' }}>{c.id}</code>
                          </td>
                          <td style={{ padding: '12px', maxWidth: '300px' }}>
                            <div style={{ fontWeight: 600, color: 'var(--navy)', lineHeight: 1.4 }}>
                              {c.summary || c.raw_text}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--navy-soft)', marginTop: '2px' }}>
                              Lang: {c.original_language}
                            </div>
                          </td>
                          <td style={{ padding: '12px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {rawCats.map((cat, idx) => (
                                <span key={idx} style={{
                                  background: 'rgba(22, 86, 224, 0.08)',
                                  color: 'var(--blue)',
                                  border: '1px solid rgba(22, 86, 224, 0.25)',
                                  padding: '2px 7px',
                                  borderRadius: 'var(--radius-full)',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  textTransform: 'capitalize'
                                }}>
                                  {cat.replace(/_/g, ' ')}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: '12px' }}>
                            <div style={{ fontWeight: 500 }}>{c.district}, {c.state}</div>
                            <div style={{ fontSize: '11px', color: 'var(--navy-soft)' }}>{c.locality || c.location}</div>
                          </td>
                          <td style={{ padding: '12px' }}>
                            <span className={`urgency-badge ${getPriorityBadgeClass(c.priority_score || 50)}`}>
                              {c.priority_score || 50} / 100
                            </span>
                          </td>
                          <td style={{ padding: '12px' }}>
                            <span style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              padding: '3px 8px',
                              borderRadius: 'var(--radius-full)',
                              background: c.status === 'resolved' ? 'var(--emerald-bg)' : c.status === 'in_progress' ? 'var(--amber-bg)' : 'var(--ice)',
                              color: c.status === 'resolved' ? '#047857' : c.status === 'in_progress' ? '#b45309' : 'var(--navy)'
                            }}>
                              {c.status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '12px' }}>
                            {c.status !== 'resolved' ? (
                              <button
                                type="button"
                                disabled={updatingId === c.id}
                                onClick={() => handleUpdateStatus(c.id, 'resolved')}
                                className="btn-primary"
                                style={{ padding: '4px 10px', fontSize: '11px', background: 'var(--emerald)' }}
                              >
                                <Check size={12} />
                                <span>Resolve</span>
                              </button>
                            ) : (
                              <span style={{ fontSize: '11.5px', color: 'var(--emerald)', fontWeight: 600 }}>
                                ✓ Closed
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--navy-soft)', fontSize: '13px' }}>
                {statusFilter === 'open' 
                  ? 'No open complaints found matching current jurisdiction filter.' 
                  : statusFilter === 'resolved'
                  ? 'No resolved complaints found matching current jurisdiction filter.'
                  : 'No complaints found matching current jurisdiction filter.'}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
