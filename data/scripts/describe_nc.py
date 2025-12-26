#!/usr/bin/env python
"""Quick summary of NetCDF face files (dims, vars, min/max)."""
import argparse
import pathlib
import sys

import numpy as np
import xarray as xr


def summarize(path: pathlib.Path, vars_filter=None):
    ds = xr.open_dataset(path)
    print(f"\n=== {path} ===")
    print("dims:", dict(ds.dims))
    if ds.coords:
        coord_names = list(ds.coords)
        print("coords:", coord_names)
    var_names = vars_filter or list(ds.data_vars)
    print("data_vars:", list(ds.data_vars))
    for name in var_names:
        if name not in ds:
            print(f"  - {name}: not found")
            continue
        da = ds[name]
        arr = np.asarray(da)
        finite = arr[np.isfinite(arr)]
        vmin = finite.min() if finite.size else np.nan
        vmax = finite.max() if finite.size else np.nan
        print(f"  - {name}: shape={arr.shape}, dims={da.dims}, min/max={vmin:.3f}/{vmax:.3f}")
    ds.close()


def main():
    ap = argparse.ArgumentParser(description="Summarize NetCDF face files")
    ap.add_argument("files", nargs="+", help="Paths to .nc files")
    ap.add_argument("--vars", nargs="*", default=None, help="Specific variable names to summarize")
    args = ap.parse_args()

    for fname in args.files:
        summarize(pathlib.Path(fname), vars_filter=args.vars)


if __name__ == "__main__":
    sys.exit(main())
