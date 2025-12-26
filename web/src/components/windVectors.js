// web/src/components/windVectors.js
import * as THREE from 'three';
import { latLonToVec3 } from '../utils/coords.js';

function degToRad(d) {
  return (Math.PI / 180) * d;
}
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function percentile(arr, p) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const i = Math.min(
    a.length - 1,
    Math.max(0, Math.floor((p / 100) * a.length))
  );
  return a[i];
}

export function createWindVectors({
  globeRadius,
  globeGroup,
  data,
  options = {},
}) {
  const group = new THREE.Group();

  // ---- options (z razumljivimi defaulti) ----
  const strideBase = options.stride ?? 8; // osnovni korak (v indexih)
  const poleStrideMul = options.poleStrideMul ?? 2; // dodatno redčenje pri polih
  const jitterAmt = options.jitter ?? 0.3; // 0..1 majhen random odmik
  const opacity = options.opacity ?? 0.85;
  const speedThreshold = options.speedThreshold ?? 1.0;
  const colorConst = options.color ?? 0x00bcd4;
  const colorBySpeed = options.colorBySpeed ?? true; // barvanje po hitrosti
  const lift = options.lift ?? 0.03; // dvig nad površino

  function init() {
    if (!data?.meta?.grid || !data.u || !data.v) {
      console.warn('windVectors: missing data');
      return;
    }

    const lats = data.meta.grid.lat; // [lat_j]
    const lons = data.meta.grid.lon; // [lon_i]
    const U = data.u; // [j][i]
    const V = data.v; // [j][i]

    // velikost celice (ocena za jitter)
    const dLat = Math.abs((lats[1] ?? lats[0]) - lats[0] || 1);
    const dLon = Math.abs((lons[1] ?? lons[0]) - lons[0] || 1);

    // zberi hitrosti za percentilno skaliranje dolžine
    const speeds = [];
    for (let j = 0; j < lats.length; j++) {
      for (let i = 0; i < lons.length; i++) {
        const u = U[j]?.[i],
          v = V[j]?.[i];
        if (Number.isFinite(u) && Number.isFinite(v))
          speeds.push(Math.hypot(u, v));
      }
    }
    const p10 = percentile(speeds, 10);
    const p90 = percentile(speeds, 90);
    const denom = p90 - p10 || 1;
    const lenBase = 0.012 * globeRadius; // minimalna dolžina
    const lenRange = 0.028 * globeRadius; // dodatna dolžina

    const positions = [];
    const colors = [];

    // helper za barvo po hitrosti (turkiz → bela)
    const color0 = new THREE.Color(0x00bcd4);
    const color1 = new THREE.Color(0xffffff);
    const constColor = new THREE.Color(colorConst);

    for (let j = 0; j < lats.length; j += strideBase) {
      const lat = lats[j];
      // polar thinning: večji korak po long. bližje polom
      const cosw = Math.max(0.001, Math.cos(degToRad(lat)));
      const extra = poleStrideMul * (1 - cosw); // 0 na ekvatorju, ~poleStrideMul na polu
      const lonStep = Math.max(1, Math.round(strideBase * (1 + extra)));

      // rahlo zamakni začetni i, da razbiješ vzorec (hex-like)
      const iOffset = (j / strideBase) % 2 ? Math.floor(lonStep / 2) : 0;

      for (let i = iOffset; i < lons.length; i += lonStep) {
        const u = U[j]?.[i],
          v = V[j]?.[i];
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;

        const speed = Math.hypot(u, v);
        if (speed < speedThreshold) continue;

        // jitter (v stopinjah, sorazmerno s celico)
        const jLat = lat + (Math.random() - 0.5) * dLat * jitterAmt;
        const jLon = lons[i] + (Math.random() - 0.5) * dLon * jitterAmt;

        const start = latLonToVec3(jLat, jLon, globeRadius + lift);

        // lokalna tangentna baza (numerično, na majhen korak)
        const east = latLonToVec3(jLat, jLon + 0.01, globeRadius + lift)
          .sub(start)
          .normalize();
        const north = latLonToVec3(jLat + 0.01, jLon, globeRadius + lift)
          .sub(start)
          .normalize();

        // smer = u*E + v*N
        const dir = east.multiplyScalar(u).add(north.multiplyScalar(v));
        if (dir.lengthSq() === 0) continue;

        // dolžina po percentilih
        const t = clamp01((speed - p10) / denom);
        const segLen = lenBase + lenRange * t;
        dir.normalize().multiplyScalar(segLen);

        const end = start.clone().add(dir);

        positions.push(start.x, start.y, start.z, end.x, end.y, end.z);

        if (colorBySpeed) {
          const c = color0.clone().lerp(color1, t);
          colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
        } else {
          colors.push(
            constColor.r,
            constColor.g,
            constColor.b,
            constColor.r,
            constColor.g,
            constColor.b
          );
        }
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthTest: true,
    });

    const lines = new THREE.LineSegments(geom, mat);
    group.add(lines);
    globeGroup?.add(group);
  }

  function dispose() {
    if (globeGroup && group.parent === globeGroup) globeGroup.remove(group);
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    group.clear();
  }

  return { group, init, update() {}, dispose };
}
