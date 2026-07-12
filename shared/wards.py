"""Ward layer — the administrative unit.

The cell is the analytical unit (models, attribution); the ward is what a memo
is addressed to, what an advisory is broadcast to, and what the equity layer
debiases across. Every data contract downstream of detection carries a ward.

Two modes, same schema:
  * REAL     — point-in-polygon against the official ward GeoJSON at
               config.WARD_GEOJSON (BBMP for Bengaluru).
  * FALLBACK — a deterministic Voronoi tessellation of the H3 fabric around
               N_FALLBACK_WARDS seed cells. Not a legal boundary, and labelled
               as such (`synthetic=True`), but it gives the pipeline a stable
               administrative key before the GeoJSON is dropped in.

Point-in-polygon is hand-rolled ray casting: ~2,000 cells against a few hundred
polygons is milliseconds, and it keeps geopandas/shapely out of requirements.
"""
import json
from functools import lru_cache

import numpy as np
import pandas as pd

from shared.config import WARD_GEOJSON, N_FALLBACK_WARDS, H3_RES
from shared.grid import city_cells, cell_center

WARD_UNASSIGNED = "unassigned"


# ------------------------------------------------------- point in polygon
def _point_in_ring(lon: float, lat: float, ring: list) -> bool:
    """Ray casting against one linear ring of [lon, lat] pairs."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            x_cross = xi + (lat - yi) * (xj - xi) / (yj - yi)
            if lon < x_cross:
                inside = not inside
        j = i
    return inside


def _point_in_polygon(lon: float, lat: float, polygon: list) -> bool:
    """GeoJSON Polygon coordinates: [outer_ring, hole, hole, ...]."""
    if not polygon or not _point_in_ring(lon, lat, polygon[0]):
        return False
    return not any(_point_in_ring(lon, lat, hole) for hole in polygon[1:])


def _feature_polygons(geom: dict) -> list:
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return list(geom["coordinates"])
    return []


def _ring_bbox(polys: list) -> tuple[float, float, float, float]:
    pts = np.array([p for poly in polys for p in poly[0]], dtype=float)
    return pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()


def _ward_name(props: dict, idx: int) -> str:
    for k in ("KGISWardName", "ward_name", "WARD_NAME", "name", "Name", "ward"):
        if props.get(k):
            return str(props[k])
    return f"Ward {idx + 1:03d}"


# ------------------------------------------------------------------ modes
def _wards_from_geojson(cells: list[str]) -> pd.DataFrame:
    gj = json.loads(WARD_GEOJSON.read_text(encoding="utf-8"))
    feats = []
    for i, f in enumerate(gj["features"]):
        polys = _feature_polygons(f.get("geometry") or {})
        if not polys:
            continue
        feats.append({"ward_id": f"W{i + 1:03d}",
                      "ward_name": _ward_name(f.get("properties") or {}, i),
                      "polys": polys, "bbox": _ring_bbox(polys)})

    rows = []
    for c in cells:
        lat, lon = cell_center(c)
        hit = None
        for f in feats:
            x0, y0, x1, y1 = f["bbox"]
            if not (x0 <= lon <= x1 and y0 <= lat <= y1):
                continue                      # bbox prefilter: skips ~99% of tests
            if any(_point_in_polygon(lon, lat, p) for p in f["polys"]):
                hit = f
                break
        rows.append({"cell": c,
                     "ward_id": hit["ward_id"] if hit else WARD_UNASSIGNED,
                     "ward_name": hit["ward_name"] if hit else "Outside city limits"})
    return pd.DataFrame(rows)


def _wards_voronoi(cells: list[str]) -> pd.DataFrame:
    """Deterministic Voronoi wards: nearest seed cell wins. Seeded, so the ward
    of a given cell never changes between runs — memos must be reproducible."""
    rng = np.random.default_rng(1729)
    n = min(N_FALLBACK_WARDS, len(cells))
    seeds = sorted(rng.choice(cells, size=n, replace=False).tolist())
    seed_pts = np.array([cell_center(s) for s in seeds])           # (n, 2) lat/lon

    pts = np.array([cell_center(c) for c in cells])                # (m, 2)
    # Equirectangular approximation is exact enough for nearest-seed at city scale.
    lat0 = np.radians(pts[:, 0].mean())
    dy = pts[:, None, 0] - seed_pts[None, :, 0]
    dx = (pts[:, None, 1] - seed_pts[None, :, 1]) * np.cos(lat0)
    nearest = np.argmin(dx ** 2 + dy ** 2, axis=1)

    return pd.DataFrame({
        "cell": cells,
        "ward_id": [f"W{i + 1:03d}" for i in nearest],
        "ward_name": [f"Ward {i + 1:03d}" for i in nearest],
    })


# ------------------------------------------------------------------- api
@lru_cache(maxsize=1)
def ward_frame(res: int = H3_RES) -> pd.DataFrame:
    """cell -> (ward_id, ward_name) for every cell in the city. Cached."""
    cells = city_cells(res)
    if WARD_GEOJSON.exists():
        df = _wards_from_geojson(cells)
        df.attrs["synthetic"] = False
        n_out = int((df.ward_id == WARD_UNASSIGNED).sum())
        print(f"[wards] {df.ward_id.nunique()} wards from {WARD_GEOJSON.name} "
              f"({len(df) - n_out}/{len(df)} cells assigned)")
    else:
        df = _wards_voronoi(cells)
        df.attrs["synthetic"] = True
        print(f"[wards] {WARD_GEOJSON.name} not found — {df.ward_id.nunique()} "
              f"FALLBACK Voronoi wards (not legal boundaries)")
    return df


def ward_map(res: int = H3_RES) -> dict[str, str]:
    """cell -> ward_id."""
    return dict(zip(ward_frame(res).cell, ward_frame(res).ward_id))


def attach_wards(df: pd.DataFrame, cell_col: str = "cell") -> pd.DataFrame:
    """Left-join ward_id/ward_name onto anything with a cell column."""
    w = ward_frame().rename(columns={"cell": cell_col})
    return df.merge(w, on=cell_col, how="left")


if __name__ == "__main__":
    w = ward_frame()
    print(w.groupby("ward_id").size().describe().round(1).to_string())
