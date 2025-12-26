import pathlib
import numpy as np
import xarray as xr
import openvisuspy as ov

base_url = "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/"
timestep = 0
level = 0
# For full-globe coverage, request the whole face but allow the server to downsample to this many pixels.
MAX_PIXELS = 1_500_000
WINDOW = 20_000  # bigger than domain; will be clamped to dataset size


def read_slice(url: str, timestep: int, level: int):
    ds = ov.LoadDataset(url)
    nx, ny, nz = ds.getLogicSize()
    if level < 0 or level >= nz:
        raise ValueError(f"level {level} out of range 0..{nz-1}")
    x1 = min(nx, WINDOW)
    y1 = min(ny, WINDOW)
    # subset X/Y, one layer in Z
    logic_box = ([0, 0, level], [x1, y1, level + 1])
    query = ds.createBoxQuery(
        timestep=timestep,
        field=ds.getField().name,
        logic_box=logic_box,
        full_dim=True,
        max_pixels=MAX_PIXELS,
    )
    if query is None:
        raise RuntimeError("Failed to create query")
    access = ds.createAccess()
    ds.beginBoxQuery(query)
    last_data = None
    while ds.isQueryRunning(query):
        result = ds.executeBoxQuery(access, query)
        if result is None:
            break
        last_data = result["data"]
        ds.nextBoxQuery(query)
    if last_data is None:
        raise RuntimeError("No data returned from query")
    return np.squeeze(last_data)


def fetch_var(var: str):
    if var in ("theta", "w"):
        base_dir = f"mit_output/llc2160_{var}/llc2160_{var}.idx"
    elif var == "u":
        base_dir = "mit_output/llc2160_arco/visus.idx"
    else:
        base_dir = f"mit_output/llc2160_{var}/{var}_llc2160_x_y_depth.idx"
    url = base_url + base_dir
    print(f"Reading {var} from {url} (timestep={timestep}, level={level})")
    data = read_slice(url, timestep=timestep, level=level)
    print(f"  shape {data.shape}, min/max {data.min():.3f}/{data.max():.3f}")
    return data


print("Fetching U...")
U = fetch_var("u")
print("Fetching V...")
V = fetch_var("v")

if U.shape != V.shape:
    raise RuntimeError(f"Shape mismatch U{U.shape} vs V{V.shape}")

ny, nx = U.shape
cube = xr.Dataset(
    {
        "U": (("face", "y", "x"), U[None, ...]),
        "V": (("face", "y", "x"), V[None, ...]),
    },
    coords={"face": [0], "y": np.arange(ny), "x": np.arange(nx)},
    attrs={"source": "DYAMOND GEOS via OpenVisus",
           "timestep": int(timestep), "level": int(level)},
)
out_path = pathlib.Path("notebooks/uv_cube_t0_z0.nc")
out_path.parent.mkdir(parents=True, exist_ok=True)
cube.to_netcdf(out_path)
print("Wrote", out_path, "shape", cube["U"].shape)
