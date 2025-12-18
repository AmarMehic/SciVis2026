# SciVis 2026 Wind Globe

Interactive globe for IEEE SciVis Contest 2026 Task 1 (global atmospheric wind patterns from DYAMOND GEOS U/V/W). The web client renders an earth model and pluggable components (streamlines, markers, particles) driven by small sampled datasets while data prep scripts live in `data/scripts/`.

## Setup
- Prereqs: Node 18+, npm, Miniconda (conda). Micromamba also works but Miniconda is the default path here.
- Clone repo, then run `./setup.sh` (or `setup_windows.bat`) to create the `sci-vis` conda env from `environment.yml` and install JS deps.
- Activate env: `conda activate sci-vis` (or `micromamba activate sci-vis` if you prefer).
- Start dev server: `npm run dev` (serves `web/` via Vite).

## Data & assets
- Keep raw DYAMOND GEOS files outside the repo; generate downsampled JSON fixtures into `data/samples/` for quick iteration.
- Place globe/marker models under `web/src/assets/models/` (globe lives at `web/src/assets/models/earth.glb`); textures can go in `web/src/assets/textures/`.
- Store contest PDFs and reference docs in `docs/references/`.

## Repo layout
- `web/` client entry at `web/index.html`; core bootstrapping in `web/src/main.js` and globe setup in `web/src/globe.js`.
- `web/src/components/` pluggable visualization components; starter templates in `web/src/components/templates/`.
- `web/src/utils/` shared helpers (coords, loaders); assets such as the globe model in `web/src/assets/models/earth.glb`.
- `data/samples/` tiny JSON fixtures that match component schemas; `data/scripts/` Python prep scripts (see README there).
- `docs/components.md` component/data contracts; `docs/references/` holds contest PDFs (DYAMOND file spec is already copied here; add the SciVis 2026 Task 1 brief when received).
- `environment.yml`, `setup.sh`, `setup_windows.bat` for environment setup.

## Workflow notes
- Keep components modular: implement the factory contract in `docs/components.md` and register via `addComponent` in `web/src/main.js`.
- Store raw DYAMOND data externally; emit downsampled artifacts into `data/samples/` for quick iteration.
- If you add new data schemas or assets, update the docs and drop any reference material into `docs/references/`.
