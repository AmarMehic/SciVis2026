# Minimal Panel app to explore OpenVisus datasets defined in a JSON file.
# Run with:
#   conda activate sci-vis
#   panel serve dashboards/openvisus/app/main.py --autoreload
# Optionally override the config path:
#   OVIS_DASHBOARD_CONFIG=/path/to/dashboards.json panel serve ...
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List

import panel as pn

pn.extension("ace", "codeeditor", design="bootstrap")

# Prefer CodeEditor when available; fall back to Markdown.
try:  # pragma: no cover - runtime feature detection
    CodeEditor = pn.widgets.CodeEditor  # type: ignore[attr-defined]
except Exception:  # pragma: no cover - compatibility
    CodeEditor = None


def load_datasets(config_path: Path) -> tuple[List[Dict[str, Any]], str | None]:
    """Load dataset definitions; return (datasets, error_message)."""
    if not config_path.exists():
        return [], f"Config file not found at {config_path}"
    try:
        data = json.loads(config_path.read_text())
        datasets = data.get("datasets", [])
        if not isinstance(datasets, list):
            return [], "Config file is missing a top-level 'datasets' list."
        return datasets, None
    except Exception as exc:  # pragma: no cover - defensive
        return [], f"Failed to parse config: {exc}"


DEFAULT_CONFIG = (
    Path(os.environ.get("OVIS_DASHBOARD_CONFIG"))
    if os.environ.get("OVIS_DASHBOARD_CONFIG")
    else Path(__file__).resolve().parent.parent / "json" / "dashboards.json"
)

datasets, load_error = load_datasets(DEFAULT_CONFIG)
dataset_map = {d["id"]: d for d in datasets if "id" in d}

default_dataset_id = next(iter(dataset_map.keys()), None)
select_options = {d.get("label", d["id"]): d["id"] for d in datasets if "id" in d}
if not select_options:
    select_options = {"(no datasets found)": None}


def current_dataset() -> Dict[str, Any]:
    return dataset_map.get(dataset_select.value) or {}


dataset_select = pn.widgets.Select(
    name="Dataset", options=select_options, value=default_dataset_id
)

field_select = pn.widgets.Select(name="Field", options=[], value=None)
time_input = pn.widgets.IntInput(name="Time index", value=0, start=0)
res_drop_input = pn.widgets.IntInput(
    name="Resolution drop (levels)", value=4, start=0, end=12
)
face_select = pn.widgets.IntSlider(
    name="Face (cubed-sphere 0–5)",
    start=0,
    end=5,
    value=0,
    step=1,
    disabled=True,
    visible=True,
)

details_md = pn.pane.Markdown(sizing_mode="stretch_width")
if CodeEditor:
    code_openvisus_pane = CodeEditor(
        language="python",
        sizing_mode="stretch_width",
        height=320,
        theme="github",
        disabled=True,  # read-only display
    )
    code_derived_pane = CodeEditor(
        language="python",
        sizing_mode="stretch_width",
        height=320,
        theme="github",
        disabled=True,  # read-only display
    )
else:
    code_openvisus_pane = pn.pane.Markdown(sizing_mode="stretch_width")
    code_derived_pane = pn.pane.Markdown(sizing_mode="stretch_width")


def set_code(pane: Any, text: str) -> None:
    """Update a code display pane."""
    if CodeEditor and isinstance(pane, CodeEditor):  # type: ignore[arg-type]
        pane.value = text
    else:
        pane.object = f"```python\n{text}\n```"


def build_code_snippet(ds: Dict[str, Any]) -> str:
    """Construct a small Python snippet to read a downsampled brick."""
    raw_idx_url = ds.get("idx_url", "<idx_url>")
    face = face_select.value
    idx_url = raw_idx_url.format(face=face) if "{face}" in raw_idx_url else raw_idx_url
    field = field_select.value or (ds.get("fields", [])[:1] or ["<field>"])[0]
    time = time_input.value
    res_drop = res_drop_input.value

    return f"""import OpenVisus as ov

idx_url = "{idx_url}"
field = "{field}"
time = {time}
resolution_drop = {res_drop}  # larger drop = coarser read (safer for big datasets)

ds = ov.LoadDataset(idx_url)

# Quality: 0 = full res, negative = coarser. This inverts our drop to a negative quality.
quality = -resolution_drop
data = ds.read(time=time, field=field, quality=quality)

print("shape:", getattr(data, "shape", None), "dtype:", getattr(data, "dtype", None))
"""


def build_derived_snippet(ds: Dict[str, Any]) -> str:
    """Construct a helper snippet for common Task 1 derived fields."""
    raw_idx_url = ds.get("idx_url", "<idx_url>")
    face = face_select.value
    idx_url = raw_idx_url.format(face=face) if "{face}" in raw_idx_url else raw_idx_url
    fields = ds.get("fields", [])
    field_u = "U" if "U" in fields else (fields[0] if fields else "<U_field>")
    field_v = "V" if "V" in fields else (fields[1] if len(fields) > 1 else "<V_field>")
    field_w = "W" if "W" in fields else "<W_field>"
    time = time_input.value
    res_drop = res_drop_input.value

    return f"""import numpy as np
import OpenVisus as ov

idx_url = "{idx_url}"
time = {time}
resolution_drop = {res_drop}

ds = ov.LoadDataset(idx_url)
quality = -resolution_drop  # negative = coarser
u = ds.read(field="{field_u}", time=time, quality=quality)
v = ds.read(field="{field_v}", time=time, quality=quality)
w = ds.read(field="{field_w}", time=time, quality=quality)

speed = np.sqrt(u**2 + v**2)
# Simple central differences for vorticity/divergence (replace with cube-aware stencils as needed).
du_dy = np.gradient(u, axis=1)
dv_dx = np.gradient(v, axis=0)
rel_vorticity = dv_dx - du_dy
divergence = du_dy + dv_dx

print("speed range", float(speed.min()), float(speed.max()))
"""


def update_ui(event=None) -> None:
    ds = current_dataset()
    fields = ds.get("fields", [])
    if fields:
        field_select.options = fields
        if field_select.value not in fields:
            field_select.value = fields[0]
    else:
        field_select.options = []
        field_select.value = None

    time_input.value = int(ds.get("default_time", time_input.value))
    res_drop_input.value = int(
        ds.get("default_resolution_drop", res_drop_input.value)
    )
    face_select.value = int(ds.get("default_face", face_select.value))

    raw_idx_url = ds.get("idx_url", "")
    face_select.disabled = "{face}" not in raw_idx_url

    description = ds.get("description", "No description provided.")
    raw_idx_url = ds.get("idx_url", "N/A")
    idx_url = raw_idx_url.format(face=face_select.value) if "{face}" in raw_idx_url else raw_idx_url

    details_lines = [
        f"**Config file:** `{DEFAULT_CONFIG}`",
        f"**IDX URL:** `{idx_url}`",
        f"**Face selector:** {'active (applies ' + str(face_select.value) + ')' if '{face}' in raw_idx_url else 'n/a (idx_url has no {face} placeholder)'}",
        f"**Fields:** {', '.join(fields) if fields else 'not specified'}",
        f"**Default time:** {ds.get('default_time', 0)}",
        f"**Default resolution drop:** {ds.get('default_resolution_drop', 4)}",
        "",
        description,
    ]
    if load_error:
        details_lines.append(f"\n**Config warning:** {load_error}")

    details_md.object = "\n".join(details_lines)
    set_code(code_openvisus_pane, build_code_snippet(ds))
    set_code(code_derived_pane, build_derived_snippet(ds))


def trigger_update(event=None) -> None:
    set_code(code_openvisus_pane, build_code_snippet(current_dataset()))
    set_code(code_derived_pane, build_derived_snippet(current_dataset()))


dataset_select.param.watch(update_ui, "value")
field_select.param.watch(trigger_update, "value")
time_input.param.watch(trigger_update, "value")
res_drop_input.param.watch(trigger_update, "value")
face_select.param.watch(trigger_update, "value")

# Initialize UI once widgets exist
update_ui()

header = pn.pane.Markdown(
    "# OpenVisus dashboard scaffold\n"
    "Select a dataset from the JSON config, inspect its fields, "
    "and copy a ready-to-run OpenVisuspy snippet.",
    sizing_mode="stretch_width",
)

controls = pn.Card(
    dataset_select,
    field_select,
    time_input,
    res_drop_input,
    face_select,
    title="Controls",
    collapsible=False,
    sizing_mode="stretch_height",
    width=320,
)

explorer_body = pn.Column(
    details_md,
    pn.layout.Divider(),
    pn.pane.Markdown("#### OpenVisus read snippet"),
    code_openvisus_pane,
    sizing_mode="stretch_both",
)

research_md = pn.pane.Markdown(
    "### Task 1 research kit\n"
    "- Focus features: jet streams (speed ridges), cyclones (↑ vorticity), convergence (divergence < 0).\n"
    "- Suggested levels: upper (≈250 hPa), mid (≈500 hPa), lower (≈850 hPa) for contrasting patterns.\n"
    "- Time sampling: start with a few daily frames across seasons; keep resolution drops high for interactivity.\n"
    "- Outputs: downsampled JSON/NetCDF slices for the web app; derived speed/vorticity/divergence for feature picking.\n",
    sizing_mode="stretch_width",
)

research_body = pn.Column(
    research_md,
    pn.layout.Divider(),
    pn.pane.Markdown("#### Derived fields scaffold (speed/vorticity/divergence)"),
    code_derived_pane,
    sizing_mode="stretch_both",
)

tabs = pn.Tabs(
    ("Explorer", pn.Row(controls, explorer_body, sizing_mode="stretch_both")),
    ("Research kit", pn.Row(controls, research_body, sizing_mode="stretch_both")),
)

app = pn.Column(header, tabs, sizing_mode="stretch_both")
app.servable("OpenVisus dashboards")
