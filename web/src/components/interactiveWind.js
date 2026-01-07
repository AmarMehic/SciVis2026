// web/src/components/interactiveWind.js
// Interaktivni vetrni vektorji - klik prikaže listek na izbrani točki
import * as THREE from 'three';
import { latLonToVec3 } from '../utils/coords.js';
import { describeRegions } from '../utils/geoRegions.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

function degToRad(d) {
  return (Math.PI / 180) * d;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function percentile(arr, p) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * a.length)));
  return a[i];
}

export function createInteractiveWind({
  camera,
  renderer,
  globeRadius,
  globeGroup,
  data,
  options = {},
}) {
  const group = new THREE.Group();
  const leafGroup = new THREE.Group();
  const hitboxGroup = new THREE.Group();
  group.add(hitboxGroup);

  // Options
  const strideBase = options.stride ?? 8;
  const poleStrideMul = options.poleStrideMul ?? 2;
  const jitterAmt = options.jitter ?? 0.3;
  const opacity = options.opacity ?? 0.85;
  const speedThreshold = options.speedThreshold ?? 1.0;
  const lift = options.lift ?? 0.03;
  const leafScale = options.leafScale ?? 0.25; // večji listek (prej 0.08)
  const leafModelPath = options.leafModelPath ?? '/models/tropical-leaf/source/fs.glb';
  const setAutoRotate = options.setAutoRotate; // funkcija za ustavitev globe rotacije
  const passportEventName = options.passportEventName ?? 'wind:select';

  // Streamline options
  const streamlineSegments = options.streamlineSegments ?? 200; // število segmentov (več za daljši tok)

  // Visibility and hitbox options
  const showGlyphs = options.showGlyphs ?? false; // skrij majhne črtice privzeto
  const hitboxRadius = options.hitboxRadius ?? 0.05; // polmer klik hitboxa (svetovne enote)
  const avoidHitboxOverlap = options.avoidHitboxOverlap ?? true; // izogibaj se prekrivanju hitboxov
  const initialShowHitboxes = options.showHitboxes ?? false; // možnost za debug prikaz hitboxov

  // Data za raycasting
  const windPoints = []; // { position, speed, direction, lat, lon, u, v }
  const raycaster = new THREE.Raycaster();
  raycaster.params.Mesh.threshold = 0.1; // večji threshold za lažje klikanje
  const mouse = new THREE.Vector2();
  let selectedLeaf = null;
  let selectedStreamline = null; // streamline za izbrani veter
  let leafModel = null;
  let hitboxMaterial = null;
  let streamlinePathInfo = [];

  // Metadata iz podatkov (time, level)
  const metadata = {
    time: data?.meta?.time ?? null,
    level: data?.meta?.level ?? null,
  };

  // Animation state
  let leafAnimTime = 0; // čas animacije
  let leafWindData = null; // podatki o vetru
  let streamlinePoints = []; // točke streamline-a za animacijo
  const animDuration = options.animDuration ?? 3.0; // trajanje animacije (sekunde)
  const animLoop = options.animLoop ?? true; // ali se animacija ponavlja

  // Color mapping
  const colorStops = [
    { speed: 0, color: new THREE.Color(0x4a90e2) },
    { speed: 0.25, color: new THREE.Color(0x50c878) },
    { speed: 0.5, color: new THREE.Color(0xffeb3b) },
    { speed: 0.75, color: new THREE.Color(0xff9800) },
    { speed: 1.0, color: new THREE.Color(0xf44336) },
  ];

  function getColorForSpeed(normalizedSpeed) {
    const t = clamp01(normalizedSpeed);
    for (let i = 0; i < colorStops.length - 1; i++) {
      const stop1 = colorStops[i];
      const stop2 = colorStops[i + 1];
      if (t >= stop1.speed && t <= stop2.speed) {
        const localT = (t - stop1.speed) / (stop2.speed - stop1.speed);
        return stop1.color.clone().lerp(stop2.color, localT);
      }
    }
    return colorStops[colorStops.length - 1].color.clone();
  }

  // Prikaži info panel z podatki o vetru
  function showWindInfo(windData) {
    const panel = document.getElementById('wind-info-panel');
    if (!panel) return;

    // Posodobi hitrost
    const speedEl = document.getElementById('wind-speed');
    if (speedEl) {
      speedEl.textContent = `${windData.speed.toFixed(2)} m/s`;
    }

    // Posodobi barvni indikator
    const indicator = panel.querySelector('.speed-indicator');
    if (indicator) {
      const color = windData.color;
      indicator.style.backgroundColor = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
    }

    // Posodobi level
    const levelEl = document.getElementById('wind-level');
    if (levelEl) {
      if (metadata.level !== null && metadata.level !== undefined) {
        levelEl.textContent = `${metadata.level}`;
      } else {
        levelEl.textContent = 'N/A';
      }
    }

    // Posodobi datum in čas
    const dateEl = document.getElementById('wind-date');
    const timeEl = document.getElementById('wind-time');
    if (metadata.time) {
      try {
        const timestamp = new Date(metadata.time);
        if (!isNaN(timestamp.getTime())) {
          if (dateEl) {
            dateEl.textContent = timestamp.toLocaleDateString('en-GB', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            });
          }
          if (timeEl) {
            timeEl.textContent = timestamp.toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });
          }
        } else {
          if (dateEl) dateEl.textContent = metadata.time;
          if (timeEl) timeEl.textContent = '--';
        }
      } catch (e) {
        if (dateEl) dateEl.textContent = metadata.time;
        if (timeEl) timeEl.textContent = '--';
      }
    } else {
      if (dateEl) dateEl.textContent = 'N/A';
      if (timeEl) timeEl.textContent = 'N/A';
    }

    // Posodobi lokacijo
    const locationEl = document.getElementById('wind-location');
    if (locationEl) {
      locationEl.textContent = `${windData.lat.toFixed(2)}°, ${windData.lon.toFixed(2)}°`;
    }

    // Prikaži panel
    panel.classList.add('visible');
  }

  // Skrij info panel
  function hideWindInfo() {
    const panel = document.getElementById('wind-info-panel');
    if (panel) {
      panel.classList.remove('visible');
    }
    stopPassportTracking();
  }

  function dispatchPassportEvent(detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent(passportEventName, { detail }));
  }

  function dispatchPassportEvent(detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent(passportEventName, { detail }));
  }

  function startPassportTracking(windData) {
    const colorHex =
      windData.color && typeof windData.color.getHexString === 'function'
        ? `#${windData.color.getHexString()}`
        : '#ffffff';

    passportState = {
      base: {
        speed: windData.speed,
        normalizedSpeed: windData.normalizedSpeed,
        level: metadata.level,
        color: colorHex,
      },
      visited: [],
      visitedSet: new Set(),
      lastRegion: null,
    };
    updatePassportLocation(windData.lat, windData.lon, { forceEmit: true });
  }

  function stopPassportTracking() {
    passportState = null;
    dispatchPassportEvent(null);
  }

  function updatePassportLocation(lat, lon, { forceEmit = false } = {}) {
    if (!passportState) return;
    passportState.base.lat = lat;
    passportState.base.lon = lon;
    const region = describeRegions(lat, lon);
    passportState.lastRegion = region;

    let changed = forceEmit;
    if (region?.landmarks?.length) {
      for (const name of region.landmarks) {
        if (!passportState.visitedSet.has(name)) {
          passportState.visitedSet.add(name);
          passportState.visited.push(name);
          changed = true;
        }
      }
    }
    if (changed) emitPassportDetail();
  }

  function emitPassportDetail() {
    if (!passportState) return;
    const region = passportState.lastRegion || {};
    const detail = {
      lat: passportState.base.lat,
      lon: passportState.base.lon,
      speed: passportState.base.speed,
      normalizedSpeed: passportState.base.normalizedSpeed,
      level: passportState.base.level,
      color: passportState.base.color,
      hemisphere: region.hemisphere,
      zone: region.zone,
      sector: region.sector,
      narrative: region.narrative,
      landmarks: [...passportState.visited],
    };
    dispatchPassportEvent(detail);
  }

  // Interpoliraj veter na dani poziciji (lat, lon)
  function interpolateWind(lat, lon) {
    if (!data?.meta?.grid || !data.u || !data.v) return null;

    const lats = data.meta.grid.lat;
    const lons = data.meta.grid.lon;
    const U = data.u;
    const V = data.v;

    // Najdi najbližji grid point (lahko bi tudi bilinearno interpolirali)
    let minDist = Infinity;
    let bestI = 0, bestJ = 0;

    for (let j = 0; j < lats.length; j++) {
      for (let i = 0; i < lons.length; i++) {
        const dLat = lat - lats[j];
        const dLon = lon - lons[i];
        const dist = dLat * dLat + dLon * dLon;
        if (dist < minDist) {
          minDist = dist;
          bestI = i;
          bestJ = j;
        }
      }
    }

    const u = U[bestJ]?.[bestI];
    const v = V[bestJ]?.[bestI];

    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;

    return { u, v };
  }

  // Generiraj streamline od dane točke
  function generateStreamline(startLat, startLon, startColor) {
    const points = [];
    const colors = [];
    const pathInfo = [];

    let lat = startLat;
    let lon = startLon;

    // Manjši korak za bolj gladek tok
    const stepSize = 0.2; // stopinje za vsak korak (manjši = bolj natančen)

    for (let i = 0; i < streamlineSegments; i++) {
      const wind = interpolateWind(lat, lon);
      if (!wind) break;

      const pos = latLonToVec3(lat, lon, globeRadius + lift * 1.5);
      points.push(pos);
      pathInfo.push({ position: pos, lat, lon });

      // Barva se ponavlja za vsako točko
      colors.push(startColor.r, startColor.g, startColor.b);

      // Izračunaj naslednji korak
      // Večje skaliranje da dosežemo podobno dolžino kot animacija listka (0.3 * globeRadius)
      const dLat = wind.v * stepSize * 0.3;
      const dLon = wind.u * stepSize * 0.3;

      lat += dLat;
      lon += dLon;

      // Preveri če smo izven območja
      if (lat < -90 || lat > 90) break;
      if (lon < -180) lon += 360;
      if (lon > 180) lon -= 360;
    }

    if (points.length < 2) {
      console.warn('Streamline too short:', points.length, 'points');
      return null;
    }

    // Ustvari geometrijo
    const positions = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    });

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      linewidth: 2,
      depthTest: true,
    });

    const line = new THREE.Line(geom, mat);

    return { line, points };
  }

  function init() {
    if (!data?.meta?.grid || !data.u || !data.v) {
      console.warn('interactiveWind: missing data');
      return;
    }

    const lats = data.meta.grid.lat;
    const lons = data.meta.grid.lon;
    const U = data.u;
    const V = data.v;

    const dLat = Math.abs((lats[1] ?? lats[0]) - lats[0] || 1);
    const dLon = Math.abs((lons[1] ?? lons[0]) - lons[0] || 1);

    // Zberi hitrosti
    const speeds = [];
    for (let j = 0; j < lats.length; j++) {
      for (let i = 0; i < lons.length; i++) {
        const u = U[j]?.[i], v = V[j]?.[i];
        if (Number.isFinite(u) && Number.isFinite(v))
          speeds.push(Math.hypot(u, v));
      }
    }
    const p10 = percentile(speeds, 10);
    const p90 = percentile(speeds, 90);
    const denom = p90 - p10 || 1;
    const lenBase = 0.012 * globeRadius;
    const lenRange = 0.028 * globeRadius;

    const positions = [];
    const colors = [];

    // candidate points for click hitboxes (no jitter to better match global seeding)
    const candidateWindPoints = [];

    for (let j = 0; j < lats.length; j += strideBase) {
      const lat = lats[j];
      const cosw = Math.max(0.001, Math.cos(degToRad(lat)));
      const extra = poleStrideMul * (1 - cosw);
      const lonStep = Math.max(1, Math.round(strideBase * (1 + extra)));
      const iOffset = (j / strideBase) % 2 ? Math.floor(lonStep / 2) : 0;

      for (let i = iOffset; i < lons.length; i += lonStep) {
        const u = U[j]?.[i], v = V[j]?.[i];
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;

        const speed = Math.hypot(u, v);
        if (speed < speedThreshold) continue;

        // Jitter le za vizualne črtice (ki so skrite); hitboxe damo na grid
        const jLat = lat + (Math.random() - 0.5) * dLat * jitterAmt;
        const jLon = lons[i] + (Math.random() - 0.5) * dLon * jitterAmt;

        const start = latLonToVec3(jLat, jLon, globeRadius + lift);

        const eastPoint = latLonToVec3(jLat, jLon + 0.01, globeRadius + lift);
        const east = new THREE.Vector3().subVectors(eastPoint, start).normalize();
        const northPoint = latLonToVec3(jLat + 0.01, jLon, globeRadius + lift);
        const north = new THREE.Vector3().subVectors(northPoint, start).normalize();

        const dir = east.clone().multiplyScalar(u).add(north.clone().multiplyScalar(v));
        if (dir.lengthSq() === 0) continue;

        const t = clamp01((speed - p10) / denom);
        const segLen = lenBase + lenRange * t;
        dir.normalize();
        const dirNorm = dir.clone();
        dir.multiplyScalar(segLen);

        const end = start.clone().add(dir);

        // Vizualne črtice (LineSegments) - lahko skrite
        positions.push(start.x, start.y, start.z, end.x, end.y, end.z);

        const c = getColorForSpeed(t);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);

        // Shrani kandidat za hitbox (brez jitterja za bolj enakomerno mrežo)
        const gridStart = latLonToVec3(lat, lons[i], globeRadius + lift);
        candidateWindPoints.push({
          position: gridStart.clone(),
          speed,
          normalizedSpeed: t,
          direction: dirNorm,
          lat: lat,
          lon: lons[i],
          u,
          v,
          color: c,
        });
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthTest: true,
    });

    const lines = new THREE.LineSegments(geom, mat);
    lines.visible = !!showGlyphs;
    group.add(lines);

    // Dodaj nevidne sfere (večji hitbox) z izogibanjem prekrivanju
    const sphereGeom = new THREE.SphereGeometry(hitboxRadius, 12, 12);
    hitboxMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: initialShowHitboxes ? 0.28 : 0.0,
      depthTest: true,
      depthWrite: true,
    });

    const placed = [];
    const minDistSq = (hitboxRadius * 2) * (hitboxRadius * 2);

    candidateWindPoints.forEach((wp) => {
      let tooClose = false;
      if (avoidHitboxOverlap) {
        for (let k = 0; k < placed.length; k++) {
          if (placed[k].distanceToSquared(wp.position) < minDistSq) {
            tooClose = true;
            break;
          }
        }
      }
      if (tooClose) return;

      const sphere = new THREE.Mesh(sphereGeom, hitboxMaterial);
      sphere.position.copy(wp.position);
      sphere.userData.windData = wp;
      sphere.visible = true;
      sphere.raycast = THREE.Mesh.prototype.raycast;
      hitboxGroup.add(sphere);

      placed.push(wp.position.clone());
      windPoints.push(wp);
    });

    globeGroup?.add(group);
    globeGroup?.add(leafGroup);

    // Naloži listek model
    const loader = new GLTFLoader();
    loader.load(
      leafModelPath,
      (gltf) => {
        leafModel = gltf.scene.clone();
        leafModel.scale.setScalar(leafScale);
        console.log('✅ Leaf model loaded successfully');
      },
      undefined,
      (err) => {
        console.error('❌ Failed to load leaf model:', err);
      }
    );

    // Event listener za klik
    renderer.domElement.addEventListener('click', onCanvasClick, false);

    // Event listener za close button v info panelu
    const closeBtn = document.getElementById('wind-info-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        hideWindInfo();
        // Odstrani tudi listek in streamline
        if (selectedLeaf) {
          leafGroup.remove(selectedLeaf);
          selectedLeaf.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
          selectedLeaf = null;
        }
        if (selectedStreamline) {
          leafGroup.remove(selectedStreamline);
          if (selectedStreamline.geometry) selectedStreamline.geometry.dispose();
          if (selectedStreamline.material) selectedStreamline.material.dispose();
          selectedStreamline = null;
        }
        leafWindData = null;
        leafAnimTime = 0;
        streamlinePoints = [];
        streamlinePathInfo = [];
        stopPassportTracking();
        // Vklopi nazaj rotacijo
        if (setAutoRotate) {
          setAutoRotate(true);
        }
      });
    }
  }

  function onCanvasClick(event) {
    if (!leafModel) {
      console.warn('Leaf model not loaded yet');
      return;
    }

    // Izračunaj mouse koordinate
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Filtriraj samo sfere (Mesh objekti z windData)
    const clickableSpheres = hitboxGroup.children.filter(
      (child) => child.isMesh && child.userData.windData
    );

    const intersects = raycaster.intersectObjects(clickableSpheres, false);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const windData = hit.object.userData.windData;

      if (windData) {

        // Ustavi rotacijo globe-a
        if (setAutoRotate) {
          setAutoRotate(false);
          console.log('⏸️ Globe rotation stopped');
        }

        // Odstrani prejšnji listek
        if (selectedLeaf) {
          leafGroup.remove(selectedLeaf);
          selectedLeaf.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
        }

        // Odstrani prejšnji streamline
        if (selectedStreamline) {
          leafGroup.remove(selectedStreamline);
          if (selectedStreamline.geometry) selectedStreamline.geometry.dispose();
          if (selectedStreamline.material) selectedStreamline.material.dispose();
        }
        streamlinePathInfo = [];

        stopPassportTracking();

        // Ustvari streamline
        const streamlineResult = generateStreamline(windData.lat, windData.lon, windData.color);
        if (streamlineResult) {
          selectedStreamline = streamlineResult.line;
          streamlinePoints = streamlineResult.points; // shrani točke za animacijo listka
          streamlinePathInfo = streamlineResult.pathInfo;
          leafGroup.add(selectedStreamline);
          console.log('🌊 Streamline generated with', streamlinePoints.length, 'points');
        } else {
          streamlinePoints = []; // resetiraj če ni uspelo
          streamlinePathInfo = [];
        }

        // Dodaj nov listek
        selectedLeaf = leafModel.clone();
        selectedLeaf.position.copy(windData.position);

        // Make it more visible for debugging
        selectedLeaf.visible = true;
        selectedLeaf.renderOrder = 999; // render on top

        // Shrani podatke za animacijo
        leafWindData = windData;
        leafAnimTime = 0;

        console.log('🎬 Starting leaf animation (duration: ' + animDuration + 's, loop: ' + animLoop + ')');

        // Orientiraj listek v smeri vetra
        const target = windData.position.clone().add(windData.direction);
        selectedLeaf.lookAt(target);

        // Obarvaj listek glede na hitrost
        selectedLeaf.traverse((child) => {
          if (child.isMesh) {
            child.material = child.material.clone();
            child.material.color.copy(windData.color);
            child.material.emissive = windData.color.clone().multiplyScalar(0.3);
            child.material.opacity = 1.0; // fully opaque
            child.material.transparent = false;
            child.material.side = THREE.DoubleSide; // visible from both sides
            child.material.needsUpdate = true;
            child.visible = true;
          }
        });

        leafGroup.add(selectedLeaf);

        startPassportTracking(windData);

        // Prikaži info panel
        showWindInfo(windData);
      }
    } else {
      console.log('❌ No intersection found - click missed all wind vectors');

      // Odstrani obstoječe leafs in streamlines
      if (selectedLeaf) {
        leafGroup.remove(selectedLeaf);
        selectedLeaf.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
        selectedLeaf = null;
      }

      if (selectedStreamline) {
        leafGroup.remove(selectedStreamline);
        if (selectedStreamline.geometry) selectedStreamline.geometry.dispose();
        if (selectedStreamline.material) selectedStreamline.material.dispose();
        selectedStreamline = null;
      }

      // Resetiraj animacijske podatke
      leafWindData = null;
      leafAnimTime = 0;
      streamlinePoints = []; // resetiraj točke streamline-a
      streamlinePathInfo = [];

      // Vklopi nazaj rotacijo globe-a
      if (setAutoRotate) {
        setAutoRotate(true);
        console.log('▶️ Globe rotation resumed');
      }

      // Skrij info panel
      hideWindInfo();
      stopPassportTracking();
    }
  }

  function dispose() {
    renderer.domElement.removeEventListener('click', onCanvasClick);

    // Odstrani event listener za close button
    const closeBtn = document.getElementById('wind-info-close');
    if (closeBtn) {
      closeBtn.replaceWith(closeBtn.cloneNode(true)); // enostavna metoda za odstranitev vseh listenerjev
    }

    // Skrij panel
    hideWindInfo();

    if (selectedLeaf) {
      leafGroup.remove(selectedLeaf);
      selectedLeaf.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }

    if (selectedStreamline) {
      leafGroup.remove(selectedStreamline);
      if (selectedStreamline.geometry) selectedStreamline.geometry.dispose();
      if (selectedStreamline.material) selectedStreamline.material.dispose();
    }

    if (globeGroup) {
      if (group.parent === globeGroup) globeGroup.remove(group);
      if (leafGroup.parent === globeGroup) globeGroup.remove(leafGroup);
    }

    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    group.clear();
    leafGroup.clear();
    windPoints.length = 0;
    streamlinePathInfo = [];
    stopPassportTracking();
  }

  function setShowHitboxes(show) {
    if (!hitboxMaterial) return;
    hitboxMaterial.opacity = show ? 0.28 : 0.0;
    hitboxMaterial.needsUpdate = true;
  }

  function update(dt) {
    // Animiraj listek, če obstaja in imamo streamline točke
    if (selectedLeaf && leafWindData && streamlinePoints.length > 1) {
      const prevTime = leafAnimTime;
      leafAnimTime += dt;

      // Normaliziraj čas (0..1)
      const t = (leafAnimTime % animDuration) / animDuration;
      const prevT = (prevTime % animDuration) / animDuration;

      // Preveri če se je animacija resetirala (loop)
      if (prevT > t) {
        console.log('🔄 Leaf animation looped - starting cycle ' + Math.floor(leafAnimTime / animDuration));
      }

      // Izračunaj pozicijo vzdolž streamline-a
      // t=0 -> začetek, t=1 -> konec streamline-a
      const pathLength = streamlinePoints.length - 1;
      const pathPosition = t * pathLength; // float med 0 in pathLength
      const index = Math.floor(pathPosition); // index spodnje točke
      const localT = pathPosition - index; // lokalni t med dvema točkama (0..1)

      // Interpoliraj med dvema sosednjima točkama na streamline-u
      const p1 = streamlinePoints[Math.min(index, pathLength)];
      const p2 = streamlinePoints[Math.min(index + 1, pathLength)];
      const info1 = streamlinePathInfo[Math.min(index, streamlinePathInfo.length - 1)] || { lat: leafWindData.lat, lon: leafWindData.lon };
      const info2 =
        streamlinePathInfo[Math.min(index + 1, streamlinePathInfo.length - 1)] || info1;

      // Linearna interpolacija med točkama
      const newPos = new THREE.Vector3().lerpVectors(p1, p2, localT);

      // Posodobi pozicijo listka
      selectedLeaf.position.copy(newPos);

      // Orientiraj listek v smeri gibanja (tangenta streamline-a)
      if (index + 1 < streamlinePoints.length) {
        const direction = new THREE.Vector3().subVectors(p2, p1).normalize();
        if (direction.lengthSq() > 0.001) {
          // Uporabi lookAt za orientacijo
          const lookAtTarget = newPos.clone().add(direction);
          selectedLeaf.lookAt(lookAtTarget);
        }
      }

      // Dodaj majhno vrtenje za dinamičnost (listek se vrti medtem ko potuje)
      const rotationSpeed = 2.0;
      selectedLeaf.rotation.z += Math.sin(leafAnimTime * rotationSpeed * leafWindData.normalizedSpeed) * 0.01;

      // Dodaj majhno vertikalno nihanje (kot bi listek "plaval" v vetru)
      const bobSpeed = 3.0;
      const bobAmount = 0.02 * globeRadius;
      const bobOffset = Math.sin(leafAnimTime * bobSpeed) * bobAmount;
      const up = selectedLeaf.position.clone().normalize();
      selectedLeaf.position.add(up.multiplyScalar(bobOffset));

      const currLat = THREE.MathUtils.lerp(info1.lat, info2.lat, localT);
      const currLon = lerpWrappedLon(info1.lon, info2.lon, localT);
      updatePassportLocation(currLat, currLon);

      // Spremeni opacity proti koncu cikla (fade out/in)
      if (!animLoop) {
        const fadeStart = 0.8;
        if (t > fadeStart) {
          const fadeT = (t - fadeStart) / (1 - fadeStart);
          selectedLeaf.traverse((child) => {
            if (child.isMesh && child.material) {
              child.material.opacity = 1 - fadeT;
              child.material.transparent = true;
            }
          });
        }
      }
    }
  }

  return { group, init, update, dispose, setShowHitboxes };
}
