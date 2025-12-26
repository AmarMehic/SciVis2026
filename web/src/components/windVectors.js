import * as THREE from "three";
import { latLonToVec3 } from "../utils/coords.js";

// Minimal wind vector renderer: draws line segments per sampled grid cell.
export function createWindVectors({ globeRadius, globeGroup, data, options = {} }) {
  const group = new THREE.Group();
  const stride = options.stride ?? 8;
  const scale = options.scale ?? 0.2;
  const color = options.color ?? 0x00bcd4;
  const opacity = options.opacity ?? 0.8;
  const lift = options.lift ?? 0.05;

  function init() {
    if (!data?.meta?.grid || !data.u || !data.v) {
      console.warn("windVectors: missing data");
      return;
    }
    const lats = data.meta.grid.lat;
    const lons = data.meta.grid.lon;
    const u = data.u;
    const v = data.v;

    const minmax = (arr) => {
      try {
        const flat = arr.flat().filter(Number.isFinite);
        if (!flat.length) return [NaN, NaN];
        return [Math.min(...flat), Math.max(...flat)];
      } catch (e) {
        return [NaN, NaN];
      }
    };
    const [umin, umax] = minmax(u);
    const [vmin, vmax] = minmax(v);
    console.info("windVectors: grid", lons.length, "x", lats.length, "stride", stride, "u[min,max]", umin, umax, "v[min,max]", vmin, vmax);

    const positions = [];
    const colors = [];
    const c = new THREE.Color(color);

    for (let j = 0; j < lats.length; j += stride) {
      const lat = lats[j];
      for (let i = 0; i < lons.length; i += stride) {
        const lon = lons[i];
        const uVal = u[j]?.[i];
        const vVal = v[j]?.[i];
        if (uVal == null || vVal == null || !isFinite(uVal) || !isFinite(vVal)) continue;

        const start = latLonToVec3(lat, lon, globeRadius + lift);
        const east = latLonToVec3(lat, lon + 0.01, globeRadius + lift).sub(start).normalize();
        const north = latLonToVec3(lat + 0.01, lon, globeRadius + lift).sub(start).normalize();
        const dir = east.multiplyScalar(uVal).add(north.multiplyScalar(vVal)).normalize().multiplyScalar(scale);
        const end = start.clone().add(dir);

        positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthTest: false,
    });

    const lines = new THREE.LineSegments(geometry, material);
    group.add(lines);
    globeGroup?.add(group);
  }

  function dispose() {
    if (globeGroup && group.parent === globeGroup) {
      globeGroup.remove(group);
    }
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    group.clear();
  }

  return { group, init, update() {}, dispose };
}
