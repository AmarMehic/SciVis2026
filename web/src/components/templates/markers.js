// Markers template.
// Expects data: [{ path: [{t, lat, lon, alt}], color, size }]
import * as THREE from "three";
import { latLonToVec3 } from "../../utils/coords.js";

export function createMarkers({ scene, globeRadius, globeGroup, data = [], options = {} }) {
  const parent = options.attachTo || globeGroup || scene;
  const group = new THREE.Group();
  parent.add(group);

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
    parent.remove(group);
  }

  return { group, init, update, dispose };
}
