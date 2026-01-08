from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from backend.data import MultiFaceDataManager
from backend.tiling import get_tile_box
from backend.coords import global_tile_to_face, tile_pixel_box
from backend import config
from backend.buffer import BufferManager
import functools
import asyncio
import logging
import sys
import os
import math
import numpy as _np



app = FastAPI(title="SciVis2026 Backend")

# Configure root logging to stdout so `print` and app logs are visible
logging.basicConfig(stream=sys.stdout, level=logging.DEBUG, format="%(asctime)s %(levelname)s:%(name)s:%(message)s")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Width", "X-Height", "X-Components", "X-Dtype"],
)

# Global data manager (per-face) - created on startup to avoid blocking imports
manager: Optional[MultiFaceDataManager] = None
# LRU cache for tile/chunk fetches: keys are (time,x0,x1,y0,y1,quality)
@functools.lru_cache(maxsize=256)
def _cached_fetch(time: int, x0: int, x1: int, y0: int, y1: int, quality: int) -> bytes:
    return manager.fetch_chunk(time=time, x_range=(x0, x1), y_range=(y0, y1), quality=quality)

# Global buffer manager (started on app startup)
buffer_manager: Optional[BufferManager] = None
# Track whether BufferManager has been started
_buffer_started = False


@app.on_event("startup")
async def _startup_buffer():
    global buffer_manager, manager, _buffer_started
    logger = logging.getLogger("backend.server")
    
    # STEP 1: Create data manager
    try:
        manager = MultiFaceDataManager()
    except Exception:
        logger.exception("Failed to initialize MultiFaceDataManager on startup")
        return
    
    # Check if preload/prefetch should be skipped via env var
    skip_prefetch = os.getenv("SCIVIS_SKIP_PREFETCH", "0").lower() in ("1", "true", "yes")
    if skip_prefetch:
        logger.info("SCIVIS_SKIP_PREFETCH enabled — skipping preload on startup")
        # Still create BufferManager but don't start it
        buffer_manager = BufferManager(data_manager=manager)
        buffer_manager.TARGET_BUFFER_SIZE = 3  # 3-second lookahead when activated
        return
    
    # STEP 2: Preload timesteps 0-15 in PARALLEL (not via BufferManager)
    # This populates snapshot_cache so tile requests are instant
    try:
        loop = asyncio.get_running_loop()
        preload_count = int(os.getenv("SCIVIS_PRELOAD_COUNT", "15"))
        logger.info("Starting parallel preload of timesteps 0-%d...", preload_count)
        
        # Create parallel tasks for all timesteps
        tasks = []
        for t in range(preload_count + 1):  # 0-15 inclusive
            task = loop.run_in_executor(None, manager.preload_global_snapshot, t)
            tasks.append((t, task))
        
        # Wait for all preloads to complete
        for t, task in tasks:
            try:
                await task
                cached_faces = len(manager.snapshot_cache.get(t, {}))
                logger.info("Preloaded timestep %d - %d faces cached", t, cached_faces)
            except Exception:
                logger.exception("Failed to preload timestep %d", t)
        
        total_cached = sum(len(manager.snapshot_cache.get(t, {})) for t in range(preload_count + 1))
        logger.info("Parallel preload complete - %d total face snapshots cached", total_cached)
    except Exception:
        logger.exception("Failed during parallel preload")
    
    # STEP 3: Create BufferManager but DON'T start it yet
    # It will be activated when user presses play via /stream/control
    buffer_manager = BufferManager(data_manager=manager)
    
    # Set target buffer size to 3 seconds (configurable via env var)
    try:
        tb = os.getenv("SCIVIS_TARGET_BUFFER_SIZE", "3")
        buffer_manager.TARGET_BUFFER_SIZE = int(tb)
        logger.info("BufferManager TARGET_BUFFER_SIZE set to %s (will activate on play)", tb)
    except Exception:
        logger.exception("Invalid SCIVIS_TARGET_BUFFER_SIZE")
    
    logger.info("Server startup complete - BufferManager ready but not started (activate via /stream/control play)")


@app.on_event("shutdown")
async def _shutdown_buffer():
    global buffer_manager
    if buffer_manager is not None:
        await buffer_manager.stop()


@app.get("/chunk")
def get_chunk(
    time: Optional[int] = Query(None),
    x0: Optional[int] = Query(None),
    x1: Optional[int] = Query(None),
    y0: Optional[int] = Query(None),
    y1: Optional[int] = Query(None),
    quality: int = Query(1, ge=1),
):
    """Return interleaved U/V bytes for requested rectangle.

    If x0/x1 or y0/y1 are omitted, the full domain will be requested.
    The response body is raw float32 bytes in U,V interleaved order.
    """
    x_range = None
    y_range = None
    if x0 is not None or x1 is not None:
        if x0 is None or x1 is None:
            raise HTTPException(status_code=400, detail="Both x0 and x1 must be provided")
        x_range = (x0, x1)
    if y0 is not None or y1 is not None:
        if y0 is None or y1 is None:
            raise HTTPException(status_code=400, detail="Both y0 and y1 must be provided")
        y_range = (y0, y1)

    try:
        # determine dimensions for headers
        width, height, components, dtype = manager.get_dimensions(time=time, x_range=x_range, y_range=y_range)
        data_bytes = manager.fetch_chunk(time=time, x_range=x_range, y_range=y_range, quality=quality)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # adjust reported width/height if actual payload doesn't match expected size
    byte_len = len(data_bytes)
    float_count = byte_len // 4
    expected_floats = int(width) * int(height) * int(components)
    if expected_floats != float_count and int(width) > 0 and int(components) > 0:
        pixels = float_count // int(components)
        # try to keep width and adjust height if divisible
        if pixels % int(width) == 0:
            height = pixels // int(width)
        elif pixels % int(height) == 0:
            width = pixels // int(height)
        else:
            # fallback: compute nearest integer height
            height = math.ceil(pixels / max(1, int(width)))

    headers = {
        "X-Width": str(int(width)),
        "X-Height": str(int(height)),
        "X-Components": str(int(components)),
        "X-Dtype": dtype,
    }

    # If server returned only a single component (float_count == width*height), expand to two components
    if float_count == int(width) * int(height) and int(components) == 2:
        try:
            arr = _np.frombuffer(data_bytes, dtype=_np.float32).astype(_np.float32)
            out = _np.empty(arr.size * 2, dtype=_np.float32)
            out[0::2] = arr
            out[1::2] = 0.0
            data_bytes = out.tobytes()
            byte_len = len(data_bytes)
            float_count = byte_len // 4
            logging.getLogger("backend.server").warning("Expanded single-component tile to two components: bytes=%s floats=%s", byte_len, float_count)
        except Exception:
            logging.getLogger("backend.server").exception("Failed to expand single-component payload")

    return Response(content=data_bytes, media_type="application/octet-stream", headers=headers)



@app.get("/tile/{timestep}/{z}/{x}/{y}")
def get_tile(
    timestep: float,
    z: int,
    x: int,
    y: int,
    quality: int = Query(1, ge=1),
):
    """Return tile at zoom `z` and tile coords (x,y) for given timestep as interleaved U/V bytes.

    Uses `get_tile_box` to compute the requested ranges and an in-memory LRU cache to avoid
    repeated OpenVisus queries for the same tile.
    """
    try:
        z_i = int(z) # input validation
        if z_i < 0 or z_i > 30:
            raise HTTPException(status_code=400, detail=f"Invalid zoom {z}")

        timestep_i = int(round(float(timestep)))

        if timestep_i < 0:
            raise HTTPException(status_code=400, detail=f"Invalid timestep {timestep_i}")

        # Map global tile to cubed-sphere face and face-local tile indices
        face_id, tiles_per_face, local_tx, local_ty = global_tile_to_face(z_i, x, y)

        # Probe face dataset to get face dimensions. Prefer DATA_SOURCES if available.
        try:
            if hasattr(config, "DATA_SOURCES") and config.DATA_SOURCES.get("u"):
                url_probe = config.DATA_SOURCES.get("u")[face_id]
            else:
                url_probe = config.DATASET_CONFIG["get_url"]("u", face_id)
            ds = __import__("openvisuspy").LoadDataset(url_probe)
            face_W, face_H, _ = ds.getLogicSize()
        except Exception:
            raise HTTPException(status_code=500, detail="Failed to probe face dataset for tile mapping")

        # compute face-local pixel box for this tile (for headers)
        (lx0, lx1), (ly0, ly1) = tile_pixel_box(face_W, face_H, tiles_per_face, local_tx, local_ty)

        # Use a small LRU cache per global tile to avoid repeated fetches
        @functools.lru_cache(maxsize=512)
        def _cached_fetch_tile(time_i: int, face_i: int, z_i: int, tx_i: int, ty_i: int, q_i: int) -> bytes:
            return manager.fetch_tile(face=face_i, z=z_i, local_tx=tx_i, local_ty=ty_i, time=time_i, quality=q_i)

        data_bytes = _cached_fetch_tile(timestep_i, face_id, z_i, local_tx, local_ty, int(quality))

        # compute headers
        width = max(0, lx1 - lx0)
        height = max(0, ly1 - ly0)
        headers = {
            "X-Width": str(width),
            "X-Height": str(height),
            "X-Components": "2",
            "X-Dtype": "float32",
        }

        return Response(content=data_bytes, media_type="application/octet-stream", headers=headers)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logging.getLogger("backend.server").exception("Error in /tile: %s", e)
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/tiles/{face}/{z}/{x}/{y}")
def get_tile_face(
    face: int,
    z: int,
    x: int,
    y: int,
    time: int = Query(0, ge=0),
    quality: int = Query(1, ge=1),
):
    """Return a face-local tile directly: face in 0..5, local tile coords x,y at zoom z."""
    try:
        face_i = int(face)
        if face_i < 0 or face_i >= config.DATASET_CONFIG["faces"]:
            raise HTTPException(status_code=400, detail=f"Invalid face {face}")
        z_i = int(z)
        if z_i < 0 or z_i > 30:
            raise HTTPException(status_code=400, detail=f"Invalid zoom {z}")

        tx = int(x)
        ty = int(y)

        # validate local tile indices
        tiles_per_face = 1 << z_i
        if tx < 0 or tx >= tiles_per_face or ty < 0 or ty >= tiles_per_face:
            raise HTTPException(status_code=400, detail=f"Tile coords out of range for zoom {z}")

        data_bytes = manager.fetch_tile(face=face_i, z=z_i, local_tx=tx, local_ty=ty, time=int(time), quality=int(quality))

        width, height = manager.get_tile_dimensions(face=face_i, z=z_i, local_tx=tx, local_ty=ty)
        # adjust to actual payload
        byte_len = len(data_bytes)
        float_count = byte_len // 4
        components = 2
        expected_floats = int(width) * int(height) * components
        if expected_floats != float_count and int(width) > 0:
            pixels = float_count // components
            if pixels % int(width) == 0:
                height = pixels // int(width)
            elif pixels % int(height) == 0:
                width = pixels // int(height)
            else:
                height = math.ceil(pixels / max(1, int(width)))

        headers = {
            "X-Width": str(int(width)),
            "X-Height": str(int(height)),
            "X-Components": str(components),
            "X-Dtype": "float32",
        }

        # If only one component present, expand to two components (V zeros)
        if float_count == int(width) * int(height):
            try:
                arr = _np.frombuffer(data_bytes, dtype=_np.float32).astype(_np.float32)
                out = _np.empty(arr.size * 2, dtype=_np.float32)
                out[0::2] = arr
                out[1::2] = 0.0
                data_bytes = out.tobytes()
                logging.getLogger("backend.server").warning("Expanded single-component face tile to two components: new_bytes=%s", len(data_bytes))
            except Exception:
                logging.getLogger("backend.server").exception("Failed to expand single-component face tile")

        return Response(content=data_bytes, media_type="application/octet-stream", headers=headers)
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger("backend.server").exception("Error in /tiles/: %s", e)
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/chunk/meta", response_class=JSONResponse)
def chunk_meta(
    time: Optional[int] = Query(None),
    x0: Optional[int] = Query(None),
    x1: Optional[int] = Query(None),
    y0: Optional[int] = Query(None),
    y1: Optional[int] = Query(None),
):
    """Return shape/dtype metadata for a requested chunk. This endpoint appears in OpenAPI docs."""
    x_range = None
    y_range = None
    if x0 is not None or x1 is not None:
        if x0 is None or x1 is None:
            raise HTTPException(status_code=400, detail="Both x0 and x1 must be provided")
        x_range = (x0, x1)
    if y0 is not None or y1 is not None:
        if y0 is None or y1 is None:
            raise HTTPException(status_code=400, detail="Both y0 and y1 must be provided")
        y_range = (y0, y1)

    try:
        width, height, components, dtype = manager.get_dimensions(time=time, x_range=x_range, y_range=y_range)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return JSONResponse(content={"width": width, "height": height, "components": components, "dtype": dtype})


@app.get("/tile/meta", response_class=JSONResponse)
def tile_meta(
    timestep: float,
    z: int,
    x: int,
    y: int,
):
    """Return metadata for a specific tile: width/height/components/dtype."""
    try:
        # sanitize inputs
        z_i = int(z)
        if z_i < 0 or z_i > 30:
            raise HTTPException(status_code=400, detail=f"Invalid zoom {z}")
        # map global tile to face and local tile indices then ask manager
        face_id, tiles_per_face, local_tx, local_ty = global_tile_to_face(z_i, x, y)
        width, height = manager.get_tile_dimensions(face=face_id, z=z_i, local_tx=local_tx, local_ty=local_ty)
        return JSONResponse(content={"width": width, "height": height, "components": 2, "dtype": "float32"})
    except Exception as e:
        logging.getLogger("backend.server").exception("Error in /tile/meta: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/debug/sample", response_class=JSONResponse)
def debug_sample(
    time: Optional[int] = Query(None),
    x0: Optional[int] = Query(None),
    x1: Optional[int] = Query(None),
    y0: Optional[int] = Query(None),
    y1: Optional[int] = Query(None),
    quality: int = Query(1, ge=1),
    count: int = Query(20, ge=1, le=1000),
    save: int = Query(0, ge=0, le=1),
):
    """Return a small JSON sample of the decoded U/V values for inspection.

    Useful to quickly verify the byte layout and contents returned by `fetch_chunk`.
    """
    try:
        width, height, components, dtype = manager.get_dimensions(time=time, x_range=(x0, x1) if x0 is not None and x1 is not None else None, y_range=(y0, y1) if y0 is not None and y1 is not None else None)
        data_bytes = manager.fetch_chunk(time=time, x_range=(x0, x1) if x0 is not None and x1 is not None else None, y_range=(y0, y1) if y0 is not None and y1 is not None else None, quality=quality)
        import numpy as _np

        arr = _np.frombuffer(data_bytes, dtype=_np.float32)
        expected = width * height * components
        info = {"width": width, "height": height, "components": components, "dtype": dtype, "bytes": len(data_bytes), "expected_elements": expected}

        if expected == 0:
            return JSONResponse(content={"info": info, "sample": []})

        if arr.size < 2:
            return JSONResponse(content={"info": info, "sample": []})

        # Try to reshape into (height, width, components). If it fails, include flat preview.
        sample = []
        try:
            arr3 = arr.reshape((height, width, components))
            flat = arr3.reshape((-1, components))
            n = min(count, flat.shape[0])
            for i in range(n):
                sample.append([float(flat[i, 0]), float(flat[i, 1])])
            info["shape_ok"] = True
            # compute simple statistics for U and V to help diagnose zero-valued data
            try:
                u = flat[:, 0]
                v = flat[:, 1]
                info["u_stats"] = {
                    "min": float(u.min()),
                    "max": float(u.max()),
                    "mean": float(u.mean()),
                    "std": float(u.std()),
                    "nonzero": int((u != 0).sum()),
                }
                info["v_stats"] = {
                    "min": float(v.min()),
                    "max": float(v.max()),
                    "mean": float(v.mean()),
                    "std": float(v.std()),
                    "nonzero": int((v != 0).sum()),
                }
            except Exception:
                info["u_stats"] = info["v_stats"] = None
        except Exception:
            # fallback: show first N pairs from flat buffer
            info["shape_ok"] = False
            pairs = arr.reshape((-1,))
            n = min(count * components, pairs.size)
            preview = pairs[:n].tolist()
            # group into pairs
            sample = []
            for i in range(0, len(preview) - 1, 2):
                sample.append([float(preview[i]), float(preview[i + 1])])
            # stats from available preview (best-effort)
            try:
                u = pairs[0::2]
                v = pairs[1::2]
                import numpy as _np

                u_arr = _np.asarray(u, dtype=_np.float32)
                v_arr = _np.asarray(v, dtype=_np.float32)
                info["u_stats"] = {
                    "min": float(u_arr.min()) if u_arr.size else None,
                    "max": float(u_arr.max()) if u_arr.size else None,
                    "mean": float(u_arr.mean()) if u_arr.size else None,
                    "std": float(u_arr.std()) if u_arr.size else None,
                    "nonzero": int((u_arr != 0).sum()) if u_arr.size else 0,
                }
                info["v_stats"] = {
                    "min": float(v_arr.min()) if v_arr.size else None,
                    "max": float(v_arr.max()) if v_arr.size else None,
                    "mean": float(v_arr.mean()) if v_arr.size else None,
                    "std": float(v_arr.std()) if v_arr.size else None,
                    "nonzero": int((v_arr != 0).sum()) if v_arr.size else 0,
                }
            except Exception:
                info["u_stats"] = info["v_stats"] = None

        result = {"info": info, "sample": sample}
        # optionally save to disk for easier inspection
        if bool(save):
            try:
                import os, json
                out_dir = os.path.join(os.path.dirname(__file__), "debug_samples")
                os.makedirs(out_dir, exist_ok=True)
                fn = f"sample_t{int(time) if time is not None else 'none'}_x{int(x0) if x0 is not None else 'all'}_y{int(y0) if y0 is not None else 'all'}.json"
                path = os.path.join(out_dir, fn)
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(result, f, indent=2)
                result["saved_path"] = path
            except Exception:
                logging.getLogger("backend.server").exception("Failed to save debug sample to disk")

        return JSONResponse(content=result)
    except Exception as e:
        logging.getLogger("backend.server").exception("Error in /debug/sample: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/stream/control")
async def stream_control(payload: dict):
    """Control the prefetch buffer. JSON {"action": "play", "currentTime": 100}

    Supported actions:
    - play: set currentTime and start prefetching future frames (activates BufferManager on first call)
    - pause: stop advancing buffer (we still keep cache)
    """
    global buffer_manager, _buffer_started
    if buffer_manager is None:
        raise HTTPException(status_code=500, detail="Buffer manager not initialized")

    logger = logging.getLogger("backend.server")
    logger.info("stream_control received: %s", payload)
    
    action = payload.get("action")
    if action not in ("play", "pause"):
        raise HTTPException(status_code=400, detail="Unknown action")

    if action == "play":
        if "currentTime" not in payload:
            raise HTTPException(status_code=400, detail="currentTime required for play action")
        try:
            t = int(payload["currentTime"])
        except Exception:
            raise HTTPException(status_code=400, detail="currentTime must be an integer")
        
        # Start BufferManager on first play (if not already started)
        if not _buffer_started:
            buffer_manager.start()
            _buffer_started = True
            logger.info("BufferManager started (first play action)")
        
        buffer_manager.set_current_time(t)
        return JSONResponse(content={"status": "playing", "currentTime": t, "bufferActive": _buffer_started})

    # pause: don't change buffer, just report paused
    return JSONResponse(content={"status": "paused", "bufferActive": _buffer_started})


@app.get("/debug/tile_info", response_class=JSONResponse)
def debug_tile_info(
    face: int = Query(0, ge=0),
    z: int = Query(0, ge=0),
    x: int = Query(0, ge=0),
    y: int = Query(0, ge=0),
    time: int = Query(0, ge=0),
):
    """Return quick metadata about a face-local tile and the actual payload size/float count."""
    try:
        if manager is None:
            raise HTTPException(status_code=503, detail="Data manager not initialized")

        # validate face
        if face < 0 or face >= config.DATASET_CONFIG["faces"]:
            raise HTTPException(status_code=400, detail=f"Invalid face {face}")

        width, height = manager.get_tile_dimensions(face=face, z=z, local_tx=int(x), local_ty=int(y))
        data_bytes = manager.fetch_tile(face=face, z=z, local_tx=int(x), local_ty=int(y), time=int(time))
        byte_len = len(data_bytes)
        float_count = byte_len // 4
        resp = {
            "face": face,
            "z": z,
            "x": x,
            "y": y,
            "time": time,
            "width": width,
            "height": height,
            "components": 2,
            "dtype": "float32",
            "bytes": byte_len,
            "float_count": float_count,
            "expected_floats": int(width) * int(height) * 2,
        }
        logging.getLogger("backend.server").info("debug_tile_info: %s", resp)
        return JSONResponse(content=resp)
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger("backend.server").exception("Error in /debug/tile_info: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/debug/tile_preview", response_class=JSONResponse)
def debug_tile_preview(
    face: int = Query(0, ge=0),
    z: int = Query(0, ge=0),
    x: int = Query(0, ge=0),
    y: int = Query(0, ge=0),
    time: int = Query(0, ge=0),
    count: int = Query(20, ge=1, le=200),
):
    """Return first `count` floats from a face-local tile (for quick inspection)."""
    try:
        if manager is None:
            raise HTTPException(status_code=503, detail="Data manager not initialized")
        width, height = manager.get_tile_dimensions(face=face, z=z, local_tx=int(x), local_ty=int(y))
        data_bytes = manager.fetch_tile(face=face, z=z, local_tx=int(x), local_ty=int(y), time=int(time))
        import struct

        float_count = len(data_bytes) // 4
        # unpack up to `count` floats
        n = min(count, float_count)
        fmt = f"<{n}f"
        vals = list(struct.unpack(fmt, data_bytes[: n * 4]))
        # simple checksum of all floats (sum) to help detect missing component
        import numpy as _np

        all_floats = _np.frombuffer(data_bytes, dtype=_np.float32)
        resp = {
            "face": face,
            "z": z,
            "x": x,
            "y": y,
            "time": time,
            "width": width,
            "height": height,
            "bytes": len(data_bytes),
            "float_count": int(float_count),
            "preview_count": len(vals),
            "preview": [float(v) for v in vals],
            "sum": float(all_floats.sum()),
        }
        logging.getLogger("backend.server").info("debug_tile_preview: face=%s z=%s bytes=%s floats=%s sum=%s", face, z, len(data_bytes), float_count, resp["sum"])
        return JSONResponse(content=resp)
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger("backend.server").exception("Error in /debug/tile_preview: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
