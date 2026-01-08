import logging
from typing import Dict, Tuple, Optional, Any
import os
import pickle

import numpy as np
import openvisuspy as ov

from . import config
from .coords import tile_pixel_box

logger = logging.getLogger(__name__)


class MultiFaceDataManager:
    """Manage per-face GEOS datasets (U/V/W) and provide tile fetches.

    Mirrors the logic in `data/scripts/fetch_geos_faces.py` but serves
    tiles on demand. Thank you DINO <3
    """

    def __init__(self, level: int = 0, max_pixels: int = 1_500_000, window: int = 20_000):
        self.level = int(level)
        self.max_pixels = int(max_pixels)
        self.window = int(window)

        # datasets[face][var] -> openvisuspy dataset (typed as Any to avoid binding to module internals)
        self.datasets: Dict[int, Dict[str, Any]] = {}
        # field names stored per face/var
        self.fields: Dict[int, Dict[str, str]] = {}
        
        # Disk cache directory for all tiles
        self.tiles_cache_dir = os.path.join(os.path.dirname(__file__), ".." , ".cache", "tiles")
        os.makedirs(self.tiles_cache_dir, exist_ok=True)
        
        self._load_all_faces()

    def _load_all_faces(self):
        for face in range(config.DATASET_CONFIG["faces"]):
            self.datasets[face] = {}
            self.fields[face] = {}
            for var in ("u", "v"):
                url = config.DATASET_CONFIG["get_url"](var, face)
                try:
                    ds = ov.LoadDataset(url)
                    self.datasets[face][var] = ds
                    try:
                        self.fields[face][var] = ds.getField().name
                    except Exception:
                        self.fields[face][var] = None
                    logger.info("Loaded face %d var %s url=%s size=%s", face, var, url, ds.getLogicSize())
                except Exception as e:
                    logger.exception("Failed to load dataset for face %s var %s url=%s: %s", face, var, url, e)

    def get_face_size(self, face: int) -> Tuple[int, int]:
        ds = self.datasets[face]["u"]
        nx, ny, nz = ds.getLogicSize()
        return nx, ny

    def _fetch_from_ds(self, ds: Any, field_name: Optional[str], logic_box: Tuple[Tuple[int, int, int], Tuple[int, int, int]], timestep: int, max_pixels: Optional[int] = None) -> np.ndarray:
        if field_name is None:
            try:
                field_name = ds.getField().name
            except Exception:
                field_name = None

        # Use provided max_pixels or fall back to instance default
        px_limit = max_pixels if max_pixels is not None else self.max_pixels
        
        query = ds.createBoxQuery(timestep=int(timestep), field=field_name, logic_box=logic_box, full_dim=True, max_pixels=int(px_limit))
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

    def _get_tile_cache_path(self, face: int, z: int, x: int, y: int, time: int) -> str:
        """Get path to disk cache file for a specific tile."""
        return os.path.join(self.tiles_cache_dir, f"f{face}_z{z}_x{x}_y{y}_t{time:05d}.bin")
    
    def _load_tile_from_cache(self, face: int, z: int, x: int, y: int, time: int) -> Optional[bytes]:
        """Load cached tile from disk if available."""
        cache_path = self._get_tile_cache_path(face, z, x, y, time)
        if os.path.exists(cache_path):
            try:
                with open(cache_path, "rb") as f:
                    data = f.read()
                logger.debug("Loaded tile f%d z%d (%d,%d) t%d from cache (%d bytes)", face, z, x, y, time, len(data))
                return data
            except Exception:
                logger.exception("Failed to load tile cache for f%d z%d (%d,%d) t%d", face, z, x, y, time)
        return None
    
    def _save_tile_to_cache(self, face: int, z: int, x: int, y: int, time: int, data: bytes):
        """Save tile to disk cache."""
        cache_path = self._get_tile_cache_path(face, z, x, y, time)
        try:
            with open(cache_path, "wb") as f:
                f.write(data)
            logger.debug("Saved tile f%d z%d (%d,%d) t%d to cache (%d bytes)", face, z, x, y, time, len(data))
        except Exception:
            logger.exception("Failed to save tile cache for f%d z%d (%d,%d) t%d", face, z, x, y, time)

    def fetch_tile(self, face: int, z: int, local_tx: int, local_ty: int, time: int = 0, quality: int = 1) -> bytes:
        """Fetch a tile for a single face.

        - face: 0..5
        - z: zoom level (tiles per face = 2**z)
        - local_tx/local_ty: tile indices within the face
        - time: timestep
        
        Tiles are cached to disk - first request fetches from remote, subsequent requests are instant.
        """
        # Check disk cache first
        cached_data = self._load_tile_from_cache(face, z, local_tx, local_ty, time)
        if cached_data is not None:
            return cached_data
        
        tiles_per_face = 1 << int(z)
        nx, ny = self.get_face_size(face)

        # compute face-local pixel bounds
        (x0, x1), (y0, y1) = tile_pixel_box(nx, ny, tiles_per_face, local_tx, local_ty)

        logic_box = ([int(x0), int(y0), int(self.level)], [int(x1), int(y1), int(self.level + 1)])

        # Calculate zoom-appropriate max_pixels to avoid excessive subdivision
        # At z=0: 1 tile per face -> request ~100K pixels (316x316)
        # At z=1: 4 tiles per face -> request ~200K pixels (447x447)
        # At z=2+: use full resolution up to 1.5M pixels
        if z <= 1:
            max_px = 100_000 * (2 ** z)  # z=0: 100K, z=1: 200K
        else:
            max_px = self.max_pixels  # z>=2: use default 1.5M
        
        logger.debug("fetch_tile z=%d using max_pixels=%d", z, max_px)

        ds_u = self.datasets[face].get("u")
        ds_v = self.datasets[face].get("v")
        if ds_u is None or ds_v is None:
            raise RuntimeError("Missing dataset for face %s" % face)

        field_u = self.fields[face].get("u")
        field_v = self.fields[face].get("v")

        # fetch arrays (sequentially to avoid overwhelming server)
        U = self._fetch_from_ds(ds_u, field_u, logic_box, time, max_pixels=max_px)
        V = self._fetch_from_ds(ds_v, field_v, logic_box, time, max_pixels=max_px)

        if U.shape != V.shape:
            raise RuntimeError(f"Shape mismatch U{U.shape} vs V{V.shape}")

        Uf = U.astype(np.float32)
        Vf = V.astype(np.float32)

        ny_out, nx_out = Uf.shape
        out = np.empty((ny_out, nx_out, 2), dtype=np.float32)
        out[:, :, 0] = Uf
        out[:, :, 1] = Vf
        # log basic stats and return info to help debug component counts
        try:
            u_min, u_max, u_mean = float(Uf.min()), float(Uf.max()), float(Uf.mean())
            v_min, v_max, v_mean = float(Vf.min()), float(Vf.max()), float(Vf.mean())
            out_bytes = out.ravel(order="C").tobytes()
            logger.info(
                "fetch_tile face=%s z=%s tile=(%s,%s) x0=%s x1=%s y0=%s y1=%s time=%s U(min,max,mean)=(%s,%s,%s) V(min,max,mean)=(%s,%s,%s) out.shape=%s out.bytes=%s",
                face,
                z,
                local_tx,
                local_ty,
                x0,
                x1,
                y0,
                y1,
                time,
                u_min,
                u_max,
                u_mean,
                v_min,
                v_max,
                v_mean,
                out.shape,
                len(out_bytes),
            )
            # Save to disk cache
            self._save_tile_to_cache(face, z, local_tx, local_ty, time, out_bytes)
            return out_bytes
        except Exception:
            logger.exception("Failed to compute stats for fetched tile")
            out_bytes = out.ravel(order="C").tobytes()
            # Still save to cache even if stats failed
            self._save_tile_to_cache(face, z, local_tx, local_ty, time, out_bytes)
            return out_bytes

    def get_tile_dimensions(self, face: int, z: int, local_tx: int, local_ty: int) -> Tuple[int, int]:
        tiles_per_face = 1 << int(z)
        nx, ny = self.get_face_size(face)
        (x0, x1), (y0, y1) = tile_pixel_box(nx, ny, tiles_per_face, local_tx, local_ty)
        width = max(0, int(x1 - x0))
        height = max(0, int(y1 - y0))
        return width, height

    # Compatibility helpers used by older endpoints (/chunk)
    def fetch_chunk(self, time: Optional[int] = None, x_range: Optional[Tuple[int, int]] = None, y_range: Optional[Tuple[int, int]] = None, quality: int = 1) -> bytes:
        """Fetch a rectangular chunk. For compatibility, uses face 0 by default.

        x_range/y_range are face-local pixel ranges. If omitted, returns the full face 0.
        """
        if time is None:
            time = 0
        else:
            time = int(time)

        face = 0
        nx, ny = self.get_face_size(face)

        x0, x1 = (0, nx) if x_range is None else (max(0, int(x_range[0])), min(nx, int(x_range[1])))
        y0, y1 = (0, ny) if y_range is None else (max(0, int(y_range[0])), min(ny, int(y_range[1])))

        logic_box = ([x0, y0, self.level], [x1, y1, self.level + 1])

        ds_u = self.datasets[face].get("u")
        ds_v = self.datasets[face].get("v")
        U = self._fetch_from_ds(ds_u, self.fields[face].get("u"), logic_box, time)
        V = self._fetch_from_ds(ds_v, self.fields[face].get("v"), logic_box, time)
        Uf = U.astype(np.float32)
        Vf = V.astype(np.float32)
        ny_out, nx_out = Uf.shape
        out = np.empty((ny_out, nx_out, 2), dtype=np.float32)
        out[:, :, 0] = Uf
        out[:, :, 1] = Vf
        return out.ravel(order="C").tobytes()

    def get_dimensions(self, time: Optional[int] = None, x_range: Optional[Tuple[int, int]] = None, y_range: Optional[Tuple[int, int]] = None):
        # Report face-0 dimensions for compatibility
        face = 0
        nx, ny = self.get_face_size(face)
        x0, x1 = (0, nx) if x_range is None else (max(0, int(x_range[0])), min(nx, int(x_range[1])))
        y0, y1 = (0, ny) if y_range is None else (max(0, int(y_range[0])), min(ny, int(y_range[1])))
        width = max(0, x1 - x0)
        height = max(0, y1 - y0)
        components = 2
        dtype = "float32"
        return width, height, components, dtype
