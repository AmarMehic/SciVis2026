from backend.tiling import get_tile_box
import pytest


def test_zoom0_full():
    W, H = 1000, 500
    (x0, x1), (y0, y1) = get_tile_box((W, H), 0, 0, 0)
    assert x0 == 0 and x1 == W
    assert y0 == 0 and y1 == H


def test_zoom1_tiles_cover_whole_domain():
    W, H = 1000, 500
    boxes = [get_tile_box((W, H), 1, x, y) for y in range(2) for x in range(2)]

    # verify x coverage
    x_mask = [False] * W
    for (x0, x1), _ in boxes:
        for i in range(x0, x1):
            x_mask[i] = True
    assert all(x_mask), "X axis not fully covered by zoom-1 tiles"

    # verify y coverage
    y_mask = [False] * H
    for _, (y0, y1) in boxes:
        for j in range(y0, y1):
            y_mask[j] = True
    assert all(y_mask), "Y axis not fully covered by zoom-1 tiles"


def test_invalid_tile_coords():
    W, H = 256, 256
    with pytest.raises(ValueError):
        get_tile_box((W, H), 2, 4, 0)  # x out of range (tiles=4 for z=2 -> x in 0..3)
