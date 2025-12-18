# Components and data contracts

Factories must follow `factory({ scene, globeRadius, assets, globeGroup, data, options })` and return `{ group, init(), update(dt), dispose() }`. Add all objects to `group` so `main.js` can attach/remove cleanly; `main.js` owns the registry and calls `update(dt)` every frame.

## Lifecycle contract
- `group`: Three.js `Group` containing everything your component creates.
- `init()`: build meshes/materials/lines and attach to `group` (do not rely on constructor side effects).
- `update(dt)`: drive animations; `dt` is seconds since last frame.
- `dispose()`: remove listeners, dispose geometries/materials/textures, and detach `group` from the scene.

## Shared resources
- `scene`: shared Three.js scene; do not add objects directly—use `group`.
- `globeRadius`: radius (in scene units) for converting lat/lon to positions.
- `globeGroup`: parent group that rotates the earth; attach your `group` here if you want visuals to stay fixed to the globe.
- `assets`: simple cache (see `web/src/utils/loader.js`) for loaders/GLTFs/textures; prefer `assets.get/set` instead of reloading. `globe.js` stores `surfaceRadius` here so components can place alt=0 on the surface.
- `data`: schema-specific payload for the component (see below); should be pure JSON-friendly objects.
- `options`: optional tuning knobs (colors, alpha, speeds, toggles) with sensible defaults in the component.

## Current schemas and samples
- Streamlines (`data/samples/streamlines.json`):  
  `[{ points: [{ lat, lon, alt }], color, speed }]`  
  `points` trace a streamline in lat/lon degrees; `alt` is an offset above the globe surface (same units as `globeRadius`). `color` can be hex string/number; `speed` is a normalized speed hint for animation.
- Markers (`data/samples/markers.json`):  
  `[{ path: [{ t, lat, lon, alt }], color, size, model }]`  
  `path` is an ordered list of time-normalized samples (0–1) along an orbit/track. `size` is sphere radius if no model is provided. `model` can point to an asset key in `assets` (e.g., a GLB set elsewhere); default is a simple sphere.

Document new schemas here when you introduce components so data prep scripts can target the right shape.

## Adding a new component
1. Copy a template from `web/src/components/templates/` into `web/src/components/` and rename it.
2. Define the expected `data` structure in this file and drop a tiny example into `data/samples/`.
3. Use `latLonToVec3` from `web/src/utils/coords.js` for positioning on the globe. Prefer `options.surfaceRadius` or `assets.get("surfaceRadius")` so `alt=0` sits on the surface, then add `alt` on top.
4. Keep configuration surface minimal; add `options` for tuning (colors, opacity, animation speed) rather than hard-coding.
5. Verify `dispose()` cleans up geometries/materials/textures and removes any event listeners.

### Debug helper
- `surfaceDebug`: optional component at `web/src/components/surfaceDebug.js` that draws a semi-transparent sphere at `surfaceRadius` (alt=0) to sanity-check positioning. Register via `addComponent("surfaceDebug", createSurfaceDebug, { options: { opacity, color } })`.
