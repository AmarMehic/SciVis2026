import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createAssetCache } from "./utils/loader.js";

const earthModelUrl = new URL("./assets/models/earth.glb", import.meta.url).href;

export function createGlobe(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0b1020, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 4);
  scene.add(camera);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minDistance = 4;
  controls.maxDistance = 4;

  scene.add(new THREE.HemisphereLight(0x7fb7ff, 0x111622, 5));
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const globeRadius = 1.3;

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
  };

  const setAutoRotate = (enabled) => {
    autoRotate = enabled;
  };

  return { scene, camera, renderer, controls, globeRadius, assets, globeGroup, tick, canvas, setAutoRotate };
}
