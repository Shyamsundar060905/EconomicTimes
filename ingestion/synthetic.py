"""Synthetic world model — demo insurance + offline development.

Generates physically plausible data for every ingestor from a hidden set of
pollution sources, so the ENTIRE pipeline (fusion, attribution, forecast) runs
end-to-end with zero API keys. The fusion model has real signal to learn:

    PM2.5(cell, hour) = background(hour, boundary_layer)
                      + sum over sources of strength * decay(distance) * downwind_boost
                      + noise

Satellite NO2 correlates with traffic/industrial contributions; FIRMS fires
appear near burning-type sources in evening hours. Because the generator knows
ground truth, we can also SCORE attribution accuracy against it — a nice slide.
"""
import numpy as np
import pandas as pd

from shared.config import BBOX, PANEL_HOURS
from shared.grid import city_cells, cell_center, haversine_km, wind_alignment

RNG = np.random.default_rng(42)

# ---- Hidden sources: (name, type, lat, lon, strength, active_hours) ----
SOURCES = [
    ("Peenya industrial cluster", "industrial",   13.030, 77.520, 55.0, range(0, 24)),
    ("Bommasandra industries",    "industrial",   12.870, 77.700, 45.0, range(0, 24)),
    ("ORR construction site A",   "construction", 12.935, 77.695, 40.0, range(8, 19)),
    ("Metro construction B",      "construction", 12.990, 77.550, 35.0, range(8, 19)),
    ("Landfill burning zone",     "waste_burning",13.075, 77.610, 60.0, list(range(18, 24)) + [0, 1, 2, 3]),
    ("Kiln belt NE",              "waste_burning",13.060, 77.720, 30.0, list(range(17, 24))),
    ("Silk Board corridor",       "traffic",      12.917, 77.623, 38.0, list(range(7, 11)) + list(range(17, 21))),
    ("Hebbal corridor",           "traffic",      13.036, 77.591, 32.0, list(range(7, 11)) + list(range(17, 21))),
]

STATION_SEED = 7  # deterministic station placement


def hours_index(n_hours: int = PANEL_HOURS) -> pd.DatetimeIndex:
    end = pd.Timestamp.utcnow().floor("h")
    return pd.date_range(end - pd.Timedelta(hours=n_hours - 1), end, freq="h")


def weather(n_hours: int = PANEL_HOURS) -> pd.DataFrame:
    """Hourly wind + boundary layer height with diurnal structure."""
    idx = hours_index(n_hours)
    hrs = idx.hour.values
    # BLH: low at night (traps pollution), high mid-afternoon
    blh = 300 + 900 * np.clip(np.sin((hrs - 6) / 12 * np.pi), 0, None) + RNG.normal(0, 60, len(idx))
    # Wind: slowly-rotating direction + diurnal speed
    base_dir = (200 + 60 * np.sin(np.arange(len(idx)) / 36.0)) % 360
    wind_dir = (base_dir + RNG.normal(0, 12, len(idx))) % 360   # direction wind comes FROM
    wind_spd = np.clip(1.5 + 1.8 * np.sin((hrs - 10) / 12 * np.pi) + RNG.normal(0, 0.4, len(idx)), 0.3, None)
    temp = 22 + 6 * np.sin((hrs - 8) / 12 * np.pi) + RNG.normal(0, 0.8, len(idx))
    return pd.DataFrame({"ts": idx, "wind_from_deg": wind_dir, "wind_ms": wind_spd,
                         "blh_m": np.clip(blh, 150, None), "temp_c": temp})


def _source_contrib(lat, lon, wx_row, hour) -> dict:
    """Per-type PM2.5 contribution at (lat, lon) for one hour of weather."""
    contrib = {"industrial": 0.0, "construction": 0.0, "waste_burning": 0.0, "traffic": 0.0}
    for name, stype, slat, slon, strength, active in SOURCES:
        if hour not in active:
            continue
        d = haversine_km(slat, slon, lat, lon)
        if d > 8.0:
            continue
        decay = np.exp(-d / 2.0)                                   # ~2 km e-folding
        downwind = 0.35 + 0.65 * wind_alignment(slat, slon, lat, lon, wx_row.wind_from_deg)
        trap = np.clip(600.0 / wx_row.blh_m, 0.5, 3.0)             # low BLH -> trapped
        contrib[stype] += strength * decay * downwind * trap / max(wx_row.wind_ms, 0.5) ** 0.5
    return contrib


def truth_field(n_hours: int = PANEL_HOURS):
    """Ground-truth PM2.5 + per-type contributions for every cell x hour."""
    cells = city_cells()
    centers = {c: cell_center(c) for c in cells}
    wx = weather(n_hours)
    rows = []
    for wx_row in wx.itertuples(index=False):
        hour = wx_row.ts.hour
        bg = 35 + 25 * np.clip(500.0 / wx_row.blh_m, 0.4, 2.5)     # background w/ BLH trapping
        for c in cells:
            lat, lon = centers[c]
            contrib = _source_contrib(lat, lon, wx_row, hour)
            pm = bg + sum(contrib.values()) + RNG.normal(0, 3.0)
            rows.append({"cell": c, "ts": wx_row.ts, "pm25_true": max(pm, 4.0), **{f"c_{k}": v for k, v in contrib.items()}})
    return pd.DataFrame(rows), wx


def pick_station_cells(n: int = 12) -> list[str]:
    """Stations deliberately NOT at the worst source cells (mimics CPCB siting bias)."""
    rng = np.random.default_rng(STATION_SEED)
    cells = city_cells()
    src_cells = set()
    from shared.grid import latlng_to_cell, neighbors
    for _, _, slat, slon, _, _ in SOURCES:
        c0 = latlng_to_cell(slat, slon)
        src_cells |= {c0, *neighbors(c0, 2)}
    candidates = [c for c in cells if c not in src_cells]
    return sorted(rng.choice(candidates, size=n, replace=False).tolist())


def generate_all(n_hours: int = PANEL_HOURS):
    """Emit synthetic versions of every raw source, matching real ingestor schemas."""
    truth, wx = truth_field(n_hours)
    stations = pick_station_cells()
    centers = {c: cell_center(c) for c in city_cells()}

    # 1) Station AQI (OpenAQ schema): only station cells, small sensor noise
    st = truth[truth.cell.isin(stations)][["cell", "ts", "pm25_true"]].copy()
    st["pm25"] = st.pm25_true + RNG.normal(0, 2.0, len(st))
    st["station_id"] = "ST_" + st.cell.str[-6:]
    st["lat"] = st.cell.map(lambda c: centers[c][0])
    st["lon"] = st.cell.map(lambda c: centers[c][1])
    station_df = st[["station_id", "cell", "ts", "lat", "lon", "pm25"]]

    # 2) Satellite columns (S5P schema): daily mean, cell-level, noisy proxy of NO2-ish load
    t2 = truth.copy()
    t2["no2_col"] = 40 + 2.2 * (t2.c_traffic + t2.c_industrial) + RNG.normal(0, 6, len(t2))
    t2["so2_col"] = 10 + 1.8 * t2.c_industrial + RNG.normal(0, 3, len(t2))
    t2["aai"] = 0.4 + 0.04 * t2.c_waste_burning + RNG.normal(0, 0.15, len(t2))
    t2["date"] = t2.ts.dt.date
    sat_df = t2.groupby(["cell", "date"], as_index=False)[["no2_col", "so2_col", "aai"]].mean()

    # 3) FIRMS fires near burning sources during their active hours
    fires = []
    for wx_row in wx.itertuples(index=False):
        for name, stype, slat, slon, strength, active in SOURCES:
            if stype != "waste_burning" or wx_row.ts.hour not in active:
                continue
            if RNG.random() < 0.25:
                fires.append({"ts": wx_row.ts,
                              "lat": slat + RNG.normal(0, 0.004),
                              "lon": slon + RNG.normal(0, 0.004),
                              "frp": float(np.clip(RNG.normal(strength / 8, 2), 1, None)),
                              "confidence": "nominal"})
    fires_df = pd.DataFrame(fires)

    # 4) OSM static geography: sources as tagged features + amenities
    osm_rows = []
    for name, stype, slat, slon, strength, _ in SOURCES:
        tag = {"industrial": "landuse=industrial", "construction": "landuse=construction",
               "waste_burning": "man_made=kiln|landfill", "traffic": "highway=trunk"}[stype]
        osm_rows.append({"name": name, "kind": stype, "tag": tag, "lat": slat, "lon": slon})
    for i in range(25):  # schools/hospitals for the vulnerability layer
        osm_rows.append({"name": f"school_{i}", "kind": "school", "tag": "amenity=school",
                         "lat": RNG.uniform(BBOX["lat_min"], BBOX["lat_max"]),
                         "lon": RNG.uniform(BBOX["lon_min"], BBOX["lon_max"])})
    osm_df = pd.DataFrame(osm_rows)

    return {"stations": station_df, "satellite": sat_df, "fires": fires_df,
            "osm": osm_df, "weather": wx, "_truth": truth}
