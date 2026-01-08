# backend/coords.py
# Simple mapping from global cubed-sphere tile coords to face and local tile indices.

from typing import Tuple
import math

# GEOS Cubed-sphere face arrangement:
# Faces 0-3: Equatorial band (centered at lon = -135, -45, 45, 135)
# Face 4: North polar cap
# Face 5: South polar cap
FACE_CENTER_LON = [-135.0, -45.0, 45.0, 135.0, 0.0, 0.0]  # Face center longitudes


def get_projection_type(face: int) -> str:
    """Return projection type for a face: 'equatorial', 'polar_north', or 'polar_south'."""
    if face < 4:
        return "equatorial"
    elif face == 4:
        return "polar_north"
    else:
        return "polar_south"


def face_pixel_to_lonlat(face: int, px: float, py: float, width: int, height: int) -> Tuple[float, float]:
    """
    Convert a pixel coordinate on a cubed-sphere face to lon/lat using SIMPLE LINEAR MAPPING.
    
    GEOS cubed-sphere faces are arranged as:
    - Face 0-3: Equatorial band, each covering 90° longitude
    - Face 4: North pole (lat 45° to 90°)
    - Face 5: South pole (lat -90° to -45°)
    
    Using simple linear interpolation instead of complex gnomonic projection
    to match GEOS data layout.
    """
    # Normalized coords in face: (s, t) in [0, 1]
    s = (px + 0.5) / width
    t = (py + 0.5) / height
    
    # Normalized coords in face: (s, t) in [0, 1]
    s = (px + 0.5) / width
    t = (py + 0.5) / height
    
    # SIMPLE LINEAR MAPPING for GEOS cubed-sphere layout
    # Based on 3x2 face arrangement where each face has straightforward lat/lon bounds
    
    if face == 0:
        # Face 0: Americas (-180° to -90° lon, -45° to 45° lat)
        lon = -180.0 + s * 90.0
        lat = -45.0 + t * 90.0
    elif face == 1:
        # Face 1: Africa (-90° to 0° lon, -45° to 45° lat)
        lon = -90.0 + s * 90.0
        lat = -45.0 + t * 90.0
    elif face == 2:
        # Face 2: Asia (0° to 90° lon, -45° to 45° lat)
        lon = 0.0 + s * 90.0
        lat = -45.0 + t * 90.0
    elif face == 3:
        # Face 3: Pacific (90° to 180° lon, -45° to 45° lat)
        lon = 90.0 + s * 90.0
        lat = -45.0 + t * 90.0
    elif face == 4:
        # Face 4: North pole - use polar coordinates
        # Convert s,t to radius and angle
        u = (s - 0.5) * 2.0  # -1 to 1
        v = (t - 0.5) * 2.0
        radius = math.sqrt(u*u + v*v)
        # Map radius 0->1 to lat 90°->45°
        lat = 90.0 - radius * 45.0
        # Longitude from angle
        lon = math.degrees(math.atan2(u, -v))
    else:  # face == 5
        # Face 5: South pole
        u = (s - 0.5) * 2.0
        v = (t - 0.5) * 2.0
        radius = math.sqrt(u*u + v*v)
        # Map radius 0->1 to lat -90°->-45°
        lat = -90.0 + radius * 45.0
        # Longitude from angle
        lon = math.degrees(math.atan2(u, v))
    
    return lon, lat


def get_tile_bounds(face: int, width: int, height: int) -> Tuple[float, float, float, float, str]:
    """
    Get the lon/lat bounds for an entire tile (face subset).
    Returns (lon0, lon1, lat0, lat1, projection_type).
    
    For equatorial faces, returns corner coordinates for linear interpolation.
    For polar faces, returns bounding box but projection type indicates special handling needed.
    """
    # Sample corners
    lon00, lat00 = face_pixel_to_lonlat(face, 0, 0, width, height)
    lon10, lat10 = face_pixel_to_lonlat(face, width-1, 0, width, height)
    lon01, lat01 = face_pixel_to_lonlat(face, 0, height-1, width, height)
    lon11, lat11 = face_pixel_to_lonlat(face, width-1, height-1, width, height)
    
    proj = get_projection_type(face)
    
    if proj == "equatorial":
        # For equatorial, use simple bounds from corners
        lon0 = min(lon00, lon01)
        lon1 = max(lon10, lon11)
        lat0 = min(lat00, lat10)
        lat1 = max(lat01, lat11)
        return lon0, lon1, lat0, lat1, proj
    else:
        # For polar, bounds are not rectangular - return approximate bounding box
        lons = [lon00, lon10, lon01, lon11]
        lats = [lat00, lat10, lat01, lat11]
        return min(lons), max(lons), min(lats), max(lats), proj


def global_tile_to_face(z: int, x: int, y: int) -> Tuple[int, int, int, int]:
    """
    Map a global tile coordinate (z, x, y) to (face_id, tiles_per_face, local_tx, local_ty).

    Convention used here:
    - Each face is subdivided into (2**z) x (2**z) tiles.
    - Global tile grid arranges faces in a 3x2 layout: (face_x=0..2, face_y=0..1).
      face_id = face_y * 3 + face_x  (0..5)

    Inputs:
    - z: face zoom level (0 -> one tile per face)
    - x,y: global tile indices where x in [0, 3*2**z) and y in [0, 2*2**z)

    Returns:
    - face_id (0..5), tiles_per_face, local_tx, local_ty (indices within face)
    """
    tiles_per_face = 1 << z
    # compute face grid coordinates
    face_x = x // tiles_per_face
    face_y = y // tiles_per_face
    # clamp
    if face_x < 0: face_x = 0
    if face_x > 2: face_x = 2
    if face_y < 0: face_y = 0
    if face_y > 1: face_y = 1

    face_id = int(face_y * 3 + face_x)
    local_tx = int(x % tiles_per_face)
    local_ty = int(y % tiles_per_face)
    return face_id, tiles_per_face, local_tx, local_ty


def tile_pixel_box(face_width: int, face_height: int, tiles_per_face: int, local_tx: int, local_ty: int) -> Tuple[Tuple[int,int], Tuple[int,int]]:
    """
    Given face dimensions and tile indices, return pixel ranges (x0,x1),(y0,y1) in face-local coordinates.
    """
    # pixel coordinates (0..width)
    x0 = int((local_tx * face_width) / tiles_per_face)
    x1 = int(((local_tx + 1) * face_width) / tiles_per_face)
    y0 = int((local_ty * face_height) / tiles_per_face)
    y1 = int(((local_ty + 1) * face_height) / tiles_per_face)
    return (x0, x1), (y0, y1)
