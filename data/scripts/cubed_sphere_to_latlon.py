#!/usr/bin/env python
"""Cubed-sphere to lat/lon wind sampler for SciVis 2026."""
import argparse
import json
import logging
import math
import pathlib
from typing import Iterable, Optional, Sequence, Tuple, Union

import numpy as np
import xarray as xr

try:  # Optional; speeds up nearest-neighbor search if available
    from scipy.spatial import cKDTree  # type: ignore
except Exception:  # pragma: no cover - fallback path
    cKDTree = None


ArrayLike = Union[np.ndarray, xr.DataArray]


def _latlon_to_unit(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    lat_r = np.deg2rad(lat)
    lon_r = np.deg2rad(lon)
    x = np.cos(lat_r) * np.cos(lon_r)
    y = np.cos(lat_r) * np.sin(lon_r)
    z = np.sin(lat_r)
    return np.stack((x, y, z), axis=-1)


def _infer_dim(name_candidates: Sequence[str], ds: xr.Dataset) -> Optional[str]:
    for cand in name_candidates:
        if cand in ds.dims or cand in ds.coords:
            return cand
    return None


def _extract_time_level(ds: xr.Dataset, time_sel=None, level_sel=None) -> Tuple[xr.Dataset, Optional[str], Optional[float]]:
    time_dim = _infer_dim(["time", "Time", "t"], ds)
    level_dim = _infer_dim(["lev", "level", "Levels", "height", "z"], ds)

    if time_sel is not None and time_dim is not None:
        if isinstance(time_sel, (int, np.integer)):
            ds = ds.isel({time_dim: int(time_sel)})
        else:
            ds = ds.sel({time_dim: time_sel}, method="nearest")
    if level_sel is not None and level_dim is not None:
        if isinstance(level_sel, (int, np.integer)):
            ds = ds.isel({level_dim: int(level_sel)})
        else:
            ds = ds.sel({level_dim: level_sel}, method="nearest")

    time_value = None
    if time_dim and time_dim in ds.coords:
        coord = ds[time_dim]
        if coord.size == 1:
            time_value = coord.values.item()

    level_value = None
    if level_dim and level_dim in ds.coords:
        coord = ds[level_dim]
        if coord.size == 1:
            level_value = coord.values.item()

    ds = ds.squeeze(drop=True)
    return ds, time_value, level_value


def _cube_face_ij_to_latlon(face_ids: np.ndarray, i: np.ndarray, j: np.ndarray, nx: int, ny: int) -> Tuple[np.ndarray, np.ndarray]:
    # Normalize i,j to [-1, 1]
    a = (2.0 * (i / max(nx - 1, 1))) - 1.0
    b = (2.0 * (j / max(ny - 1, 1))) - 1.0

    x = np.zeros_like(a, dtype=np.float64)
    y = np.zeros_like(a, dtype=np.float64)
    z = np.zeros_like(a, dtype=np.float64)

    faces = face_ids.astype(np.int64)
    x[faces == 0] = 1.0
    y[faces == 0] = a[faces == 0]
    z[faces == 0] = b[faces == 0]

    x[faces == 1] = -1.0
    y[faces == 1] = -a[faces == 1]
    z[faces == 1] = b[faces == 1]

    x[faces == 2] = a[faces == 2]
    y[faces == 2] = 1.0
    z[faces == 2] = b[faces == 2]

    x[faces == 3] = -a[faces == 3]
    y[faces == 3] = -1.0
    z[faces == 3] = b[faces == 3]

    x[faces == 4] = a[faces == 4]
    y[faces == 4] = b[faces == 4]
    z[faces == 4] = 1.0

    x[faces == 5] = a[faces == 5]
    y[faces == 5] = -b[faces == 5]
    z[faces == 5] = -1.0

    vec = np.stack((x, y, z), axis=-1)
    norm = np.linalg.norm(vec, axis=-1, keepdims=True)
    norm[norm == 0] = 1.0
    vec = vec / norm

    lat = np.rad2deg(np.arcsin(vec[..., 2]))
    lon = np.rad2deg(np.arctan2(vec[..., 1], vec[..., 0]))
    return lat, lon


def _extract_lat_lon(ds: xr.Dataset, x_dim: str, y_dim: str, face_dim: Optional[str]) -> Tuple[np.ndarray, np.ndarray]:
    lat_name = _infer_dim(["lat", "latitude", "Lat", "LAT", "geolat"], ds)
    lon_name = _infer_dim(["lon", "longitude", "Lon", "LON", "geolon"], ds)

    if lat_name and lon_name and lat_name in ds and lon_name in ds:
        lat = np.asarray(ds[lat_name].values)
        lon = np.asarray(ds[lon_name].values)
        return lat, lon

    logging.info("Lat/lon arrays missing; using analytic cubed-sphere geometry (gnomonic, X-forward face order).")

    shape = ds[x_dim].shape if x_dim in ds.dims else ds[list(ds.dims)[-1]].shape
    nx = ds.dims[x_dim]
    ny = ds.dims[y_dim]
    face_size = ds.dims.get(face_dim, 1) if face_dim else 1

    jj, ii = np.meshgrid(np.arange(ny), np.arange(nx), indexing="ij")
    if face_dim:
        face_ids = np.arange(face_size)[:, None, None] * np.ones_like(ii)[None, ...]
        ii = np.broadcast_to(ii, (face_size,) + ii.shape)
        jj = np.broadcast_to(jj, (face_size,) + jj.shape)
    else:
        face_ids = np.zeros_like(ii)

    lat, lon = _cube_face_ij_to_latlon(face_ids, ii, jj, nx, ny)
    return lat, lon


def _detect_dims(da: xr.DataArray) -> Tuple[Optional[str], str, str]:
    dims = list(da.dims)
    face_dim = next((d for d in dims if "face" in d or d in ("nf", "tile")), None)
    spatial_dims = [d for d in dims if d != face_dim]
    if len(spatial_dims) < 2:
        raise ValueError(f"Cannot infer spatial dims from {dims}")
    y_dim, x_dim = spatial_dims[-2:]
    return face_dim, y_dim, x_dim


def _load_inputs(inputs: Union[str, pathlib.Path, Sequence[Union[str, pathlib.Path]]]) -> xr.Dataset:
    if isinstance(inputs, (str, pathlib.Path)):
        inputs = [inputs]

    datasets = []
    for idx, path in enumerate(inputs):
        logging.info("Opening %s", path)
        ds = xr.open_dataset(path)
        datasets.append(ds)

    if len(datasets) == 1:
        return datasets[0]

    expanded = []
    for idx, ds in enumerate(datasets):
        if "face" in ds.dims:
            expanded.append(ds)
        else:
            expanded.append(ds.assign_coords(face=idx).expand_dims("face"))
    combined = xr.concat(expanded, dim="face")
    return combined


def _maybe_coarsen(ds: xr.Dataset, y_dim: str, x_dim: str, factor: Optional[int]) -> xr.Dataset:
    if not factor or factor <= 1:
        return ds
    logging.info("Coarsening cube by factor %s along (%s, %s)", factor, y_dim, x_dim)
    return ds.coarsen({y_dim: factor, x_dim: factor}, boundary="trim").mean()


def _build_tree(xyz: np.ndarray):
    if cKDTree is None:
        return None
    logging.info("Using cKDTree for nearest-neighbor search")
    return cKDTree(xyz)


def _nearest_indices(valid_xyz: np.ndarray, query_xyz: np.ndarray) -> np.ndarray:
    tree = _build_tree(valid_xyz)
    if tree is not None:
        _, idx = tree.query(query_xyz, k=1)
        return idx.astype(np.int64)

    logging.info("cKDTree unavailable; falling back to chunked brute-force search")
    idx = np.empty(query_xyz.shape[0], dtype=np.int64)
    chunk = 64
    valid_xyz_t = valid_xyz.T.astype(np.float32, copy=False)
    for start in range(0, query_xyz.shape[0], chunk):
        end = min(query_xyz.shape[0], start + chunk)
        chunk_xyz = query_xyz[start:end].astype(np.float32, copy=False)
        dots = valid_xyz_t.T @ chunk_xyz.T  # (n_valid, chunk)
        idx[start:end] = np.argmax(dots, axis=0)
    return idx


def _to_serializable(arr: np.ndarray) -> list:
    arr32 = arr.astype(np.float32)
    if np.isfinite(arr32).all():
        return arr32.tolist()
    serializable = arr32.tolist()
    for i, row in enumerate(serializable):
        for j, val in enumerate(row):
            if not math.isfinite(val):
                serializable[i][j] = None
    return serializable


def convert_cubed_sphere_to_latlon(
    inputs: Union[str, pathlib.Path, Sequence[Union[str, pathlib.Path]]],
    target_lon: ArrayLike,
    target_lat: ArrayLike,
    var_u: str = "U",
    var_v: str = "V",
    time_sel=None,
    level_sel=None,
    method: str = "nearest",
    cube_coarsen: Optional[int] = None,
) -> dict:
    if method != "nearest":
        raise ValueError("Only nearest interpolation is implemented in this POC")

    ds = _load_inputs(inputs)
    ds, time_value, level_value = _extract_time_level(ds, time_sel=time_sel, level_sel=level_sel)

    if var_u not in ds or var_v not in ds:
        raise KeyError(f"Could not find variables {var_u} and {var_v} in dataset")

    face_dim, y_dim, x_dim = _detect_dims(ds[var_u])

    if cube_coarsen is None:
        fx = max(1, ds.dims[x_dim] // max(1, int(np.size(target_lon))))
        fy = max(1, ds.dims[y_dim] // max(1, int(np.size(target_lat))))
        cube_coarsen = max(min(fx, fy), 1)
        if cube_coarsen > 1:
            logging.info("Auto coarsen factor: %s", cube_coarsen)
    ds = _maybe_coarsen(ds, y_dim, x_dim, cube_coarsen)

    lat_arr, lon_arr = _extract_lat_lon(ds, x_dim, y_dim, face_dim)

    u_cube = ds[var_u].astype(np.float64)
    v_cube = ds[var_v].astype(np.float64)

    lat_arr = np.asarray(lat_arr, dtype=np.float64)
    lon_arr = np.asarray(lon_arr, dtype=np.float64)

    mask = (
        np.isfinite(lat_arr)
        & np.isfinite(lon_arr)
        & np.isfinite(u_cube)
        & np.isfinite(v_cube)
    )
    if not mask.any():
        raise ValueError("No finite samples found after masking lat/lon/u/v")

    lat_flat = lat_arr[mask]
    lon_flat = lon_arr[mask]
    u_flat = u_cube.values[mask]
    v_flat = v_cube.values[mask]

    valid_xyz = _latlon_to_unit(lat_flat, lon_flat).reshape(-1, 3)

    lon_target = np.asarray(target_lon, dtype=np.float64)
    lat_target = np.asarray(target_lat, dtype=np.float64)
    lon_mesh, lat_mesh = np.meshgrid(lon_target, lat_target)
    query_xyz = _latlon_to_unit(lat_mesh.ravel(), lon_mesh.ravel()).reshape(-1, 3)

    nn_idx = _nearest_indices(valid_xyz, query_xyz)

    u_out = u_flat[nn_idx].reshape(lat_mesh.shape)
    v_out = v_flat[nn_idx].reshape(lat_mesh.shape)

    meta = {
        "time": None if time_value is None else str(time_value),
        "level": None if level_value is None else float(level_value),
        "units": "m/s",
        "method": method,
        "cube_shape": {
            "face": int(ds.dims.get(face_dim, 1) if face_dim else 1),
            "y": int(ds.dims[y_dim]),
            "x": int(ds.dims[x_dim]),
        },
        "grid": {
            "lon": np.asarray(target_lon, dtype=np.float64).tolist(),
            "lat": np.asarray(target_lat, dtype=np.float64).tolist(),
        },
        "shape": [int(lat_mesh.shape[0]), int(lat_mesh.shape[1])],
    }

    return {
        "meta": meta,
        "u": _to_serializable(u_out),
        "v": _to_serializable(v_out),
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert cubed-sphere wind to lat/lon JSON")
    parser.add_argument("inputs", nargs="+", help="NetCDF/IDX paths (one per face or combined)")
    parser.add_argument("--var-u", default="U", help="Name of eastward wind variable")
    parser.add_argument("--var-v", default="V", help="Name of northward wind variable")
    parser.add_argument("--time", dest="time_sel", help="Time index or timestamp")
    parser.add_argument("--level", dest="level_sel", help="Vertical level index/value")
    parser.add_argument("--lon-res", type=int, default=360, help="Number of longitude samples (default: 360)")
    parser.add_argument("--lat-res", type=int, default=181, help="Number of latitude samples (default: 181)")
    parser.add_argument(
        "--method",
        choices=["nearest"],
        default="nearest",
        help="Interpolation method (nearest only in this POC)",
    )
    parser.add_argument(
        "--cube-coarsen",
        type=int,
        default=None,
        help="Optional integer coarsening factor before reprojection (auto if omitted)",
    )
    parser.add_argument(
        "--output",
        default="data/samples/uv_small.json",
        help="Output JSON path (default: data/samples/uv_small.json)",
    )
    parser.add_argument("-v", "--verbose", action="count", default=0, help="Increase log verbosity")
    return parser.parse_args()


def main():
    args = _parse_args()
    log_level = logging.WARNING - (10 * min(args.verbose, 2))
    logging.basicConfig(level=log_level, format="[%(levelname)s] %(message)s")

    target_lon = np.linspace(-180.0, 180.0, num=args.lon_res, endpoint=False)
    target_lat = np.linspace(-90.0, 90.0, num=args.lat_res)

    result = convert_cubed_sphere_to_latlon(
        inputs=args.inputs,
        target_lon=target_lon,
        target_lat=target_lat,
        var_u=args.var_u,
        var_v=args.var_v,
        time_sel=args.time_sel,
        level_sel=args.level_sel,
        method=args.method,
        cube_coarsen=args.cube_coarsen,
    )

    output_path = pathlib.Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(result, f, allow_nan=False)

    u_arr = np.asarray(result["u"], dtype=np.float32)
    v_arr = np.asarray(result["v"], dtype=np.float32)
    logging.info(
        "Wrote %s with grid %sx%s; u[min,max]=%.3f..%.3f, v[min,max]=%.3f..%.3f",
        output_path,
        result["meta"]["shape"][1],
        result["meta"]["shape"][0],
        np.nanmin(u_arr),
        np.nanmax(u_arr),
        np.nanmin(v_arr),
        np.nanmax(v_arr),
    )


if __name__ == "__main__":
    main()
