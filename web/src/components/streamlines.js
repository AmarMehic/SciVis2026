// Streamlines template.
// Expects data: [{ points: [{lat, lon, alt}], color, speed }]
import * as THREE from "three";
import { latLonToVec3 } from "../utils/coords.js";

export function createStreamlines({ scene, globeRadius, assets, globeGroup, data = [], options = {} }) {
  const parent = options.attachTo || globeGroup || scene;
  const group = new THREE.Group();
  parent.add(group);

  let currentSurfaceRadius = options.surfaceRadius ?? assets?.get?.("surfaceRadius") ?? globeRadius;

  function rebuild(radius) {
    // dispose existing before rebuild
    group.traverse((obj) => {
      if (obj.isLine) obj.geometry.dispose(), obj.material.dispose();
    });
    group.clear();

    data.forEach((line) => {
      const pts = (line.points || []).map((p) =>
        latLonToVec3(p.lat, p.lon, radius + (p.alt ?? 0))
      );
      const geometry = new THREE.BufferGeometry().setFromPoints(pts);
      const material = new THREE.LineBasicMaterial({
        color: line.color || 0x78c7ff,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Line(geometry, material);
      mesh.userData.speed = line.speed || 0;
      group.add(mesh);
    });
  }

  function init() {
    rebuild(currentSurfaceRadius);
  }

  function update(dt) {
    const nextRadius = options.surfaceRadius ?? assets?.get?.("surfaceRadius") ?? globeRadius;
    if (Math.abs(nextRadius - currentSurfaceRadius) > 1e-4) {
      currentSurfaceRadius = nextRadius;
      rebuild(currentSurfaceRadius);
    }
    // animate dash/offset/etc. if desired
  }

  function dispose() {
    group.traverse((obj) => {
      if (obj.isLine) obj.geometry.dispose(), obj.material.dispose();
    });
    parent.remove(group);
  }

  return { group, init, update, dispose };
}
