// web/src/components/globalWindStreamlines.js
// Global streamlines for wind U/V on a lat/lon grid.
//
// This component builds many streamlines (integrated curves) across the globe.
// It is more informative than short vector glyphs, but more expensive.
//
// Data schema expected (same as interactiveWind):
// {
//   meta: { grid: { lat: number[], lon: number[] }, level?: any, time?: any },
//   u: number[][], // [j][i]
//   v: number[][]  // [j][i]
// }

import * as THREE from 'three';
import { latLonToVec3 } from '../utils/coords.js';

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function wrapLon180(lon) {
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Bilinear interpolation on a regular lat/lon grid.
// - lat array is monotonic (either increasing or decreasing)
// - lon array is monotonic increasing and covers [-180..180] or [0..360)
function sampleBilinear(lat, lon, lats, lons, U, V) {
  const nLat = lats.length;
  const nLon = lons.length;
  if (nLat < 2 || nLon < 2) return null;

  // Normalize lon to grid domain
  const lon0 = lons[0];
  const lonN = lons[nLon - 1];

  // handle typical 0..360 grids by mapping query into same range
  let qLon = lon;
  const gridIs360 = lon0 >= 0 && lonN > 180;
  if (gridIs360) {
    // map [-180,180] -> [0,360)
    if (qLon < 0) qLon += 360;
  }

  // Clamp into range (avoids searching edge cases)
  const minLon = Math.min(lon0, lonN);
  const maxLon = Math.max(lon0, lonN);
  qLon = clamp(qLon, minLon, maxLon);

  // Lat monotonic direction
  const latInc = lats[1] > lats[0];
  const minLat = latInc ? lats[0] : lats[nLat - 1];
  const maxLat = latInc ? lats[nLat - 1] : lats[0];
  const qLat = clamp(lat, minLat, maxLat);

  // Find surrounding cell on lon
  let i1 = 1;
  while (i1 < nLon && lons[i1] < qLon) i1++;
  i1 = clamp(i1, 1, nLon - 1);
  const i0 = i1 - 1;

  // Find surrounding cell on lat
  let j1 = 1;
  if (latInc) {
    while (j1 < nLat && lats[j1] < qLat) j1++;
  } else {
    while (j1 < nLat && lats[j1] > qLat) j1++;
  }
  j1 = clamp(j1, 1, nLat - 1);
  const j0 = j1 - 1;

  const lonA = lons[i0];
  const lonB = lons[i1];
  const latA = lats[j0];
  const latB = lats[j1];

  const tx = lonB === lonA ? 0 : (qLon - lonA) / (lonB - lonA);
  const ty = latB === latA ? 0 : (qLat - latA) / (latB - latA);

  const u00 = U[j0]?.[i0];
  const u10 = U[j0]?.[i1];
  const u01 = U[j1]?.[i0];
  const u11 = U[j1]?.[i1];
  const v00 = V[j0]?.[i0];
  const v10 = V[j0]?.[i1];
  const v01 = V[j1]?.[i0];
  const v11 = V[j1]?.[i1];

  if (![u00, u10, u01, u11, v00, v10, v01, v11].every(Number.isFinite)) return null;

  const u0 = lerp(u00, u10, tx);
  const u1 = lerp(u01, u11, tx);
  const v0 = lerp(v00, v10, tx);
  const v1 = lerp(v01, v11, tx);

  const u = lerp(u0, u1, ty);
  const v = lerp(v0, v1, ty);

  return { u, v };
}

function percentile(arr, p) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * a.length)));
  return a[i];
}

export function createGlobalWindStreamlines({
  scene,
  globeRadius,
  globeGroup,
  data,
  options = {},
}) {
  const parent = options.attachTo || globeGroup || scene;
  const group = new THREE.Group();
  parent.add(group);

  const lift = options.lift ?? 0.035;
  const opacity = options.opacity ?? 0.55;
  const lineWidth = options.lineWidth ?? 1; // note: most platforms ignore linewidth

  // seeding / integration
  const seedStrideLat = options.seedStrideLat ?? 8;
  const seedStrideLon = options.seedStrideLon ?? 8;
  const maxLines = options.maxLines ?? 800;

  const steps = options.steps ?? 120;
  const stepDeg = options.stepDeg ?? 0.35; // degrees per step at speed=1 (heuristic)
  const minSpeed = options.minSpeed ?? 1.0;

  // visual
  const color = new THREE.Color(options.color ?? 0x78c7ff);

  function disposeGeometry() {
    group.traverse((obj) => {
      if (obj.isLine) {
        obj.geometry?.dispose?.();
        obj.material?.dispose?.();
      }
    });
    group.clear();
  }

  function build() {
    disposeGeometry();

    if (!data?.meta?.grid || !data.u || !data.v) {
      console.warn('globalWindStreamlines: missing data');
      return;
    }

    const lats = data.meta.grid.lat;
    const lons = data.meta.grid.lon;
    const U = data.u;
    const V = data.v;

    // Precompute speed percentiles for alpha modulation (optional)
    const speeds = [];
    for (let j = 0; j < lats.length; j++) {
      for (let i = 0; i < lons.length; i++) {
        const u = U[j]?.[i];
        const v = V[j]?.[i];
        if (Number.isFinite(u) && Number.isFinite(v)) speeds.push(Math.hypot(u, v));
      }
    }
    const p20 = percentile(speeds, 20) || 0;
    const p80 = percentile(speeds, 80) || (p20 + 1);
    const denom = p80 - p20 || 1;

    let added = 0;

    for (let j0 = 0; j0 < lats.length; j0 += seedStrideLat) {
      for (let i0 = 0; i0 < lons.length; i0 += seedStrideLon) {
        if (added >= maxLines) break;

        const seedLat = lats[j0];
        const seedLon = lons[i0];

        const s0 = sampleBilinear(seedLat, seedLon, lats, lons, U, V);
        if (!s0) continue;
        const seedSpeed = Math.hypot(s0.u, s0.v);
        if (seedSpeed < minSpeed) continue;

        // Integrate forward only (keeps it cheaper); can add backward later.
        const pts = [];
        let lat = seedLat;
        let lon = seedLon;

        for (let k = 0; k < steps; k++) {
          const s = sampleBilinear(lat, lon, lats, lons, U, V);
          if (!s) break;
          const speed = Math.hypot(s.u, s.v);
          if (!Number.isFinite(speed) || speed < minSpeed) break;

          // point
          pts.push(latLonToVec3(lat, wrapLon180(lon), globeRadius + lift));

          // integrate in lat/lon degrees (heuristic, but stable for visualization)
          // NOTE: A more physically-correct integration would account for cos(lat).
          const dLat = s.v * stepDeg * 0.3;
          const dLon = s.u * stepDeg * 0.3;
          lat += dLat;
          lon += dLon;

          if (lat < -89.5 || lat > 89.5) break;
        }

        if (pts.length < 2) continue;

        const geom = new THREE.BufferGeometry().setFromPoints(pts);

        // Vary opacity slightly with seed speed (keeps structure visible)
        const t = clamp((seedSpeed - p20) / denom, 0, 1);
        const mat = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: opacity * (0.35 + 0.65 * t),
          linewidth: lineWidth,
          depthTest: true,
        });

        group.add(new THREE.Line(geom, mat));
        added++;
      }
      if (added >= maxLines) break;
    }

    if (added === 0) {
      console.warn('globalWindStreamlines: built 0 lines (try lowering minSpeed or seedStride)');
    }
  }

  function init() {
    build();
  }

  function update() {
  }

  function dispose() {
    disposeGeometry();
    parent.remove(group);
  }

  return { group, init, update, dispose };
}

