"""H3 spatial fabric: the universal spatial key.

Every observation from every source gets stamped onto an H3 cell.
Also provides geometry utilities used by attribution (bearings, wind alignment).
"""
import math
import h3
import numpy as np

from shared.config import BBOX, H3_RES


def city_cells(res: int = H3_RES) -> list[str]:
    """All H3 cells whose center falls inside the city bbox."""
    poly = h3.LatLngPoly([
        (BBOX["lat_min"], BBOX["lon_min"]),
        (BBOX["lat_min"], BBOX["lon_max"]),
        (BBOX["lat_max"], BBOX["lon_max"]),
        (BBOX["lat_max"], BBOX["lon_min"]),
    ])
    return sorted(h3.polygon_to_cells(poly, res))


def cell_center(cell: str) -> tuple[float, float]:
    """(lat, lon) of a cell center."""
    return h3.cell_to_latlng(cell)


def latlng_to_cell(lat: float, lon: float, res: int = H3_RES) -> str:
    return h3.latlng_to_cell(lat, lon, res)


def neighbors(cell: str, k: int = 1) -> list[str]:
    """Ring-k neighbors (excluding the cell itself)."""
    return [c for c in h3.grid_disk(cell, k) if c != cell]


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def bearing_deg(lat1, lon1, lat2, lon2) -> float:
    """Initial bearing from point 1 to point 2, degrees clockwise from north."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def wind_alignment(src_lat, src_lon, dst_lat, dst_lon, wind_from_deg: float) -> float:
    """How well does the wind blow FROM the source TOWARD the destination?

    wind_from_deg: meteorological convention (direction wind comes FROM).
    Returns cos similarity in [0, 1]: 1 = destination exactly downwind of source.
    Used by both the attribution evidence builder and the wind-weighted forecast
    adjacency.
    """
    wind_to = (wind_from_deg + 180.0) % 360.0          # direction wind blows TOWARD
    src_to_dst = bearing_deg(src_lat, src_lon, dst_lat, dst_lon)
    cos_sim = math.cos(math.radians(wind_to - src_to_dst))
    return max(0.0, cos_sim)


def circular_mean_deg(degrees) -> float:
    """Mean of a set of bearings, on the circle.

    A plain arithmetic mean of 350 and 10 gives 180 — the exact opposite of the
    right answer. Any time we summarise wind direction over a window (chronic
    hotspots average a week of it) this is the only correct way to do it.
    """
    a = np.radians(np.asarray(list(degrees), dtype=float))
    if a.size == 0:
        return float("nan")
    return float(np.degrees(np.arctan2(np.sin(a).mean(), np.cos(a).mean())) % 360.0)


def cell_distance_km(c1: str, c2: str) -> float:
    a, b = cell_center(c1), cell_center(c2)
    return haversine_km(a[0], a[1], b[0], b[1])


if __name__ == "__main__":
    cells = city_cells()
    print(f"{len(cells)} H3 res-{H3_RES} cells cover the bbox")
    c = cells[len(cells) // 2]
    print("sample cell:", c, "center:", cell_center(c), "neighbors:", len(neighbors(c)))
