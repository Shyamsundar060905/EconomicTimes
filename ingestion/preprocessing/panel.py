"""Assemble the cell x hour feature panel — the one table everything reads.

Row = (H3 cell, hour). Columns = everything we know about that cell then:
station PM2.5 (where a station exists), satellite columns, fires within 2 km,
weather, land-use context, time features.
"""
import numpy as np
import pandas as pd

from shared.config import DATA_RAW, DATA_OUT
from shared.grid import city_cells, cell_center, latlng_to_cell, haversine_km, neighbors
from shared.wards import attach_wards


def _landuse_features(cells: list[str], osm: pd.DataFrame) -> pd.DataFrame:
    """Static per-cell context: counts of each source kind within ~1.5 km, road
    density, school/hospital count.

    `lu_road` (generic road network) is separate from `lu_traffic` (named major
    corridors) on purpose: road density is the observable proxy for the diffuse
    urban background, and it is the strongest spatial feature the fusion model
    has in cells with no monitor. A road is a feature; a corridor is a suspect.
    """
    centers = {c: cell_center(c) for c in cells}
    kinds = ["industrial", "construction", "waste_burning", "traffic", "road"]
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
    # Floor to the hour before intersecting: OpenAQ stamps period-ends and
    # Open-Meteo stamps hour-starts, so an exact-equality set intersection on
    # raw timestamps can silently come back empty against live APIs.
    stations["ts"] = pd.to_datetime(stations.ts, utc=True).dt.floor("h")
    weather["ts"] = pd.to_datetime(weather.ts, utc=True).dt.floor("h")
    hours = pd.DatetimeIndex(sorted(set(stations.ts) & set(weather.ts)))
    if len(hours) == 0:
        raise ValueError(
            f"No overlapping hours between stations ({stations.ts.min()} .. {stations.ts.max()}) "
            f"and weather ({weather.ts.min()} .. {weather.ts.max()}). The panel would be empty; "
            f"refusing to build it. Check the two collectors' time windows and timezones.")

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

    # ward: the administrative key every downstream contract carries
    panel = attach_wards(panel)

    # time features
    panel["hour"] = panel.ts.dt.hour
    panel["dow"] = panel.ts.dt.dayofweek

    panel.to_parquet(DATA_OUT / "panel.parquet", index=False)
    n_st = panel.pm25_station.notna().sum()
    print(f"[panel] {len(panel):,} rows ({len(cells)} cells x {len(hours)} hours); "
          f"{n_st:,} station-labeled rows ({panel[panel.pm25_station.notna()].cell.nunique()} station cells); "
          f"{panel.ward_id.nunique()} wards")
    return panel


if __name__ == "__main__":
    build_panel()
