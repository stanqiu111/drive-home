// OpenStreetMap data for all of Edmonton, cut into small tiles in public/osm/ by
// tools/build-osm-tiles.mjs (from the Geofabrik Alberta extract). The map builder reads
// them in Node (tools/build-maps.mjs) and in the browser (custom routes), so both get
// exactly the same data. The public Overpass servers turn browsers away, so the game
// serves this itself.
//
// A tile covers TLON × TLAT degrees (about 1.7 × 1.7 km). Its file holds every kept way
// that touches it, whole (ways that cross tiles are in each, so readers drop duplicates by
// id), plus the traffic signals and named places (POIs) inside it:
//   { v: 1, tags: [{…}, …],
//     ways: [[id, tagIndex, [lon7, lat7, dLon7, dLat7, …]], …],   coordinates ×1e7, delta coded
//     signals: [id, lon7, lat7, id, lon7, lat7, …],
//     pois: [[id, lon7, lat7, tagIndex], …] }        (a place mapped as an area: -way id, at its centre)
// Ways are roads, buildings and areas (osmWayKind) with WAY_KEYS tags, and railways
// (isRail) with RAIL_KEYS tags.
import { osmWayKind, isRail, corridorCells, ROAD_RADIUS } from './core.js';

export const TILE_VERSION = 1;
export const TLON = 0.025;
export const TLAT = 0.015;
// Edmonton's city limits (lat 53.337–53.716, lon -113.714 – -113.272) plus about 4.5 km, so
// routes near the edge, Sherwood Park and the refineries are covered.
export const COVER = { west: -113.785, east: -113.2, south: 53.297, north: 53.757 };
// Tags kept on named places: what they are and what they're called.
export const POI_KEYS = ['name', 'brand', 'amenity', 'shop', 'tourism', 'office', 'leisure', 'cuisine', 'operator'];
export const isPoi = (t) => !!t && (t.amenity === 'fuel' || (!!(t.name || t.brand) && !!(t.amenity || t.shop || t.tourism || t.office || t.leisure)));

export const tileOf = (lon, lat) => [Math.floor(lon / TLON), Math.floor(lat / TLAT)];
export const tileKey = (tx, ty) => `${tx}_${ty}`;
export const tileUrl = (key) => `/osm/t/${key}.json`;
export const inCover = (lon, lat) => lon >= COVER.west && lon <= COVER.east && lat >= COVER.south && lat <= COVER.north;

// The tiles that hold everything the builder keeps near these routes (osmNearRoutes): the
// tiles under every corridor cell, padded by one cell.
export function tilesForRoutes(routes, proj) {
  const cell = 100;
  const inside = corridorCells(routes, ROAD_RADIUS + 200, cell);
  const keys = new Set();
  const rr = Math.ceil((ROAD_RADIUS + 200) / cell) + 1;
  const seen = new Set();
  for (const pts of routes) {
    for (let i = 0; i < pts.length; i += 10) {
      const cx = Math.floor(pts[i][0] / cell);
      const cz = Math.floor(pts[i][1] / cell);
      for (let a = -rr; a <= rr; a++) {
        for (let b = -rr; b <= rr; b++) {
          const k = `${cx + a},${cz + b}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const x = (cx + a) * cell;
          const z = (cz + b) * cell;
          if (!inside(x + cell / 2, z + cell / 2)) continue;
          for (const [dx, dz] of [[0, 0], [cell, 0], [0, cell], [cell, cell]]) {
            const [lon, lat] = proj.unproject(x + dx, z + dz);
            keys.add(tileKey(...tileOf(lon, lat)));
          }
        }
      }
    }
  }
  return keys;
}

// Tile files → { ways: [{ t, c }], rails: [{ t, c }], signals: [[lon, lat]], pois: [{ t, c: [lon, lat] }] },
// coordinates as plain degrees (lon7 / 1e7, like the old corridor extract), ways once each
// in id order.
export function mergeTiles(tiles) {
  const byId = new Map();
  const sig = new Map();
  const poi = new Map();
  for (const tile of tiles) {
    if (!tile) continue;
    for (const [id, ti, d] of tile.ways) {
      if (byId.has(id)) continue;
      const c = new Array(d.length);
      let lon = 0;
      let lat = 0;
      for (let k = 0; k < d.length; k += 2) {
        lon += d[k];
        lat += d[k + 1];
        c[k] = lon / 1e7;
        c[k + 1] = lat / 1e7;
      }
      byId.set(id, { id, t: tile.tags[ti], c });
    }
    for (let k = 0; k < tile.signals.length; k += 3) sig.set(tile.signals[k], [tile.signals[k + 1] / 1e7, tile.signals[k + 2] / 1e7]);
    for (const [id, lon, lat, ti] of tile.pois) poi.set(id, { t: tile.tags[ti], c: [lon / 1e7, lat / 1e7] });
  }
  const byKey = (m) => [...m.keys()].sort((a, b) => a - b).map((k) => m.get(k));
  const signals = byKey(sig);
  const pois = byKey(poi);
  const ways = [];
  const rails = [];
  for (const id of [...byId.keys()].sort((a, b) => a - b)) {
    const w = byId.get(id);
    if (osmWayKind(w.t)) ways.push({ t: w.t, c: w.c });
    else if (isRail(w.t)) rails.push({ t: w.t, c: w.c });
  }
  return { ways, rails, signals, pois };
}
