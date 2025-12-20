# OpenVisus Panel dashboards

This scaffold wraps OpenVisuspy with a tiny Panel UI so you can point to remote `.idx` datasets, inspect their fields, and copy a ready-to-run Python snippet for sampling them.

## Setup
1) Ensure the `sci-vis` conda env has `panel` + `openvisuspy` with the CodeEditor extra (already listed in `environment.yml`):
   ```bash
   conda activate sci-vis
   # if the env predates this addition:
   conda env update -f environment.yml --prune
   ```
2) Run the Panel app:
   ```bash
   panel serve dashboards/openvisus/app/main.py --autoreload
   ```
   Then open the served URL in a browser (Panel prints it to the console).

## Configure datasets
Edit `dashboards/openvisus/json/dashboards.json` to point at your `.idx` endpoints and fields. Each entry supports:
- `id`, `label`: identifiers shown in the UI.
- `idx_url`: Visus `.idx` URL (HTTP/S3/local). Use `{face}` in the URL for cubed-sphere datasets so the face slider can swap faces 0–5.
- `fields`: list of field names available in the dataset.
- `default_time`: starting timestep index.
- `default_face`: starting cube face (if `{face}` is present).
- `default_resolution_drop`: how many levels to drop from `getMaxResolution()` for a safe, downsampled read.
- `description`: free text shown in the details panel.

You can point the app at a different config file without editing code:
```bash
OVIS_DASHBOARD_CONFIG=/path/to/custom.json panel serve dashboards/openvisus/app/main.py
```

## Usage
- Explorer tab: pick a dataset, field, time, and resolution drop; copy the generated OpenVisuspy read snippet. Adjust resolution drop to stay lightweight on multi-TB cubes.
- Research kit tab: quick Task 1 cues (jets/cyclones/convergence, suggested levels/time sampling) plus a scaffold to compute speed/vorticity/divergence from U/V/W reads.
- A tiny public sample (`2kbit1`) is included as a connectivity test before you hit the DYAMOND URLs.
