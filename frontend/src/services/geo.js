// Boundary GeoJSON (~1 MB each) is fetched on demand as its own chunk, and only the file the
// current tier needs (states for national, districts for state). Promises are memoized so the
// download starts once and is shared across re-renders / remounts.
const geoLoaders = {
  states: () => import('../data/india_states.json').then(m => m.default),
  districts: () => import('../data/india_districts.json').then(m => m.default),
};

const geoPromises = {};

export function loadGeo(kind) {
  if (!geoPromises[kind]) {
    geoPromises[kind] = geoLoaders[kind]().catch(err => {
      delete geoPromises[kind];
      throw err;
    });
  }
  return geoPromises[kind];
}
