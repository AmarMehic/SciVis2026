import pathlib
import numpy as np
import xarray as xr
import openvisuspy as ov

base_url = "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS"
timestep = 0   # change if you want a different time
level = 0      # vertical index 0..51 (52 levels)

def read_face(var: str, face: int):
    url = f"{base_url}/GEOS_{var.upper()}/{var}_face_{face}_depth_52_time_0_10269.idx"
    ds = ov.LoadDataset(url)
    nx, ny, nz = ds.getLogicSize()
    if level >= nz:
        raise ValueError(f"level {level} out of range 0..{nz-1}")
    logic_box = ([0, 0, level], [nx, ny, level + 1])  # full X/Y, one Z
    query = ds.createBoxQuery(timestep=timestep, field=ds.getField().name, logic_box=logic_box, full_dim=True)
    access = ds.createAccess()
    ds.beginBoxQuery(query)
    last = None
    while ds.isQueryRunning(query):
        res = ds.executeBoxQuery(access, query)
        if res is None:
            break
        last = res["data"]
        ds.nextBoxQuery(query)
    if last is None:
        raise RuntimeError(f"No data for {url}")
    arr = np.squeeze(last)
    print(f"{var} face {face}: shape {arr.shape}, min/max {arr.min():.3f}/{arr.max():.3f}")
    return arr

faces = []
for face in range(6):
    print(f"Fetching U face {face}…")
    U = read_face("u", face)
    print(f"Fetching V face {face}…")
    V = read_face("v", face)
    if U.shape != V.shape:
        raise RuntimeError(f"Shape mismatch on face {face}: U{U.shape} vs V{V.shape}")
    faces.append({"face": face, "U": U, "V": V})

# Save one NetCDF per face
out_dir = pathlib.Path("notebooks/geos_faces")
out_dir.mkdir(parents=True, exist_ok=True)
for f in faces:
    ny, nx = f["U"].shape
    ds = xr.Dataset(
        {
            "U": (("face", "y", "x"), f["U"][None, ...]),
            "V": (("face", "y", "x"), f["V"][None, ...]),
        },
        coords={"face": [f["face"]], "y": np.arange(ny), "x": np.arange(nx)},
        attrs={"source": "DYAMOND GEOS", "timestep": int(timestep), "level": int(level)},
    )
    out_path = out_dir / f"uv_face{f['face']}.nc"
    ds.to_netcdf(out_path)
    print("wrote", out_path, ds["U"].shape)
