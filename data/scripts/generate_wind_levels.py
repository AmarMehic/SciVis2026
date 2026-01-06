#!/usr/bin/env python
"""Generate per-level wind JSON files for the web viewer.

This is a small helper around `cubed_sphere_to_latlon.py` output schema.

It can:
- generate placeholder levels from an existing lat/lon JSON (useful for UI testing)
- OR (optional) it can call the cubed-sphere converter for each level, if you provide
  the cubed-sphere inputs and set `--mode cubed-sphere`.

Outputs:
- web/public/data/wind/uv_level_XXX.json for each level
- web/public/data/wind/levels.json manifest listing available levels

Notes:
- The web app uses /data/wind/... which Vite serves from web/public.
- For real data across levels, prefer `--mode cubed-sphere`.
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import subprocess
import sys
from typing import Any, Iterable, List, Sequence


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_OUT_DIR = ROOT / "web" / "public" / "data" / "wind"


def _read_json(path: pathlib.Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: pathlib.Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")


def _scale_field(field: list, scale: float) -> list:
    # field is nested lists [j][i]; values can be None
    out = []
    for row in field:
        out_row = []
        for v in row:
            if v is None:
                out_row.append(None)
            else:
                out_row.append(float(v) * scale)
        out.append(out_row)
    return out


def _placeholder_levels(
    template: dict,
    levels: Sequence[int],
    out_dir: pathlib.Path,
    scale_per_level: float,
) -> None:
    manifest_levels: List[int] = []

    for level in levels:
        scale = 1.0 + scale_per_level * float(level)
        out = {
            "meta": {
                **(template.get("meta", {}) or {}),
                "level": int(level),
            },
            "u": _scale_field(template.get("u", []), scale),
            "v": _scale_field(template.get("v", []), scale),
        }

        out_path = out_dir / f"uv_level_{level:03d}.json"
        _write_json(out_path, out)
        manifest_levels.append(int(level))

    _write_json(out_dir / "levels.json", {"levels": manifest_levels})


def _cubed_sphere_levels(
    inputs: Sequence[str],
    var_u: str,
    var_v: str,
    time_sel: str | None,
    levels: Sequence[int],
    lon_res: int,
    lat_res: int,
    cube_coarsen: int | None,
    out_dir: pathlib.Path,
    verbose: bool,
) -> None:
    """Call existing converter once per level and write to out_dir."""

    manifest_levels: List[int] = []
    converter = ROOT / "data" / "scripts" / "cubed_sphere_to_latlon.py"

    for level in levels:
        out_path = out_dir / f"uv_level_{level:03d}.json"
        cmd: List[str] = [sys.executable, str(converter), *inputs]
        cmd += ["--var-u", var_u, "--var-v", var_v]
        cmd += ["--lon-res", str(lon_res), "--lat-res", str(lat_res)]
        cmd += ["--output", str(out_path)]
        cmd += ["--level", str(level)]
        if time_sel is not None:
            cmd += ["--time", str(time_sel)]
        if cube_coarsen is not None:
            cmd += ["--cube-coarsen", str(cube_coarsen)]
        if verbose:
            cmd += ["-v"]

        print("Running:", " ".join(cmd))
        subprocess.check_call(cmd)
        manifest_levels.append(int(level))

    _write_json(out_dir / "levels.json", {"levels": manifest_levels})


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--mode",
        choices=["placeholder", "cubed-sphere"],
        default="placeholder",
        help="placeholder: generate fake levels from a template JSON; cubed-sphere: run cubed_sphere_to_latlon.py per level",
    )

    ap.add_argument(
        "--template-json",
        type=str,
        default=str(ROOT / "data" / "samples" / "uv_small.json"),
        help="Template lat/lon JSON (used in placeholder mode).",
    )

    ap.add_argument(
        "--out-dir",
        type=str,
        default=str(DEFAULT_OUT_DIR),
        help="Output directory for web JSON files (served as /data/wind/...)",
    )

    ap.add_argument(
        "--levels",
        type=str,
        default="0-50",
        help="Levels to generate. Formats: '0-50' or '0,1,2,10'",
    )

    ap.add_argument(
        "--scale-per-level",
        type=float,
        default=0.0,
        help="(placeholder mode) multiply U/V by (1 + scale_per_level*level)",
    )

    # cubed-sphere mode args
    ap.add_argument(
        "--inputs",
        nargs="*",
        default=[],
        help="(cubed-sphere mode) one or more NetCDF/IDX files (e.g., 6 faces uv_face0.nc .. uv_face5.nc)",
    )
    ap.add_argument("--var-u", type=str, default="U")
    ap.add_argument("--var-v", type=str, default="V")
    ap.add_argument("--time", type=str, default=None)
    ap.add_argument("--lon-res", type=int, default=360)
    ap.add_argument("--lat-res", type=int, default=181)
    ap.add_argument("--cube-coarsen", type=int, default=None)
    ap.add_argument("-v", "--verbose", action="store_true")

    ns = ap.parse_args(argv)

    out_dir = pathlib.Path(ns.out_dir)

    # parse levels
    levels: List[int] = []
    if "," in ns.levels:
        levels = [int(x.strip()) for x in ns.levels.split(",") if x.strip()]
    elif "-" in ns.levels:
        a, b = ns.levels.split("-", 1)
        levels = list(range(int(a), int(b) + 1))
    else:
        levels = [int(ns.levels)]

    if ns.mode == "placeholder":
        template = _read_json(pathlib.Path(ns.template_json))
        _placeholder_levels(template, levels, out_dir, ns.scale_per_level)
        print(f"Wrote {len(levels)} placeholder levels to {out_dir}")
        return 0

    # cubed-sphere
    if not ns.inputs:
        raise SystemExit("--mode cubed-sphere requires --inputs <uv_face0.nc ...>")

    _cubed_sphere_levels(
        inputs=ns.inputs,
        var_u=ns.var_u,
        var_v=ns.var_v,
        time_sel=ns.time,
        levels=levels,
        lon_res=ns.lon_res,
        lat_res=ns.lat_res,
        cube_coarsen=ns.cube_coarsen,
        out_dir=out_dir,
        verbose=ns.verbose,
    )
    print(f"Wrote {len(levels)} levels to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

