// Entry point: bootstraps globe and components.
import { createGlobe } from './globe.js';

// Data imports
import markersData from '../../data/samples/markers.json' with { type: 'json' };
import streamlinesData from '../../data/samples/streamlines.json' with { type: 'json' };

// Component imports
import { createMarkers } from './components/markers.js';
import { createStreamlines } from './components/streamlines.js';
//import { createWindVectors } from './components/windVectors.js';
import { createInteractiveWind } from './components/interactiveWind.js';
import { createWindLegend } from './components/windLegend.js';
import { createWindLevelControl } from './components/windLevelControl.js';
import { createGlobalWindStreamlines } from './components/globalWindStreamlines.js';
import { createToggleControl } from './components/toggleControl.js';

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

// -----------------------
// Multi-level wind loading
// -----------------------
const WIND_LEVEL_MIN = 0;
const WIND_LEVEL_MAX = 50;
const INITIAL_WIND_LEVEL = 0;

function windLevelToUrl(level) {
  // /data/wind/uv_level_000.json ... uv_level_050.json
  const padded = String(level).padStart(3, '0');
  return `/data/wind/uv_level_${padded}.json`;
}

function windLevelsManifestUrl() {
  return '/data/wind/levels.json';
}

async function loadWindLevelsManifest() {
  const url = windLevelsManifestUrl();
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Failed to load wind levels manifest: ${res.status} ${res.statusText} (${url})\n` +
        `Response (first 200 chars): ${text.slice(0, 200)}`
    );
  }
  try {
    const parsed = JSON.parse(text);
    const levels = Array.isArray(parsed?.levels) ? parsed.levels : [];
    return levels
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);
  } catch {
    throw new Error(
      `Invalid JSON for wind levels manifest (${url})\n` +
        `Response (first 200 chars): ${text.slice(0, 200)}`
    );
  }
}

function nearestAvailableLevel(level, availableLevels) {
  if (!availableLevels?.length) return level;
  let best = availableLevels[0];
  let bestDist = Math.abs(level - best);
  for (let i = 1; i < availableLevels.length; i++) {
    const v = availableLevels[i];
    const d = Math.abs(level - v);
    if (d < bestDist) {
      best = v;
      bestDist = d;
    }
  }
  return best;
}

async function loadWindLevel(level) {
  const url = windLevelToUrl(level);
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Failed to load wind level ${level}: ${res.status} ${res.statusText} (${url})\n` +
        `Response (first 200 chars): ${text.slice(0, 200)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Invalid JSON for wind level ${level} (${url})\n` +
        `Response (first 200 chars): ${text.slice(0, 200)}`
    );
  }
}

let availableWindLevels = null;
let currentWindLevel = INITIAL_WIND_LEVEL;
let currentWindData = null;
let showGlobalStreamlines = true;

function ensureGlobalStreamlines(data) {
  if (!showGlobalStreamlines) return;
  if (!data) return;
  if (components.has('globalWindStreamlines')) return;

  addComponent('globalWindStreamlines', createGlobalWindStreamlines, {
    data,
    options: {
      seedStrideLat: 10,
      seedStrideLon: 10,
      maxLines: 650,
      steps: 110,
      minSpeed: 1.2,
      opacity: 0.45,
      lift: 0.04,
      color: 0x78c7ff,
    },
  });
}

async function setWindLevel(requestedLevel) {
  const control = components.get('windLevelControl');

  const level = nearestAvailableLevel(requestedLevel, availableWindLevels);
  currentWindLevel = level;
  if (requestedLevel !== level) {
    control?.setValue(level, { emit: false });
  }

  try {
    control?.setDisabled(true);
    control?.setStatus('Loading…');

    const data = await loadWindLevel(level);
    currentWindData = data;

    removeComponent('interactiveWind');
    removeComponent('globalWindStreamlines');

    // Optional: add global streamlines (can be toggled off)
    ensureGlobalStreamlines(data);

    addComponent('interactiveWind', createInteractiveWind, {
      data,
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

    control?.setStatus('');
  } catch (err) {
    console.error(err);
    control?.setStatus('Failed to load level (see console)');
  } finally {
    control?.setDisabled(false);
  }
}

// Wind level UI
addComponent('windLevelControl', createWindLevelControl, {
  options: {
    position: 'bottom-left',
    title: 'Wind Level',
    min: WIND_LEVEL_MIN,
    max: WIND_LEVEL_MAX,
    step: 1,
    initial: INITIAL_WIND_LEVEL,
    formatLabel: (v) => `Level ${v}`,
    onLevelChange: (level) => {
      setWindLevel(level);
    },
  },
});

// Wind legend
addComponent('windLegend', createWindLegend, {
  options: {
    position: 'bottom-right',
    title: 'Wind Speed',
  },
});

// Toggle: global streamlines
addComponent('globalStreamlinesToggle', createToggleControl, {
  options: {
    position: 'top-right',
    title: 'Global streamlines',
    initial: showGlobalStreamlines,
    onChange: (enabled) => {
      showGlobalStreamlines = enabled;
      if (!enabled) {
        removeComponent('globalWindStreamlines');
      } else {
        ensureGlobalStreamlines(currentWindData);
      }
    },
  },
});


(async () => {
  const control = components.get('windLevelControl');
  try {
    control?.setStatus('Loading levels…');
    availableWindLevels = await loadWindLevelsManifest();

    if (availableWindLevels.length) {
      control?.setBounds({
        nextMin: availableWindLevels[0],
        nextMax: availableWindLevels[availableWindLevels.length - 1],
        nextStep: 1,
      });

      const initial = nearestAvailableLevel(INITIAL_WIND_LEVEL, availableWindLevels);
      control?.setValue(initial, { emit: false });
      control?.setStatus('');
      await setWindLevel(initial);
      return;
    }

    control?.setStatus('No levels.json (falling back)');
    await setWindLevel(INITIAL_WIND_LEVEL);
  } catch (e) {
    console.error(e);
    control?.setStatus('No levels.json (falling back)');
    await setWindLevel(INITIAL_WIND_LEVEL);
  }
})();

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

export { addComponent, removeComponent };
