import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createAssetCache } from "./utils/loader.js";

const earthModelUrl = new URL("./assets/models/earth.glb", import.meta.url).href;

function createStarLayer({
  count = 1200,
  radius = 40,
  spread = 18,
  size = 0.02,
  opacity = 0.9,
}) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const cool = new THREE.Color(0x8fb8ff);
  const warm = new THREE.Color(0xfff2c2);

  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius + Math.random() * spread;

    const sinPhi = Math.sin(phi);
    const x = r * sinPhi * Math.cos(theta);
    const y = r * Math.cos(phi);
    const z = r * sinPhi * Math.sin(theta);

    const idx = i * 3;
    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;

    const tint = cool.clone().lerp(warm, Math.random());
    const intensity = 0.6 + Math.random() * 0.4;
    tint.multiplyScalar(intensity);
    colors[idx] = tint.r;
    colors[idx + 1] = tint.g;
    colors[idx + 2] = tint.b;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    sizeAttenuation: true,
  });

  return new THREE.Points(geometry, material);
}

function createStarfield() {
  const group = new THREE.Group();
  const fineStars = createStarLayer({
    count: 1600,
    radius: 38,
    spread: 22,
    size: 0.018,
    opacity: 0.85,
  });
  const brightStars = createStarLayer({
    count: 280,
    radius: 36,
    spread: 18,
    size: 0.045,
    opacity: 0.95,
  });

  group.add(fineStars);
  group.add(brightStars);
  return group;
}

export function createGlobe(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0b1020, 1);

  const scene = new THREE.Scene();
  const starfield = createStarfield();
  scene.add(starfield);
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 4);
  scene.add(camera);

  const globeRadius = 1.3;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;

  // Allow zooming for close inspection
  controls.enableZoom = true;
  // Anything below (globeRadius + margin) risks clipping/entering the surface.
  const minZoomDistance = globeRadius + 0.55;
  const maxZoomDistance = 6.0;
  controls.minDistance = minZoomDistance;
  controls.maxDistance = maxZoomDistance;

  scene.add(new THREE.HemisphereLight(0x7fb7ff, 0x111622, 5));
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const assets = createAssetCache();
  assets.set("surfaceRadius", globeRadius);

  const loader = new GLTFLoader();
  const globeGroup = new THREE.Group();
  scene.add(globeGroup);

  loader.load(
    earthModelUrl,
    (gltf) => {
      assets.set("earth.glb", gltf.scene);

      const model = gltf.scene.clone(true);

      // Ensure world matrices are current for accurate measurement
      model.updateMatrixWorld(true);

      // Center by AABB center (works for any model shape)
      const box0 = new THREE.Box3().setFromObject(model);
      const center = box0.getCenter(new THREE.Vector3());
      model.position.sub(center);

      model.updateMatrixWorld(true);

      // Use inscribed radius from AABB (half of smallest dimension)
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const inscribedRadius = 0.5 * Math.min(size.x, size.y, size.z) || 1;

      const fudge = 1.0;

      const scale = (globeRadius / inscribedRadius) * fudge;

      const container = new THREE.Group();
      container.add(model);
      container.scale.setScalar(scale);

      globeGroup.add(container);

      // Debug-friendly, consistent surface radius for your debug sphere
      assets.set("surfaceRadius", globeRadius);
    },
    undefined,
    (err) => {
      console.warn("Failed to load earth.glb; globe will not render.", err);
    }
  );

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);

  let autoRotate = true;

  const tick = (dt = 0) => {
    if (autoRotate) {
      globeGroup.rotation.y += 0.03 * dt;
    }
    starfield.rotation.y += 0.003 * dt;
    starfield.rotation.x += 0.001 * dt;
  };

  const setAutoRotate = (enabled) => {
    autoRotate = enabled;
  };

  return { scene, camera, renderer, controls, globeRadius, assets, globeGroup, tick, canvas, setAutoRotate };
}
