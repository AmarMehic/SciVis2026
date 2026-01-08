// Entry point: bootstraps globe and components.
import { createGlobe } from './globe.js';

console.info('main.js loaded')

// Data imports
import markersData from '../../data/samples/markers.json' assert { type: 'json' };
import streamlinesData from '../../data/samples/streamlines.json' assert { type: 'json' };
import windData from '../../data/samples/uv_small.json' assert { type: 'json' };

// Component imports
import { createMarkers } from './components/markers.js';
import { createStreamlines } from './components/streamlines.js';
import { createWindVectors } from './components/windVectors.js';
import StreamLoader from './utils/StreamLoader.js';

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
addComponent('wind', createWindVectors, {
  data: windData,
  options: {
    stride: 3,
    poleStrideMul: 3,
    jitter: 0.35,
    speedThreshold: 1.5,
    colorBySpeed: true,
    opacity: 0.9,
  },
  // pass camera and renderer so components can compute visible bounds
  camera,
  renderer,
});

// Attempt to load preloaded global snapshot from the backend and render it.
// This will be fast because the server preloads root tiles at startup.
(async function preloadAndRender() {
  try {
    const loader = new StreamLoader('');
    const snapshot = await loader.loadGlobalSnapshot(0);
    const windInst = components.get('wind');
    if (windInst && typeof windInst.renderGlobalSnapshot === 'function') {
      windInst.renderGlobalSnapshot(snapshot);
      console.info('Rendered global snapshot from server');
    }
  } catch (err) {
    console.warn('Failed to load global snapshot:', err);
  }
})();

requestAnimationFrame(animate);

function addComponent(id, factory, props = {}) {
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
    ...props,
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
let playbackTime = 0; // seconds, advances by dt each frame
let isPlaying = false; // Stream playback state

function animate(now = performance.now()) {
  const dt = (now - last) / 1000;
  last = now;
  
  // Only advance playback time when playing
  if (isPlaying) {
    playbackTime += dt;
  }

  // Per-frame updates: globe tick first, then components.
  tick(dt);
  // Call update(currentTime, visibleBounds). For now we pass null for visibleBounds.
  components.forEach((inst) => inst.update && inst.update(playbackTime, null));

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// Stream control functions
const BACKEND_URL = 'http://localhost:8000';

async function sendStreamControl(action) {
  const currentTime = Math.floor(playbackTime);
  const payload = { action, currentTime };
  
  try {
    const response = await fetch(`${BACKEND_URL}/stream/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Stream control failed');
    }
    
    const result = await response.json();
    console.info('Stream control response:', result);
    return result;
  } catch (error) {
    console.error('Stream control error:', error);
    updateStatus(`Error: ${error.message}`, true);
    throw error;
  }
}

function updateStatus(text, isError = false) {
  const statusEl = document.getElementById('statusText');
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? '#ff6b6b' : '#aaa';
  }
}

// Wire up play/pause buttons
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');

if (playBtn) {
  playBtn.addEventListener('click', async () => {
    playBtn.disabled = true;
    updateStatus('Starting stream...');
    
    try {
      const result = await sendStreamControl('play');
      isPlaying = true;
      playBtn.disabled = true;
      pauseBtn.disabled = false;
      updateStatus(result.bufferActive ? 'Playing (buffer active)' : 'Playing');
    } catch (error) {
      playBtn.disabled = false;
    }
  });
}

if (pauseBtn) {
  pauseBtn.addEventListener('click', async () => {
    pauseBtn.disabled = true;
    updateStatus('Pausing stream...');
    
    try {
      await sendStreamControl('pause');
      isPlaying = false;
      playBtn.disabled = false;
      pauseBtn.disabled = true;
      updateStatus('Paused');
    } catch (error) {
      pauseBtn.disabled = false;
    }
  });
}

// Example usage (wire real data later):
// import sampleData from "../data/samples/streamlines.json" assert { type: "json" };
// addComponent("streamlines", createStreamlines, { data: sampleData });

export { addComponent, removeComponent };
