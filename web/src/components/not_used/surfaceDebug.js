// Surface debug sphere at alt=0 (hugging the globe).
// Expects options: { color?, opacity?, surfaceRadius? }.
// Should be used only for debugging!
import * as THREE from "three";

export function createSurfaceDebug({ scene, globeRadius, assets, globeGroup, options = {} }) {
  const parent = options.attachTo || globeGroup || scene;
  const group = new THREE.Group();
  parent.add(group);

  let mesh = null;

  const getSurfaceRadius = () =>
    options.surfaceRadius ?? assets?.get?.("surfaceRadius") ?? globeRadius;

  function build() {
    const surfaceRadius = getSurfaceRadius();
    if (!surfaceRadius) return;
    const geometry = new THREE.SphereGeometry(surfaceRadius, 64, 64);
    const material = new THREE.MeshBasicMaterial({
      color: options.color || 0x78c7ff,
      transparent: true,
      opacity: options.opacity ?? 0.2,
      wireframe: false,
      depthWrite: false,
    });
    mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
  }

  function init() {
    build();
  }

  function update() {
    const surfaceRadius = getSurfaceRadius();
    if (mesh && surfaceRadius && Math.abs(mesh.geometry.parameters.radius - surfaceRadius) > 1e-4) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      group.clear();
      build();
    }
  }

  function dispose() {
    group.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        obj.material.dispose();
      }
    });
    parent.remove(group);
  }

  return { group, init, update, dispose };
}
