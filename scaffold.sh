#!/usr/bin/env bash
set -euo pipefail

echo "Scaffolding modular globe project (non-destructive)..."

mkdir -p \
  web/src/components/templates \
  web/src/assets \
  web/src/utils \
  data/samples \
  data/scripts \
  docs

touch web/src/assets/.gitkeep
touch data/samples/.gitkeep

# web/index.html
if [ ! -e web/index.html ]; then
cat > web/index.html <<'EOF'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Wind Viz</title>
</head>
<body>
  <canvas id="scene"></canvas>
  <script type="module" src="./src/main.js"></script>
</body>
</html>
EOF
else
  echo "skip: web/index.html exists"
fi

# web/src/main.js
if [ ! -e web/src/main.js ]; then
cat > web/src/main.js <<'EOF'
// Entry point: bootstraps globe and components.
import { createGlobe } from "./globe.js";
// Example: import { createStreamlines } from "./components/streamlines.js";

const canvas = document.getElementById("scene");
const { scene, camera, renderer, controls, globeRadius, assets, tick } = createGlobe(canvas);

// Simple component registry
const components = new Map();

function addComponent(id, factory, { data = null, options = {} } = {}) {
  if (components.has(id)) {
    console.warn(\`Component \${id} already exists; skipping\`);
    return;
  }
  const instance = factory({ scene, globeRadius, assets, data, options });
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

  tick(dt);
  components.forEach((inst) => inst.update && inst.update(dt));

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Example usage (wire real data later):
// import sampleData from "../data/samples/streamlines.json" assert { type: "json" };
// addComponent("streamlines", createStreamlines, { data: sampleData });

export { addComponent, removeComponent };
EOF
else
  echo "skip: web/src/main.js exists"
fi

# web/src/globe.js
if [ ! -e web/src/globe.js ]; then
cat > web/src/globe.js <<'EOF'
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js";

export function createGlobe(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 4);
  scene.add(camera);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.position.set(5, 5, 5);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));

  const globeRadius = 1.6;
  const assets = {}; // populate with loaders/caches later if needed

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);

  const tick = () => {};

  return { scene, camera, renderer, controls, globeRadius, assets, tick };
}
EOF
else
  echo "skip: web/src/globe.js exists"
fi

# web/src/utils/coords.js
if [ ! -e web/src/utils/coords.js ]; then
cat > web/src/utils/coords.js <<'EOF'
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export function latLonToVec3(lat, lon, radius) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}
EOF
else
  echo "skip: web/src/utils/coords.js exists"
fi

# web/src/utils/loader.js
if [ ! -e web/src/utils/loader.js ]; then
cat > web/src/utils/loader.js <<'EOF'
// Placeholder for shared loaders with caching (GLB, textures).
export function createAssetCache() {
  const cache = new Map();
  return {
    get(key) { return cache.get(key); },
    set(key, value) { cache.set(key, value); return value; },
    has(key) { return cache.has(key); },
    clear() { cache.clear(); }
  };
}
EOF
else
  echo "skip: web/src/utils/loader.js exists"
fi

# Component templates
if [ ! -e web/src/components/templates/streamlines.js ]; then
cat > web/src/components/templates/streamlines.js <<'EOF'
// Streamlines template.
// Expects data: [{ points: [{lat, lon, alt}], color, speed }]
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { latLonToVec3 } from "../utils/coords.js";

export function createStreamlines({ scene, globeRadius, data = [], options = {} }) {
  const group = new THREE.Group();
  scene.add(group);

  function init() {
    data.forEach((line) => {
      const pts = (line.points || []).map((p) => latLonToVec3(p.lat, p.lon, globeRadius + (p.alt || 0)));
      const geometry = new THREE.BufferGeometry().setFromPoints(pts);
      const material = new THREE.LineBasicMaterial({ color: line.color || 0x78c7ff, transparent: true, opacity: 0.9 });
      const mesh = new THREE.Line(geometry, material);
      mesh.userData.speed = line.speed || 0;
      group.add(mesh);
    });
  }

  function update(dt) {
    // animate dash/offset/etc. if desired
  }

  function dispose() {
    group.traverse((obj) => {
      if (obj.isLine) obj.geometry.dispose(), obj.material.dispose();
    });
    scene.remove(group);
  }

  return { group, init, update, dispose };
}
EOF
else
  echo "skip: web/src/components/templates/streamlines.js exists"
fi

if [ ! -e web/src/components/templates/markers.js ]; then
cat > web/src/components/templates/markers.js <<'EOF'
// Markers template.
// Expects data: [{ path: [{t, lat, lon, alt}], color, size }]
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { latLonToVec3 } from "../utils/coords.js";

export function createMarkers({ scene, globeRadius, data = [], options = {} }) {
  const group = new THREE.Group();
  scene.add(group);

  function init() {
    data.forEach((marker) => {
      const geom = new THREE.SphereGeometry(marker.size || 0.03, 16, 16);
      const mat = new THREE.MeshBasicMaterial({ color: marker.color || 0xffaa55 });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData.path = marker.path || [];
      mesh.userData.t = 0;
      group.add(mesh);
    });
  }

  function update(dt) {
    group.children.forEach((mesh) => {
      const path = mesh.userData.path;
      if (!path || path.length === 0) return;
      mesh.userData.t = (mesh.userData.t + dt) % 1;
      const idx = Math.floor(mesh.userData.t * path.length);
      const p = path[idx];
      if (!p) return;
      const pos = latLonToVec3(p.lat, p.lon, globeRadius + (p.alt || 0));
      mesh.position.copy(pos);
      mesh.lookAt(0, 0, 0);
    });
  }

  function dispose() {
    group.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        obj.material.dispose();
      }
    });
    scene.remove(group);
  }

  return { group, init, update, dispose };
}
EOF
else
  echo "skip: web/src/components/templates/markers.js exists"
fi

# docs/components.md
if [ ! -e docs/components.md ]; then
cat > docs/components.md <<'EOF'
# Components contract

- Factory signature: `factory({ scene, globeRadius, assets, data, options })`.
- Must return: `{ group, init(), update(dt), dispose() }` and add its objects to `group`.
- Data schemas:
  - Streamlines: `[{ points:[{lat,lon,alt}], color, speed }]`
  - Markers: `[{ path:[{t, lat, lon, alt}], color, size }]`
- `main` owns the registry and calls `update(dt)` each frame.

# Adding a new component
1. Copy a template from `web/src/components/templates/` into `web/src/components/`.
2. Define the expected `data` shape in this doc.
3. Keep all Three.js objects inside your `group`; clean up in `dispose()`.
EOF
else
  echo "skip: docs/components.md exists"
fi

# data/scripts/README.md
if [ ! -e data/scripts/README.md ]; then
cat > data/scripts/README.md <<'EOF'
Data prep scripts go here (fetch, slice, precompute streamlines/paths).
Emit small artifacts into ../samples matching the component schemas.
EOF
else
  echo "skip: data/scripts/README.md exists"
fi

# sample data
if [ ! -e data/samples/streamlines.json ]; then
cat > data/samples/streamlines.json <<'EOF'
[
  {
    "color": "#78c7ff",
    "speed": 0.2,
    "points": [
      { "lat": 40, "lon": -20, "alt": 0.02 },
      { "lat": 35, "lon": 10, "alt": 0.02 },
      { "lat": 30, "lon": 40, "alt": 0.02 }
    ]
  }
]
EOF
else
  echo "skip: data/samples/streamlines.json exists"
fi

echo "Done. Review created files, then git add/push as needed."