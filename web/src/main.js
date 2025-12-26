// Entry point: bootstraps globe and components.
import * as THREE from 'three';
import { createGlobe } from './globe.js';

// Data imports
import markersData from '../../data/samples/markers.json' assert { type: 'json' };
import streamlinesData from '../../data/samples/streamlines.json' assert { type: 'json' };
import windData from '../../data/samples/uv_small.json' assert { type: 'json' };

// Component imports
import { createMarkers } from './components/markers.js';
import { createStreamlines } from './components/streamlines.js';

const canvas = document.getElementById('scene');
const {
  scene,
  camera,
  renderer,
  controls,
  globeRadius,
  assets,
  globeGroup,
  tick,
} = createGlobe(canvas);

// Simple component registry: add components once, update every frame.
const components = new Map();
addComponent('markers', createMarkers, { data: markersData });
addComponent('streamlines', createStreamlines, { data: streamlinesData });
addComponent('wind', createWindComponent, { data: windData });

requestAnimationFrame(animate);

function addComponent(id, factory, { data = null, options = {} } = {}) {
  if (components.has(id)) {
    console.warn(`Component ${id} already exists; skipping`);
    return;
  }
  // Factories follow { group, init, update, dispose } contract (see docs/components.md).
  const instance = factory({
    scene,
    globeRadius,
    assets,
    globeGroup,
    data,
    options,
  });
  components.set(id, instance);
  if (instance.init) instance.init();
}

function removeComponent(id) {
  const inst = components.get(id);
  if (inst?.dispose) inst.dispose();
  components.delete(id);
}

let last = performance.now();
function animate(now = performance.now()) {
  const dt = (now - last) / 1000;
  last = now;

  // Per-frame updates: globe tick first, then components.
  tick(dt);
  components.forEach((inst) => inst.update && inst.update(dt));

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

export { addComponent, removeComponent };

// === Wind helpers: tangent-plane vectors with percentile scaling ===

function latLonToXYZ(latDeg, lonDeg, radius) {
  const phi = THREE.MathUtils.degToRad(90 - latDeg);
  const theta = THREE.MathUtils.degToRad(lonDeg + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function localBasis(latDeg, lonDeg) {
  const r = latLonToXYZ(latDeg, lonDeg, 1).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let north = worldUp.clone().sub(r.clone().multiplyScalar(worldUp.dot(r)));
  if (north.lengthSq() < 1e-12) {
    north = new THREE.Vector3(0, 0, 1);
  }
  north.normalize();
  const east = north.clone().cross(r).normalize(); // right-handed
  return { r, north, east };
}

function uvToVector3(latDeg, lonDeg, u, v) {
  const { north, east } = localBasis(latDeg, lonDeg);
  return east.multiplyScalar(u).add(north.multiplyScalar(v));
}

function percentile(arr, p) {
  if (!arr.length) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length))
  );
  return sorted[idx];
}

function makeScaler({ p10, p90 }, radius) {
  const base = 0.02 * radius;
  const denom = p90 - p10 || 1;
  return (speed) => {
    const t = THREE.MathUtils.clamp((speed - p10) / denom, 0, 1);
    return base * (0.3 + 0.7 * t);
  };
}

export function renderWindVectors(parent, globeRadius, windJson, opts = {}) {
  const group = new THREE.Group();
  parent?.add(group);

  const lats = windJson?.meta?.grid?.lat;
  const lons = windJson?.meta?.grid?.lon;
  const u = windJson?.u;
  const v = windJson?.v;
  if (!lats || !lons || !u || !v) {
    console.warn('renderWindVectors: missing lat/lon/u/v');
    return group;
  }

  const strideBase = opts.stride ?? 12;
  const speedThreshold = opts.speedThreshold ?? 1;
  const opacity = opts.opacity ?? 0.7;
  const color = opts.color ?? 0xffffff;

  // Percentiles
  const speeds = [];
  for (let j = 0; j < lats.length; j++) {
    for (let i = 0; i < lons.length; i++) {
      const uu = u[j]?.[i];
      const vv = v[j]?.[i];
      if (!isFinite(uu) || !isFinite(vv)) continue;
      speeds.push(Math.hypot(uu, vv));
    }
  }
  const p10 = percentile(speeds, 10);
  const p90 = percentile(speeds, 90);
  const scaleLen = makeScaler({ p10, p90 }, globeRadius);

  const positions = [];
  for (let j = 0; j < lats.length; j += strideBase) {
    const lat = lats[j];
    const localStride = Math.abs(lat) > 85 ? strideBase * 2 : strideBase;
    for (let i = 0; i < lons.length; i += localStride) {
      const uu = u[j]?.[i];
      const vv = v[j]?.[i];
      if (!isFinite(uu) || !isFinite(vv)) continue;
      const speed = Math.hypot(uu, vv);
      if (speed < speedThreshold) continue;

      const base = latLonToXYZ(lat, lons[i], globeRadius);
      const dir = uvToVector3(lat, lons[i], uu, vv);
      if (dir.lengthSq() === 0) continue;
      dir.normalize().multiplyScalar(scaleLen(speed));
      const tip = base.clone().add(dir);

      positions.push(base.x, base.y, base.z, tip.x, tip.y, tip.z);
    }
  }

  if (positions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: true,
    });
    const lines = new THREE.LineSegments(geometry, material);
    group.add(lines);
  }

  return group;
}

// Simple factory to integrate with existing addComponent
function createWindComponent({ globeRadius, globeGroup, data }) {
  let windGroup = null;
  return {
    group: new THREE.Group(),
    init() {
      windGroup = renderWindVectors(globeGroup, globeRadius, data, {
        stride: 1,
        speedThreshold: 1,
        opacity: 1,
      });
    },
    update() {},
    dispose() {
      if (windGroup && windGroup.parent) {
        windGroup.parent.remove(windGroup);
      }
      if (windGroup) {
        windGroup.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
    },
  };
}
