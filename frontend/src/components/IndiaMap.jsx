/**
 * CivicLens Geographic Information System (GIS) Subsystem
 *
 * DATA PROVENANCE:
 * Dataset: Survey of India (SOI) Compliant Administrative Boundary Dataset
 * Source Repository: https://github.com/udit-001/india-maps-data
 * Administrative Structure: Current post-2019/2020 reorganization (28 States + 8 UTs = 36 Entities)
 * Complies with official Survey of India boundary guidelines with complete depiction of
 * Jammu & Kashmir and Ladakh as separate Union Territories, Aksai Chin, and official external frontiers.
 */
import React, { useState, useCallback } from 'react';
import { api } from '../services/api';
import {
  ComposableMap,
  Geographies,
  Geography
} from 'react-simple-maps';
import { geoMercator } from 'd3-geo';
import { Map as MapIcon, AlertCircle } from 'lucide-react';
import statesGeoData from '../data/india_states.json';
import districtsGeoData from '../data/india_districts.json';

/* ─── Name normalization & alias map ──────────────────────────────────────── */
const normalize = (s) => (s || '')
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const STATE_ALIASES = {
  // Andaman & Nicobar
  'andaman and nicobar': 'andaman and nicobar islands',
  'andaman and nicobar islands': 'andaman and nicobar',
  'andaman & nicobar islands': 'andaman and nicobar islands',
  'andaman & nicobar': 'andaman and nicobar islands',

  // Jammu & Kashmir / Ladakh (Post-2019 two separate UTs)
  'jammu and kashmir': 'jammu and kashmir',
  'jammu & kashmir': 'jammu and kashmir',
  'j and k': 'jammu and kashmir',
  'ladakh': 'ladakh',

  // Delhi / NCT
  'delhi': 'delhi',
  'national capital territory of delhi': 'delhi',
  'nct of delhi': 'delhi',

  // Uttarakhand / Uttaranchal
  'uttarakhand': 'uttarakhand',
  'uttaranchal': 'uttarakhand',

  // Odisha / Orissa
  'odisha': 'odisha',
  'orissa': 'odisha',

  // Puducherry / Pondicherry
  'puducherry': 'puducherry',
  'pondicherry': 'puducherry',

  // Chhattisgarh / Chattisgarh
  'chhattisgarh': 'chhattisgarh',
  'chattisgarh': 'chhattisgarh',

  // Dadra and Nagar Haveli and Daman and Diu
  'dadra and nagar haveli and daman and diu': 'dadra and nagar haveli and daman and diu',
  'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  'daman and diu': 'dadra and nagar haveli and daman and diu',
  'dadra & nagar haveli and daman & diu': 'dadra and nagar haveli and daman and diu',

  // Telangana
  'telangana': 'telangana'
};

const DISTRICT_ALIASES = {
  'bengaluru urban': 'bangalore urban',
  'bangalore urban': 'bengaluru urban',
  'bengaluru rural': 'bangalore rural',
  'bangalore rural': 'bengaluru rural',
  'bengaluru': 'bangalore',
  'bangalore': 'bengaluru',
  'gurugram': 'gurgaon',
  'gurgaon': 'gurugram',
  'vishakhapatnam': 'visakhapatnam',
  'visakhapatnam': 'vishakhapatnam',
};

function matchRegion(geoName, dataMap, aliases = {}) {
  if (!geoName || !dataMap) return null;
  const key = normalize(geoName);
  if (dataMap.has(key)) return dataMap.get(key);

  // Direct alias lookup
  const alt = aliases[key];
  if (alt && dataMap.has(normalize(alt))) return dataMap.get(normalize(alt));

  // Reverse alias lookup
  for (const [aliasKey, targetKey] of Object.entries(aliases)) {
    if (normalize(targetKey) === key && dataMap.has(normalize(aliasKey))) {
      return dataMap.get(normalize(aliasKey));
    }
    if (normalize(aliasKey) === key && dataMap.has(normalize(targetKey))) {
      return dataMap.get(normalize(targetKey));
    }
  }

  // Partial / Substring containment check
  for (const [mapKey, val] of dataMap.entries()) {
    if (mapKey.length > 3 && (key.includes(mapKey) || mapKey.includes(key))) {
      return val;
    }
  }
  return null;
}

/* ─── Color scale (light → dark blue) ────────────────────────────────────── */
// #bfe0ff (--sky) → #0a2e86 (--navy-deep)
function interpolateColor(t) {
  const r = Math.round(0xbf + (0x0a - 0xbf) * t);
  const g = Math.round(0xe0 + (0x2e - 0xe0) * t);
  const b = Math.round(0xff + (0x86 - 0xff) * t);
  return `rgb(${r},${g},${b})`;
}

function regionColor(count, maxCount) {
  if (!maxCount || maxCount === 0) return interpolateColor(0.12);
  const t = Math.pow(count / maxCount, 0.6);
  return interpolateColor(0.1 + t * 0.85);
}

// Part A & B: sky-blue hover fill (#bfe0ff = --sky) & boundary stroke
const SKY_HOVER   = '#bfe0ff';
const NO_DATA_COLOR = '#e8f0fb';
const BORDER_STROKE = '#64748b'; // Clear medium-slate boundary outline
const BORDER_STROKE_HOVER = '#1d4ed8';

/* ─── Tooltip ─────────────────────────────────────────────────────────────── */
function MapTooltip({ x, y, content }) {
  if (!content) return null;
  return (
    <div style={{
      position: 'fixed',
      left: x + 14, top: y - 8,
      background: 'var(--navy)', color: '#fff',
      fontSize: '14px', fontWeight: 500,
      padding: '7px 12px', borderRadius: 'var(--radius-sm)',
      pointerEvents: 'none', zIndex: 9999,
      whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      lineHeight: 1.4, border: '1px solid var(--sky)'
    }}>
      {content}
    </div>
  );
}

/* ─── District stat card (local tier) ────────────────────────────────────── */
function DistrictStatCard({ regions }) {
  const region = regions?.[0];
  if (!region) {
    return (
      <div style={{ textAlign: 'center', padding: '32px', color: 'var(--navy-soft)', fontSize: '15px' }}>
        No data available for this district.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', padding: '24px 0' }}>
      <div style={{
        background: 'var(--ice)', border: '1px solid var(--sky)',
        borderRadius: 'var(--radius-md)', padding: '24px 32px',
        textAlign: 'center', minWidth: '160px', boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ fontSize: '34px', fontWeight: 800, color: 'var(--blue)', lineHeight: 1.1 }}>
          {region.complaint_count}
        </div>
        <div style={{ fontSize: '14px', color: 'var(--navy-soft)', marginTop: '4px', fontWeight: 500 }}>
          Total Complaints
        </div>
      </div>
      <div style={{
        background: 'var(--ice)', border: '1px solid var(--sky)',
        borderRadius: 'var(--radius-md)', padding: '24px 32px',
        textAlign: 'center', minWidth: '160px', boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ fontSize: '34px', fontWeight: 800, color: 'var(--navy)', lineHeight: 1.1 }}>
          {region.avg_priority_score}<span style={{ fontSize: '18px', fontWeight: 500 }}>/100</span>
        </div>
        <div style={{ fontSize: '14px', color: 'var(--navy-soft)', marginTop: '4px', fontWeight: 500 }}>
          Avg Priority Score
        </div>
      </div>
    </div>
  );
}

/* ─── GeoJSON Feature Validation & Defensive Handling ────────────────────── */
function validateGeoFeature(geo) {
  if (!geo || typeof geo !== 'object') {
    return { valid: false, reason: 'Feature is not an object' };
  }
  const geom = geo.geometry;
  if (!geom || typeof geom !== 'object') {
    return { valid: false, reason: 'Missing or invalid geometry object' };
  }
  const { type, coordinates } = geom;
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
    return { valid: false, reason: 'Empty or missing coordinates array' };
  }

  const checkRing = (ring, ringPath) => {
    if (!Array.isArray(ring)) return `${ringPath} is not an array`;
    if (ring.length < 4) return `${ringPath} has ${ring.length} points (minimum 4 required for a closed polygon)`;
    for (let i = 0; i < ring.length; i++) {
      const pt = ring[i];
      if (!Array.isArray(pt) || pt.length < 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number' || isNaN(pt[0]) || isNaN(pt[1])) {
        return `${ringPath} point [${i}] is not a valid coordinate pair: ${JSON.stringify(pt)}`;
      }
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return `${ringPath} is not closed (start [${first}] != end [${last}])`;
    }
    return null;
  };

  if (type === 'Polygon') {
    for (let r = 0; r < coordinates.length; r++) {
      const err = checkRing(coordinates[r], `Polygon ring ${r}`);
      if (err) return { valid: false, reason: err };
    }
  } else if (type === 'MultiPolygon') {
    for (let p = 0; p < coordinates.length; p++) {
      const poly = coordinates[p];
      if (!Array.isArray(poly) || poly.length === 0) {
        return { valid: false, reason: `MultiPolygon polygon ${p} is empty or not an array` };
      }
      for (let r = 0; r < poly.length; r++) {
        const err = checkRing(poly[r], `MultiPolygon [${p}][${r}]`);
        if (err) return { valid: false, reason: err };
      }
    }
  } else {
    return { valid: false, reason: `Unsupported geometry type: ${type}` };
  }

  return { valid: true };
}

/* ─── Per-feature Error Boundary ─────────────────────────────────────────── */
class FeatureErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err) {
    console.warn(`[IndiaMap] Rendering error on feature "${this.props.featureName}":`, err?.message || err);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

/* ─── Choropleth map panel ────────────────────────────────────────────────── */
function ChoroplethMap({ geoData, isNational, scopeState, dataMap, maxCount }) {
  const [tooltip, setTooltip] = useState({ x: 0, y: 0, content: null });
  const [hoveredKey, setHoveredKey] = useState(null);
  const containerRef = React.useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 480 });

  const handleMouseMove = useCallback((e) => {
    setTooltip(prev => ({ ...prev, x: e.clientX, y: e.clientY }));
  }, []);

  // Defensive validation of feature geometries
  const safeGeoData = React.useMemo(() => {
    if (!geoData || !Array.isArray(geoData.features)) return geoData;
    const validFeatures = [];
    for (let i = 0; i < geoData.features.length; i++) {
      const feat = geoData.features[i];
      const result = validateGeoFeature(feat);
      if (result.valid) {
        validFeatures.push(feat);
      } else {
        const featName = feat?.properties?.NAME_2 || feat?.properties?.NAME_1 || feat?.properties?.st_nm || `Feature_${i}`;
        console.warn(`[IndiaMap] Skipping malformed feature "${featName}" at index ${i}: ${result.reason}`);
      }
    }
    return {
      ...geoData,
      features: validFeatures
    };
  }, [geoData]);

  // Compute visible features based on tier (National vs State drill-down)
  const visibleFeatures = React.useMemo(() => {
    if (!safeGeoData?.features) return [];
    if (isNational) return safeGeoData.features;
    return safeGeoData.features.filter(geo => {
      const geoState = normalize(geo.properties?.NAME_1 || '');
      return geoState === scopeState ||
        normalize(STATE_ALIASES[scopeState] || '') === geoState ||
        normalize(STATE_ALIASES[geoState] || '') === scopeState;
    });
  }, [safeGeoData, isNational, scopeState]);

  // Observe container dimensions for dynamic responsive sizing
  React.useEffect(() => {
    if (!containerRef.current) return;
    const updateDims = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0) {
        const w = Math.round(rect.width);
        const h = Math.max(380, Math.min(540, Math.round(w * 0.62)));
        setDimensions({ width: w, height: h });
      }
    };
    updateDims();
    const ro = new ResizeObserver(updateDims);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // PART B: Automatic fitExtent projection to make the map fill container properly and stay centered
  const projection = React.useMemo(() => {
    const proj = geoMercator();
    const padding = 16;
    const extent = [
      [padding, padding],
      [dimensions.width - padding, dimensions.height - padding]
    ];

    const targetCollection = !isNational && visibleFeatures.length > 0
      ? { type: 'FeatureCollection', features: visibleFeatures }
      : (safeGeoData?.features?.length > 0 ? safeGeoData : statesGeoData);

    try {
      proj.fitExtent(extent, targetCollection);
    } catch (e) {
      console.warn('[IndiaMap] fitExtent projection fallback:', e);
      proj.fitExtent(extent, statesGeoData);
    }
    return proj;
  }, [dimensions, isNational, visibleFeatures, safeGeoData]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        minHeight: '420px',
        position: 'relative',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden'
      }}
      onMouseMove={handleMouseMove}
    >
      <ComposableMap
        projection={projection}
        width={dimensions.width}
        height={dimensions.height}
        style={{ width: '100%', height: `${dimensions.height}px` }}
      >
        <Geographies geography={safeGeoData}>
          {({ geographies }) => {
            if (!geographies || !Array.isArray(geographies) || geographies.length === 0) {
              return null;
            }
            const geosToRender = isNational
              ? geographies
              : geographies.filter(geo => {
                  const geoState = normalize(geo.properties?.NAME_1 || '');
                  return geoState === scopeState ||
                    normalize(STATE_ALIASES[scopeState] || '') === geoState ||
                    normalize(STATE_ALIASES[geoState] || '') === scopeState;
                });

            return geosToRender.map(geo => {
              const rawName = isNational
                ? (geo.properties?.NAME_1 || 'Unknown')
                : (geo.properties?.NAME_2 || geo.properties?.NAME_1 || 'Unknown');

              const check = validateGeoFeature(geo);
              if (!check.valid) {
                return null;
              }

              const regionData = matchRegion(rawName, dataMap, isNational ? STATE_ALIASES : DISTRICT_ALIASES);
              const count = regionData?.complaint_count ?? 0;
              const avgPs = regionData?.avg_priority_score ?? '—';

              const isHovered = hoveredKey === geo.rsmKey;
              const baseFill = count > 0 ? regionColor(count, maxCount) : NO_DATA_COLOR;
              const fill = isHovered ? SKY_HOVER : baseFill;

              return (
                <FeatureErrorBoundary key={geo.rsmKey || rawName} featureName={rawName}>
                  <Geography
                    geography={geo}
                    fill={fill}
                    stroke={isHovered ? BORDER_STROKE_HOVER : BORDER_STROKE}
                    strokeWidth={isHovered ? 1.6 : 0.85}
                    style={{
                      default:  { outline: 'none', transition: 'fill 0.12s ease, stroke 0.12s ease' },
                      hover:    { outline: 'none', cursor: 'pointer' },
                      pressed:  { outline: 'none' }
                    }}
                    onMouseEnter={() => {
                      setHoveredKey(geo.rsmKey);
                      const label = count > 0
                        ? `${rawName}: ${count} complaint${count !== 1 ? 's' : ''} · Avg priority: ${avgPs}/100`
                        : `${rawName}: No data`;
                      setTooltip(prev => ({ ...prev, content: label }));
                    }}
                    onMouseLeave={() => {
                      setHoveredKey(null);
                      setTooltip(prev => ({ ...prev, content: null }));
                    }}
                  />
                </FeatureErrorBoundary>
              );
            });
          }}
        </Geographies>
      </ComposableMap>

      <MapTooltip x={tooltip.x} y={tooltip.y} content={tooltip.content} />
    </div>
  );
}

/* ─── Main IndiaMap component ─────────────────────────────────────────────── */
export default function IndiaMap({ token, mapData: externalMapData }) {
  const [internalMapData, setInternalMapData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [loaded, setLoaded] = React.useState(false);

  const mapData = externalMapData || internalMapData;

  React.useEffect(() => {
    if (externalMapData) {
      setLoaded(true);
      return;
    }
    if (!token) { setLoaded(true); return; }
    api.getMapData(token)
      .then(data => { setInternalMapData(data); setLoaded(true); })
      .catch(err => { setError(err.message); setLoaded(true); });
  }, [token, externalMapData]);

  // Build lookup map
  const dataMap = React.useMemo(() => {
    const m = new Map();
    if (mapData?.regions) {
      for (const r of mapData.regions) m.set(normalize(r.name), r);
    }
    return m;
  }, [mapData]);

  const maxCount = React.useMemo(
    () => Math.max(1, ...(mapData?.regions?.map(r => r.complaint_count) || [1])),
    [mapData]
  );

  // No map for local tier
  if (loaded && mapData?.level === 'local') return null;

  const level = mapData?.level;
  const scope = mapData?.scope;

  const mapTitle = !level
    ? 'Complaint Density Map'
    : level === 'national'
      ? 'India — Complaint Density by State'
      : level === 'state'
        ? `${scope?.state || 'State'} — Complaint Density by District`
        : `District Summary: ${scope?.district || '—'}`;

  const cardStyle = {
    background: 'var(--white)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-md)',
    padding: '20px',
    boxShadow: 'var(--shadow-sm)'
  };

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
      <MapIcon size={20} color="var(--blue)" />
      <h3 style={{ fontSize: '18px', margin: 0 }}>{mapTitle}</h3>
      {(level === 'national' || level === 'state') && (
        <span style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--navy-soft)' }}>
          Hover for details · Scroll to zoom
        </span>
      )}
    </div>
  );

  // Loading
  if (!loaded) {
    return (
      <div style={cardStyle}>
        {header}
        <div style={{ height: '420px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navy-soft)', fontSize: '15px' }}>
          <div>
            <div style={{
              width: '28px', height: '28px', borderRadius: '50%',
              border: '3px solid var(--line)', borderTopColor: 'var(--blue)',
              animation: 'spin 0.8s linear infinite', margin: '0 auto 10px'
            }} />
            Loading map data…
          </div>
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--rose)', fontSize: '15px' }}>
          <AlertCircle size={18} /> {error}
        </div>
      </div>
    );
  }

  // No token / no data: show placeholder
  if (!mapData) {
    return (
      <div style={cardStyle}>
        {header}
        <div style={{ height: '420px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navy-soft)', fontSize: '15px' }}>
          Map data unavailable — log in as a government official to view.
        </div>
      </div>
    );
  }

  // District tier → stat card (no choropleth needed)
  if (level === 'district') {
    return (
      <div style={cardStyle}>
        {header}
        <DistrictStatCard regions={mapData.regions} />
      </div>
    );
  }

  // National / State tier → choropleth
  const isNational = level === 'national';
  const scopeState = normalize(scope?.state || '');
  const geoData = isNational ? statesGeoData : districtsGeoData;

  return (
    <div style={cardStyle}>
      {header}

      {/* Color legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <span style={{ fontSize: '13px', color: 'var(--navy-soft)' }}>Fewer</span>
        <div style={{
          flex: 1, maxWidth: '140px', height: '8px', borderRadius: '4px',
          background: `linear-gradient(to right, ${interpolateColor(0.1)}, ${interpolateColor(0.95)})`
        }} />
        <span style={{ fontSize: '13px', color: 'var(--navy-soft)' }}>More complaints</span>
        <span style={{ fontSize: '13px', color: 'var(--navy-soft)', marginLeft: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '14px', height: '10px', background: SKY_HOVER, borderRadius: '2px', border: '1px solid #93c5fd' }} />
          Hovered
        </span>
      </div>

      <ChoroplethMap
        geoData={geoData}
        isNational={isNational}
        scopeState={scopeState}
        dataMap={dataMap}
        maxCount={maxCount}
      />

      <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--navy-soft)' }}>
        Shading based on complaint count per region · Hover to inspect exact figures
      </div>
    </div>
  );
}
