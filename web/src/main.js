// Entry point: bootstraps globe and components.
import { createGlobe } from './globe.js';

// Data imports
import markersData from '../../data/samples/markers.json' with { type: 'json' };
import streamlinesData from '../../data/samples/streamlines.json' with { type: 'json' };
import windData from '../../data/samples/uv_small.json' with { type: 'json' };

// Component imports
import { createMarkers } from './components/markers.js';
import { createStreamlines } from './components/streamlines.js';
//import { createWindVectors } from './components/windVectors.js';
import { createInteractiveWind } from './components/interactiveWind.js';
import { createWindLegend } from './components/windLegend.js';

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
  setAutoRotate,
} = createGlobe(canvas);

// Simple component registry: add components once, update every frame.
const components = new Map();
addComponent('markers', createMarkers, { data: markersData });
addComponent('streamlines', createStreamlines, { data: streamlinesData });

// Interaktivna wind komponenta z listki
addComponent('interactiveWind', createInteractiveWind, {
  data: windData,
  options: {
    stride: 3,
    poleStrideMul: 3,
    jitter: 0.35,
    speedThreshold: 1.5,
    opacity: 0.9,
    leafScale: 1.5,
    animDuration: 10.0,
    animLoop: true,
    setAutoRotate,
  },
});

// Wind legend
addComponent('windLegend', createWindLegend, {
  options: {
    position: 'bottom-right',
    title: 'Wind Speed',
  },
});

requestAnimationFrame(animate);

function addComponent(id, factory, { data = null, options = {} } = {}) {
  if (components.has(id)) {
    console.warn(`Component ${id} already exists; skipping`);
    return;
  }
  // Factories follow { group, init, update, dispose } contract (see docs/components.md).
  const instance = factory({
    scene,
    camera,
    renderer,
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

// Example usage (wire real data later):
// import sampleData from "../data/samples/streamlines.json" assert { type: "json" };
// addComponent("streamlines", createStreamlines, { data: sampleData });

export { addComponent, removeComponent };
