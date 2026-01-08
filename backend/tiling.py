"""Tiling utilities for mapping globe tiles to dataset logic ranges."""
import math
from typing import Tuple


def get_tile_box(dataset_shape: Tuple[int, int], zoom: int, x: int, y: int) -> Tuple[Tuple[int, int], Tuple[int, int]]:
    """Compute logic-space x/y ranges for a tile.

    dataset_shape: (width, height) in logical coordinates (W, H)
    zoom: zoom level (Z) where Z=0 => 1x1 tile, Z=1 => 2x2, etc.
    x,y: tile coordinates (0 <= x < 2**Z, 0 <= y < 2**Z)

    Returns ((x_min, x_max), (y_min, y_max)) where ranges are integer indices
    suitable for OpenVisus logic_box ([x_min,y_min,level], [x_max,y_max,level+1]).
    The ranges use x_max/y_max as exclusive upper bounds.
    """
    W, H = int(dataset_shape[0]), int(dataset_shape[1])
    tiles = 1 << int(zoom)

    if x < 0 or x >= tiles or y < 0 or y >= tiles:
        raise ValueError(f"Tile coordinates out of range for zoom {zoom}: ({x},{y})")

    # Use float partitioning then floor/ceil to ensure full coverage without gaps
    tile_w = W / tiles
    tile_h = H / tiles

    x_min = int(math.floor(x * tile_w))
    x_max = int(min(W, math.ceil((x + 1) * tile_w)))
    y_min = int(math.floor(y * tile_h))
    y_max = int(min(H, math.ceil((y + 1) * tile_h)))

    return (x_min, x_max), (y_min, y_max)
