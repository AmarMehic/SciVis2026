import logging
from typing import Optional, Tuple

import numpy as np
import openvisuspy as ov

logger = logging.getLogger(__name__)


class DataManager:
    """Manage fetching U/V data from OpenVisus datasets.

    This mirrors the logic in data/scripts/fetch_uv.py but exposes a
    programmatic API for the backend.
    """

    def __init__(
        self,
        base_url: str = "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/",
        timestep: int = 0,
        level: int = 0,
        max_pixels: int = 1_500_000,
        window: int = 20_000,
        dataset_url: Optional[str] = None,
        u_field: Optional[str] = None,
        v_field: Optional[str] = None,
    ):
        self.base_url = base_url
        self.timestep = int(timestep)
        self.level = int(level)
        self.max_pixels = int(max_pixels)
        self.window = int(window)
        # Optional override: single dataset URL that contains named fields for U/V
        self.dataset_url = dataset_url
        self.u_field = u_field
        self.v_field = v_field

    def _url_for_var(self, var: str) -> str:
        if var in ("theta", "w"):
            base_dir = f"mit_output/llc2160_{var}/llc2160_{var}.idx"
        elif var == "u":
            base_dir = "mit_output/llc2160_arco/visus.idx"
        else:
            base_dir = f"mit_output/llc2160_{var}/{var}_llc2160_x_y_depth.idx"
        return self.base_url + base_dir

    def _fetch_from_url(self, url: str, logic_box: Tuple[Tuple[int, int, int], Tuple[int, int, int]], max_pixels: Optional[int] = None, timestep: Optional[int] = None, field_name: Optional[str] = None) -> np.ndarray:
        ds = ov.LoadDataset(url)
        nx, ny, nz = ds.getLogicSize()
        if max_pixels is None:
            max_pixels = self.max_pixels
        if timestep is None:
            timestep = self.timestep

        # allow explicit field selection when dataset contains multiple fields
        field_to_use = field_name if field_name is not None else ds.getField().name
        query = ds.createBoxQuery(
            timestep=int(timestep),
            field=field_to_use,
            logic_box=logic_box,
            full_dim=True,
            max_pixels=max_pixels,
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
            last_data = result.get("data")
            ds.nextBoxQuery(query)
        if last_data is None:
            raise RuntimeError("No data returned from query")
        return np.squeeze(last_data)

    def fetch_chunk(
        self,
        time: Optional[int] = None,
        x_range: Optional[Tuple[int, int]] = None,
        y_range: Optional[Tuple[int, int]] = None,
        quality: int = 1,
    ) -> bytes:
        """Fetch U and V for the requested rectangle and return interleaved float32 bytes.

        - `time` selects the timestep (overrides the manager's default if provided).
        - `x_range` and `y_range` are (start, end) tuples in logical coordinates.
        - `quality` can be used to relax `max_pixels` (higher -> fewer pixels).
        """
        if time is None:
            time = self.timestep
        else:
            time = int(time)

        # If a single dataset URL override is provided, use that and explicit field names (if any)
        if self.dataset_url is not None:
            url_u = self.dataset_url
            url_v = self.dataset_url
            u_field = self.u_field
            v_field = self.v_field
        else:
            # Prefer per-face GEOS DATA_SOURCES if available (crawler discovered them)
            try:
                from .config import DATA_SOURCES
            except Exception:
                DATA_SOURCES = None

            if DATA_SOURCES:
                # default to face 0 when a full-domain x/y range is requested
                url_u = DATA_SOURCES.get("u")[0]
                url_v = DATA_SOURCES.get("v")[0]
            else:
                url_u = self._url_for_var("u")
                url_v = self._url_for_var("v")
            u_field = None
            v_field = None

        # Load one dataset to discover sizes and clamp ranges
        ds_probe = ov.LoadDataset(url_u)
        nx, ny, nz = ds_probe.getLogicSize()

        x0, x1 = (0, nx) if x_range is None else (max(0, int(x_range[0])), min(nx, int(x_range[1])))
        y0, y1 = (0, ny) if y_range is None else (max(0, int(y_range[0])), min(ny, int(y_range[1])))

        logic_box = ([x0, y0, self.level], [x1, y1, self.level + 1])

        max_pixels = max(1, self.max_pixels // max(1, int(quality)))

        # fetch arrays
        U = self._fetch_from_url(url_u, logic_box=logic_box, max_pixels=max_pixels, timestep=time, field_name=u_field)
        # If v_field is not provided but dataset_url points to a single-field U dataset, synthesize V as zeros
        if v_field is None and url_v == url_u:
            # Create zeros matching U's shape
            V = np.zeros_like(U, dtype=U.dtype)
            logger.warning("V field missing; synthesizing zero V array for dataset %s", url_v)
        else:
            V = self._fetch_from_url(url_v, logic_box=logic_box, max_pixels=max_pixels, timestep=time, field_name=v_field)

        if U.shape != V.shape:
            raise RuntimeError(f"Shape mismatch U{U.shape} vs V{V.shape}")

        # Ensure float32
        Uf = U.astype(np.float32)
        Vf = V.astype(np.float32)

        # Interleave into (y,x,2) then ravel -> u,v,u,v...
        ny_out, nx_out = Uf.shape
        out = np.empty((ny_out, nx_out, 2), dtype=np.float32)
        out[:, :, 0] = Uf
        out[:, :, 1] = Vf

        return out.ravel(order="C").tobytes()

    def fetch_tile(self, face_id: int, x_range: Tuple[int,int], y_range: Tuple[int,int], time: Optional[int] = None, quality: int = 1) -> bytes:
        """
        Fetch a rectangular pixel region from a specific face dataset and return interleaved float32 bytes.

        - face_id: which cubed-sphere face (0..5)
        - x_range/y_range: pixel ranges within the face dataset (start,end)
        """
        if time is None:
            time = self.timestep
        else:
            time = int(time)

        # select per-face URLs from config if dataset_url not used
        try:
            from .config import DATA_SOURCES
        except Exception:
            DATA_SOURCES = None

        if DATA_SOURCES and face_id is not None:
            url_u = DATA_SOURCES.get("u")[face_id]
            url_v = DATA_SOURCES.get("v")[face_id]
        elif self.dataset_url is not None:
            url_u = self.dataset_url
            url_v = self.dataset_url
        else:
            url_u = self._url_for_var("u")
            url_v = self._url_for_var("v")

        # Clamp ranges and build logic box
        ds_probe = ov.LoadDataset(url_u)
        nx, ny, nz = ds_probe.getLogicSize()
        x0 = max(0, int(x_range[0]))
        x1 = min(nx, int(x_range[1]))
        y0 = max(0, int(y_range[0]))
        y1 = min(ny, int(y_range[1]))
        logic_box = ([x0, y0, self.level], [x1, y1, self.level + 1])

        max_pixels = max(1, self.max_pixels // max(1, int(quality)))

        U = self._fetch_from_url(url_u, logic_box=logic_box, max_pixels=max_pixels, timestep=time)
        V = self._fetch_from_url(url_v, logic_box=logic_box, max_pixels=max_pixels, timestep=time)

        if U.shape != V.shape:
            raise RuntimeError(f"Shape mismatch U{U.shape} vs V{V.shape}")

        Uf = U.astype(np.float32)
        Vf = V.astype(np.float32)

        ny_out, nx_out = Uf.shape
        out = np.empty((ny_out, nx_out, 2), dtype=np.float32)
        out[:, :, 0] = Uf
        out[:, :, 1] = Vf

        # log simple stats to help diagnose empty/zero tiles
        try:
            u = Uf.ravel()
            v = Vf.ravel()
            logger.info(
                "fetch_tile face=%s x0=%s x1=%s y0=%s y1=%s time=%s stats U(min,max,mean)=(%s,%s,%s) V(min,max,mean)=(%s,%s,%s)",
                face_id,
                x0,
                x1,
                y0,
                y1,
                time,
                float(u.min()),
                float(u.max()),
                float(u.mean()),
                float(v.min()),
                float(v.max()),
                float(v.mean()),
            )
        except Exception:
            logger.exception("Failed to compute fetch_tile stats")

        return out.ravel(order="C").tobytes()

    def get_dimensions(
        self,
        time: Optional[int] = None,
        x_range: Optional[Tuple[int, int]] = None,
        y_range: Optional[Tuple[int, int]] = None,
    ) -> Tuple[int, int, int, str]:
        """Return (width, height, components, dtype) for the requested range.

        If ranges are None, returns the full domain size discovered from the dataset.
        """
        if time is None:
            time = self.timestep
        else:
            time = int(time)

        # use dataset_url when provided
        url_probe = self.dataset_url if self.dataset_url is not None else self._url_for_var("u")
        ds_probe = ov.LoadDataset(url_probe)
        nx, ny, nz = ds_probe.getLogicSize()

        x0, x1 = (0, nx) if x_range is None else (max(0, int(x_range[0])), min(nx, int(x_range[1])))
        y0, y1 = (0, ny) if y_range is None else (max(0, int(y_range[0])), min(ny, int(y_range[1])))

        width = max(0, x1 - x0)
        height = max(0, y1 - y0)
        components = 2
        dtype = "float32"
        return width, height, components, dtype
