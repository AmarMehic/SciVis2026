// Streamlines template.
// Expects data: [{ points: [{ lat, lon, alt }], color (hex/number), speed (0–1 hint), alt is offset from globeRadius }]
import * as THREE from "three";
import { latLonToVec3 } from "../../utils/coords.js";

export function createStreamlines({ scene, globeRadius, globeGroup, data = [], options = {} }) {
  const parent = options.attachTo || globeGroup || scene;
  const group = new THREE.Group();
  parent.add(group);

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
    parent.remove(group);
  }

  return { group, init, update, dispose };
}
