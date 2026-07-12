"""Assemble the cell x hour feature panel — the one table everything reads.

Row = (H3 cell, hour). Columns = everything we know about that cell then:
station PM2.5 (where a station exists), satellite columns, fires within 2 km,
weather, land-use context, time features.
"""
import numpy as np
import pandas as pd

from shared.config import DATA_RAW, DATA_OUT
from shared.grid import city_cells, cell_center, latlng_to_cell, haversine_km, neighbors


def _landuse_features(cells: list[str], osm: pd.DataFrame) -> pd.DataFrame:
    """Static per-cell context: counts of each source kind within ~1.5 km, school/hospital count."""
    centers = {c: cell_center(c) for c in cells}
    kinds = ["industrial", "construction", "waste_burning", "traffic"]
    rows = []
    for c in cells:
        lat, lon = centers[c]
        row = {"cell": c}
        near = osm[[haversine_km(lat, lon, r.lat, r.lon) <= 1.5 for r in osm.itertuples()]]
        for k in kinds:
            row[f"lu_{k}"] = int((near.kind == k).sum())
        row["lu_sensitive"] = int(near.kind.isin(["school", "hospital"]).sum())
        rows.append(row)
    return pd.DataFrame(rows)


def _fire_features(cells: list[str], fires: pd.DataFrame, hours: pd.DatetimeIndex) -> pd.DataFrame:
    """fires within 2 km of the cell in the trailing 6 h, per (cell, hour)."""
    centers = {c: cell_center(c) for c in cells}
    out = []
    if fires.empty:
        return pd.DataFrame([{"cell": c, "ts": t, "fires_6h": 0, "frp_6h": 0.0}
                             for c in cells for t in hours])
    fires = fires.copy()
    fires["ts"] = pd.to_datetime(fires.ts, utc=True)
    for c in cells:
        lat, lon = centers[c]
        near = fires[[haversine_km(lat, lon, r.lat, r.lon) <= 2.0 for r in fires.itertuples()]]
        for t in hours:
            w = near[(near.ts > t - pd.Timedelta(hours=6)) & (near.ts <= t)]
            out.append({"cell": c, "ts": t, "fires_6h": len(w), "frp_6h": float(w.frp.sum())})
    return pd.DataFrame(out)


def build_panel() -> pd.DataFrame:
    stations = pd.read_parquet(DATA_RAW / "stations.parquet")
    weather = pd.read_parquet(DATA_RAW / "weather.parquet")
    sat = pd.read_parquet(DATA_RAW / "satellite.parquet")
    fires = pd.read_parquet(DATA_RAW / "fires.parquet")
    osm = pd.read_parquet(DATA_RAW / "osm.parquet")

    cells = city_cells()
    stations["ts"] = pd.to_datetime(stations.ts, utc=True)
    weather["ts"] = pd.to_datetime(weather.ts, utc=True)
    hours = pd.DatetimeIndex(sorted(set(stations.ts) & set(weather.ts)))

    # spine: cell x hour
    panel = pd.MultiIndex.from_product([cells, hours], names=["cell", "ts"]).to_frame(index=False)

    # station label (only where a station sits in that cell)
    st = stations.groupby(["cell", "ts"], as_index=False).pm25.mean().rename(columns={"pm25": "pm25_station"})
    panel = panel.merge(st, on=["cell", "ts"], how="left")

    # weather (citywide, joined on hour)
    panel = panel.merge(weather, on="ts", how="left")

    # satellite (daily -> forward-filled onto hours)
    sat = sat.copy()
    sat["date"] = pd.to_datetime(sat.date)
    panel["date"] = panel.ts.dt.tz_localize(None).dt.normalize()
    panel = panel.merge(sat, on=["cell", "date"], how="left").drop(columns="date")
    panel[["no2_col", "so2_col", "aai"]] = (
        panel.sort_values("ts").groupby("cell")[["no2_col", "so2_col", "aai"]].ffill().bfill())

    # fires + static land use
    panel = panel.merge(_fire_features(cells, fires, hours), on=["cell", "ts"], how="left")
    panel = panel.merge(_landuse_features(cells, osm), on="cell", how="left")

    # time features
    panel["hour"] = panel.ts.dt.hour
    panel["dow"] = panel.ts.dt.dayofweek

    panel.to_parquet(DATA_OUT / "panel.parquet", index=False)
    n_st = panel.pm25_station.notna().sum()
    print(f"[panel] {len(panel):,} rows ({len(cells)} cells x {len(hours)} hours); "
          f"{n_st:,} station-labeled rows ({panel[panel.pm25_station.notna()].cell.nunique()} station cells)")
    return panel


if __name__ == "__main__":
    build_panel()
