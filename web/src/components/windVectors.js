// web/src/components/windVectors.js
import * as THREE from 'three';
import { latLonToVec3 } from '../utils/coords.js';
import StreamClient from '../StreamClient.js';

function degToRad(d) {
  return (Math.PI / 180) * d;
}
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function percentile(arr, p) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const i = Math.min(
    a.length - 1,
    Math.max(0, Math.floor((p / 100) * a.length))
  );
  return a[i];
}

export function createWindVectors({
  globeRadius,
  globeGroup,
  data,
  options = {},
}) {
  const group = new THREE.Group();
  const client = new StreamClient('');
  let latestTime = null;
  let latestFrame = null;
  let latestTileInfo = null;

  // ---- options (z razumljivimi defaulti) ----
  const strideBase = options.stride ?? 8; // osnovni korak (v indexih)
  const poleStrideMul = options.poleStrideMul ?? 2; // dodatno redčenje pri polih
  const jitterAmt = options.jitter ?? 0.3; // 0..1 majhen random odmik
  const opacity = options.opacity ?? 0.85;
  const speedThreshold = options.speedThreshold ?? 1.0;
  const colorConst = options.color ?? 0x00bcd4;
  const colorBySpeed = options.colorBySpeed ?? true; // barvanje po hitrosti
  const lift = options.lift ?? 0.03; // dvig nad površino

  function init() {
    // keep same guard for legacy data option
    if (!data && !client) {
      console.warn('windVectors: missing data and stream client');
      return;
    }

    // create an empty geometry/mesh that we'll update each frame
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(0);
    const colors = new Float32Array(0);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthTest: true,
    });

    const lines = new THREE.LineSegments(geom, mat);
    group.add(lines);
    globeGroup?.add(group);
    latestTileInfo = { lines, geom };
  }

  function dispose() {
    if (globeGroup && group.parent === globeGroup) globeGroup.remove(group);
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    group.clear();
  }

  // Track if update is in progress to prevent concurrent fetches
  let updateInProgress = false;
  
  // update should be called as update(currentTime, visibleBounds)
  async function update(currentTime = null, visibleBounds = null) {
    if (currentTime == null) return;
    const frame = Math.floor(currentTime);
    if (frame === latestFrame) return; // already rendered this frame
    if (updateInProgress) return; // skip if previous update still running
    
    updateInProgress = true;
    latestFrame = frame;
    latestTime = currentTime;

    try {
      const tiles = await client.getFrame(frame, visibleBounds);
      // tiles is now an array of tile objects
      console.log(`Got ${tiles.length} tiles for frame ${frame}`);
      
      const positions = [];
      const colors = [];

      const lenBase = 0.004 * globeRadius;  // Reduced from 0.012
      const lenRange = 0.012 * globeRadius; // Reduced from 0.028
      const color0 = new THREE.Color(0x00bcd4);
      const color1 = new THREE.Color(0xffffff);
      const constColor = new THREE.Color(colorConst);

      // Process all tiles
      for (const tile of tiles) {
        const { width, height, data, z, x, y, 
                face, projection,
                faceWidth, faceHeight, faceX0, faceX1, faceY0, faceY1,
                lon00, lat00, lon10, lat10, lon01, lat01, lon11, lat11 } = tile;
        console.log(`Processing tile z=${z} x=${x} y=${y}: ${width}×${height}, face=${face}, face_region=(${faceX0},${faceY0})-(${faceX1},${faceY1})`);
        
        if (!data || !width || !height) {
          console.warn('Skipping tile with missing data');
          continue;
        }

        // prepare percentiles for this tile for length scaling
        const speeds = [];s
        for (let j = 0; j < height; j++) {
          for (let i = 0; i < width; i++) {
            const idx = (j * width + i) * 2;
            const u = data[idx];
            const v = data[idx + 1];
            if (Number.isFinite(u) && Number.isFinite(v)) speeds.push(Math.hypot(u, v));
          }
        }
        const p10 = percentile(speeds, 10);
        const p90 = percentile(speeds, 90);
        const denom = p90 - p10 || 1;

        // Coordinate computation: tile pixel -> face pixel -> lon/lat via gnomonic
        const getCoords = (tilePixelX, tilePixelY) => {
          // Map tile pixel to face pixel coordinate
          const dx = faceX1 - faceX0;
          const dy = faceY1 - faceY0;
          const facePx = faceX0 + (tilePixelX + 0.5) * dx / width;
          const facePy = faceY0 + (tilePixelY + 0.5) * dy / height;
          
          // Normalize to [0, 1] within the face
          const s = facePx / faceWidth;
          const t = facePy / faceHeight;
          
          // Convert to gnomonic plane coordinates (-1 to 1)
          // Try flipping y to match GEOS orientation
          const gx = (s - 0.5) * 2.0;
          const gy = (0.5 - t) * 2.0;  // FLIPPED: was (t - 0.5) * 2.0
          
          let lon, lat;
          
          if (face < 4) {
            // Equatorial faces: gnomonic projection
            const centerLon = [-135, -45, 45, 135][face];
            const rho = Math.sqrt(gx*gx + gy*gy);
            
            if (rho < 1e-10) {
              lon = centerLon;
              lat = 0;
            } else {
              const c = Math.atan(rho);
              const sinC = Math.sin(c);
              const cosC = Math.cos(c);
              
              lat = Math.asin(gy * sinC / rho) * (180 / Math.PI);
              lon = centerLon + Math.atan2(gx * sinC, rho * cosC) * (180 / Math.PI);
            }
          } else if (face === 4) {
            // North pole
            const rho = Math.sqrt(gx*gx + gy*gy);
            if (rho < 1e-10) {
              lon = 0;
              lat = 90;
            } else {
              const c = Math.atan(rho);
              lat = 90 - c * (180 / Math.PI);
              lon = Math.atan2(gx, -gy) * (180 / Math.PI);
            }
          } else {
            // South pole
            const rho = Math.sqrt(gx*gx + gy*gy);
            if (rho < 1e-10) {
              lon = 0;
              lat = -90;
            } else {
              const c = Math.atan(rho);
              lat = -90 + c * (180 / Math.PI);
              lon = Math.atan2(gx, gy) * (180 / Math.PI);
            }
          }
          
          return { lon, lat };
        };

        for (let j = 0; j < height; j += strideBase) {
          for (let i = 0; i < width; i += strideBase) {
            const idx = (j * width + i) * 2;
            const u = data[idx];
            const v = data[idx + 1];
            if (!Number.isFinite(u) || !Number.isFinite(v)) continue;

            const speed = Math.hypot(u, v);
            if (speed < speedThreshold) continue;

            // Get lon/lat from server-provided coordinates
            const { lon, lat } = getCoords(i, j);
            const jLat = lat + (Math.random() - 0.5) * jitterAmt;
            const jLon = lon + (Math.random() - 0.5) * jitterAmt;

            const start = latLonToVec3(jLat, jLon, globeRadius + lift);
            const east = latLonToVec3(jLat, jLon + 0.01, globeRadius + lift)
              .sub(start)
              .normalize();
            const north = latLonToVec3(jLat + 0.01, jLon, globeRadius + lift)
              .sub(start)
              .normalize();

            const dir = east.multiplyScalar(u).add(north.multiplyScalar(v));
            if (dir.lengthSq() === 0) continue;

            const t = clamp01((speed - p10) / denom);
            const segLen = lenBase + lenRange * t;
            dir.normalize().multiplyScalar(segLen);

            const end = start.clone().add(dir);

            positions.push(start.x, start.y, start.z, end.x, end.y, end.z);

            if (colorBySpeed) {
              const c = color0.clone().lerp(color1, t);
              colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
            } else {
              colors.push(
                constColor.r,
                constColor.g,
                constColor.b,
                constColor.r,
                constColor.g,
                constColor.b
              );
            }
          }
        }
      } // end for each tile

      console.log(`Total vectors: ${positions.length / 6}, positions array length: ${positions.length}`);

      // update geometry - dispose old buffers to prevent ghosting
      const { lines, geom } = latestTileInfo;
      
      // Dispose old attributes to free memory
      if (geom.attributes.position) geom.deleteAttribute('position');
      if (geom.attributes.color) geom.deleteAttribute('color');
      
      // Create new attributes with fresh data
      const posAttr = new THREE.Float32BufferAttribute(new Float32Array(positions), 3);
      const colAttr = new THREE.Float32BufferAttribute(new Float32Array(colors), 3);
      geom.setAttribute('position', posAttr);
      geom.setAttribute('color', colAttr);
      geom.setDrawRange(0, positions.length / 3);
      geom.computeBoundingSphere();
    } catch (err) {
      console.error('Failed to fetch/parse frame', err);
    } finally {
      updateInProgress = false; // allow next update
    }
  }

  // Render a global snapshot composed of multiple face tiles as returned by StreamLoader.loadGlobalSnapshot
  function renderGlobalSnapshot(globalFaces = []) {
    if (!Array.isArray(globalFaces) || !globalFaces.length) return;

    const positions = [];
    const colors = [];

    // reuse same scaling logic as single-tile update
    const lenBase = 0.012 * globeRadius;
    const lenRange = 0.028 * globeRadius;
    const color0 = new THREE.Color(0x00bcd4);
    const color1 = new THREE.Color(0xffffff);

    for (const faceTile of globalFaces) {
      const { width, height, data, lon0, lon1, lat0, lat1 } = faceTile;
      const speeds = [];
      for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
          const idx = (j * width + i) * 2;
          const u = data[idx];
          const v = data[idx + 1];
          if (Number.isFinite(u) && Number.isFinite(v)) speeds.push(Math.hypot(u, v));
        }
      }
      const p10 = percentile(speeds, 10);
      const p90 = percentile(speeds, 90);
      const denom = p90 - p10 || 1;

      const dLon = (lon1 - lon0) / width;
      const dLat = (lat1 - lat0) / height;

      for (let j = 0; j < height; j += strideBase) {
        const lat = lat0 + (j + 0.5) * dLat;
        const cosw = Math.max(0.001, Math.cos(degToRad(lat)));
        const extra = poleStrideMul * (1 - cosw);
        const lonStep = Math.max(1, Math.round(strideBase * (1 + extra)));
        const iOffset = (j / strideBase) % 2 ? Math.floor(lonStep / 2) : 0;

        for (let i = iOffset; i < width; i += lonStep) {
          const idx = (j * width + i) * 2;
          const u = data[idx];
          const v = data[idx + 1];
          if (!Number.isFinite(u) || !Number.isFinite(v)) continue;

          const speed = Math.hypot(u, v);
          if (speed < speedThreshold) continue;

          const jLat = lat + (Math.random() - 0.5) * dLat * jitterAmt;
          const jLon = lon0 + (i + 0.5) * dLon + (Math.random() - 0.5) * dLon * jitterAmt;

          const start = latLonToVec3(jLat, jLon, globeRadius + lift);
          const east = latLonToVec3(jLat, jLon + 0.01, globeRadius + lift)
            .sub(start)
            .normalize();
          const north = latLonToVec3(jLat + 0.01, jLon, globeRadius + lift)
            .sub(start)
            .normalize();

          const dir = east.multiplyScalar(u).add(north.multiplyScalar(v));
          if (dir.lengthSq() === 0) continue;

          const t = clamp01((speed - p10) / denom);
          const segLen = lenBase + lenRange * t;
          dir.normalize().multiplyScalar(segLen);

          const end = start.clone().add(dir);

          positions.push(start.x, start.y, start.z, end.x, end.y, end.z);

          if (colorBySpeed) {
            const c = color0.clone().lerp(color1, t);
            colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
          } else {
            const constColor = new THREE.Color(colorConst);
            colors.push(
              constColor.r,
              constColor.g,
              constColor.b,
              constColor.r,
              constColor.g,
              constColor.b
            );
          }
        }
      }
    }

    // update geometry with global snapshot data
    const { lines, geom } = latestTileInfo;
    const posAttr = new THREE.Float32BufferAttribute(positions, 3);
    const colAttr = new THREE.Float32BufferAttribute(colors, 3);
    geom.setAttribute('position', posAttr);
    geom.setAttribute('color', colAttr);
    geom.setDrawRange(0, positions.length / 3);
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
  }

  return { group, init, update, dispose, renderGlobalSnapshot };
}
