# SciVis 2026 Task 1 data fetch plan (DYAMOND GEOS)

Sources:
- DYAMOND C1440 GEOS atmospheric run (7 km horizontal, 51 vertical levels, cubed-sphere grid with 6 faces), 14-month integration starting 2020-01-20 (per contest data page).
- Task focus from manifest PDF: global wind patterns with emphasis on jet streams (speed ridges), cyclones (high vorticity), convergence/divergence patterns, and an info panel showing wind, temperature, and pressure.

What to fetch (store raw in `data/raw/geos/` or similar before downsampling to `data/samples/`):
- U, V, W (eastward, northward, vertical wind) — full global cube, all 51 levels, whole 2020-01-20 → 2021-03-ish run. Goal: base vector field for streamlines/particles, vertical motion cues, and speed overlays. Start with 6-hourly or daily frames (confirm cadence in files) to keep volume manageable.
- P (mid-level pressure) + DELP (pressure thickness) — same coverage as U/V/W. Goal: surface/level pressure readout in the UI and to anchor vertical interpolation on isobaric levels.
- T (air temperature) — same coverage. Goal: contextual layer in info panel and potential coloring of flow features.
- H (mid-layer heights) and grid geometry (lat/lon per face, face layout) — static. Goal: map cubed-sphere indices to lat/lon and compute altitudes for placing visuals on/above the globe.

Derived locally (no fetch needed, but drive preprocessing):
- Wind speed |V| = sqrt(U² + V²), vorticity, and divergence at representative levels (e.g., near-surface, mid-troposphere, upper jet levels) for feature picking (jets, cyclones, convergence zones).
- Thin preview slices: 2–3 time steps across different months and a few pressure/height levels (e.g., ~250 hPa, ~500 hPa, ~850 hPa equivalents) downsampled to JSON for `data/samples/` so the globe can load quickly without full datasets.
