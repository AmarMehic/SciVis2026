// Markers with optional model and smooth travel above the surface.
// Expects data: [{ path: [{t, lat, lon, alt}], color, size, speed?, modelUrl? }]
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { latLonToVec3 } from "../utils/coords.js";

export function createMarkers({ scene, globeRadius, assets, globeGroup, data = [], options = {} }) {
  const parent = options.attachTo || globeGroup || scene;
  const group = new THREE.Group();
  parent.add(group);

  const loader = new GLTFLoader();
  const modelCache = assets || new Map();
  let currentSurfaceRadius = options.surfaceRadius ?? modelCache.get?.("surfaceRadius") ?? globeRadius;

  async function loadModel(url) {
    if (!url) return null;
    if (modelCache.has(url)) return modelCache.get(url);
    return new Promise((resolve) => {
      loader.load(
        url,
        (gltf) => {
          modelCache.set(url, gltf.scene);
          resolve(gltf.scene);
        },
        undefined,
        () => resolve(null)
      );
    });
  }

  function createMesh(marker) {
    if (marker.modelUrl) {
      // Model will be cloned per marker if provided.
      return loadModel(marker.modelUrl).then((sceneModel) => {
        if (!sceneModel) return buildSphere(marker);
        const model = sceneModel.clone(true);
        // Normalize model scale relative to marker size.
        const size = marker.size || 0.05;
        model.scale.setScalar(size);
        model.traverse((child) => {
          if (child.isMesh) {
            child.material = child.material?.clone?.() || child.material;
            if (child.material?.color && marker.color) {
              child.material.color.set(marker.color);
              child.material.needsUpdate = true;
            }
          }
        });
        return model;
      });
    }
    return Promise.resolve(buildSphere(marker));
  }

  function buildSphere(marker) {
    const geom = new THREE.SphereGeometry(marker.size || 0.03, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: marker.color || 0xffaa55 });
    return new THREE.Mesh(geom, mat);
  }

  async function init() {
    for (const marker of data) {
      const mesh = await createMesh(marker);
      mesh.userData.path = marker.path || [];
      mesh.userData.surfaceRadius = currentSurfaceRadius;
      mesh.userData.t = 0;
      mesh.userData.speed = marker.speed ?? options.speed ?? 0.05;
      mesh.userData.phase = Math.random() * Math.PI * 2;
      mesh.userData.time = 0;
      group.add(mesh);
    }
  }

  function update(dt) {
    const nextRadius = options.surfaceRadius ?? modelCache.get?.("surfaceRadius") ?? globeRadius;
    if (Math.abs(nextRadius - currentSurfaceRadius) > 1e-4) {
      currentSurfaceRadius = nextRadius;
      group.children.forEach((mesh) => {
        mesh.userData.surfaceRadius = currentSurfaceRadius;
      });
    }

    group.children.forEach((mesh) => {
      const path = mesh.userData.path;
      if (!path || path.length < 2) return;

      mesh.userData.t = (mesh.userData.t + mesh.userData.speed * dt) % 1;
      mesh.userData.time += dt;
      // Find segment based on t values in path.
      let segIdx = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const t0 = path[i].t ?? (i / (path.length - 1));
        const t1 = path[i + 1].t ?? ((i + 1) / (path.length - 1));
        if (mesh.userData.t >= t0 && mesh.userData.t <= t1) {
          segIdx = i;
          break;
        }
      }
      const a = path[segIdx];
      const b = path[Math.min(segIdx + 1, path.length - 1)];
      const t0 = a.t ?? (segIdx / (path.length - 1));
      const t1 = b.t ?? ((segIdx + 1) / (path.length - 1));
      const segSpan = Math.max(t1 - t0, 1e-5);
      const localT = easeInOut((mesh.userData.t - t0) / segSpan);

      const lat = THREE.MathUtils.lerp(a.lat, b.lat, localT);
      const lon = THREE.MathUtils.lerp(a.lon, b.lon, localT);
      const alt = THREE.MathUtils.lerp(a.alt || 0, b.alt || 0, localT);

      const basePos = latLonToVec3(lat, lon, mesh.userData.surfaceRadius + alt);
      const normal = basePos.clone().normalize();
      const wiggleAmp = options.wiggleAmp ?? 0.015;
      const swayAmp = options.swayAmp ?? 0.02;
      const time = mesh.userData.time + mesh.userData.phase;

      // lateral sway perpendicular to normal
      const ref = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const tangent = new THREE.Vector3().crossVectors(normal, ref).normalize();
      const binormal = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      const sway = tangent.multiplyScalar(Math.sin(time * 1.7) * swayAmp).add(binormal.multiplyScalar(Math.cos(time * 1.1) * swayAmp * 0.6));

      // small radial flutter
      const radial = normal.clone().multiplyScalar(Math.sin(time * 2.3) * wiggleAmp);

      const pos = basePos.clone().add(sway).add(radial);
      mesh.position.copy(pos);

      mesh.lookAt(0, 0, 0);
      mesh.rotateOnAxis(normal, Math.sin(time * 2.0) * 0.3);
    });
  }

  function dispose() {
    group.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose?.();
        obj.material?.dispose?.();
      }
    });
    parent.remove(group);
  }

  return { group, init, update, dispose };
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
