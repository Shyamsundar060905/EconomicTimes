"""Synthetic world model — demo insurance, offline development, and the only
place we have a perfect emission inventory to score attribution against.

DESIGN RULE: the generator must never be the scorer in disguise. An earlier
version emitted its hidden sources straight into the OSM layer with exact
coordinates and exact category labels, and used the same
`exp(-d/2) * wind_alignment` kernel that the attribution scorer uses — so
"100% attribution accuracy" was an arithmetic identity, not a measurement.
Four deliberate adversarial choices keep the evaluation honest:

  1. DIFFERENT PHYSICS. Emissions disperse as a Gaussian plume (crosswind
     spread widening with downwind distance, 1/x dilution). The attribution
     scorer assumes isotropic `exp(-d/2) * cos(wind)`. Same story, different
     functional family — so recovering the source is real inference.

  2. COLUMN != SURFACE. The satellite sees a *column load* with no boundary-layer
     trapping; a station measures *surface* concentration, which is the same
     emission multiplied by the trapping factor. Bridging the two is exactly the
     job we claim the fusion model does, so it now has to actually do it (and
     BLH has to earn its place as a feature).

  3. THE SATELLITE IS BLURRY. TROPOMI ground pixels are ~5.5 km; an H3 res-8
     cell is ~460 m. Columns are Gaussian-blurred to match, so nothing can read
     a per-cell truth signal out of them.

  4. THE MAP LIES. Registered sources land in OSM with a position error; some
     sources are UNREGISTERED (illegal burning, unpermitted sites) and appear
     nowhere in OSM — attribution must recover them from signature and fire
     evidence alone; and DECOY sites (dormant estates, finished construction)
     sit in OSM emitting nothing, so proximity to a mapped polygon is not proof.

The eval (`scripts/eval_attribution.py`) reports registered and unregistered
accuracy separately, because those are two different claims.
"""
from functools import lru_cache

import numpy as np
import pandas as pd

from shared.config import BBOX, PANEL_HOURS, SAT_BLUR_SIGMA_KM, SYNTHETIC_ANCHOR, CITY
from shared.grid import city_cells, cell_center, bearing_deg

WORLD_SEED = 42
RNG = np.random.default_rng(WORLD_SEED)


def _reset_rng() -> None:
    """Rewind the world's RNG.

    RNG is module-level and STATEFUL: generate_all() draws from it, so calling it
    twice in one process silently produces two different worlds. A single pipeline
    run never noticed (it generates once), but any script that regenerates — the
    station-siting sensitivity sweep, for one — would drift, and leave data/ in a
    state no fresh run reproduces. Every entry point into world generation rewinds
    first, so the world is a pure function of WORLD_SEED.
    """
    global RNG
    RNG = np.random.default_rng(WORLD_SEED)

# ---- Hidden sources ----
# (name, type, lat, lon, strength, active_hours, registered, live_from)
#   registered=False -> the source emits but appears in NO map layer.
#   live_from        -> fraction of the window at which it switches on. A source
#                       that starts on day 45 of 60 is EMERGING: loud in the 7d
#                       window, invisible in the 30d one. Detection has to tell
#                       that apart from a chronic source and from a one-off fire,
#                       which is the whole point of aggregating over several
#                       windows instead of trusting one.
SOURCES = [
    ("Peenya industrial cluster", "industrial",    13.030, 77.520, 55.0, range(0, 24), True, 0.0),
    ("Bommasandra industries",    "industrial",    12.870, 77.700, 45.0, range(0, 24), True, 0.0),
    ("ORR construction site A",   "construction",  12.935, 77.695, 40.0, range(8, 19), True, 0.0),
    ("Metro construction B",      "construction",  12.990, 77.550, 35.0, range(8, 19), True, 0.0),
    ("Silk Board corridor",       "traffic",       12.917, 77.623, 38.0, list(range(7, 11)) + list(range(17, 21)), True, 0.0),
    ("Hebbal corridor",           "traffic",       13.036, 77.591, 32.0, list(range(7, 11)) + list(range(17, 21)), True, 0.0),
    # --- unregistered: on no map, in no register. The hard cases. ---
    ("Landfill burning zone",     "waste_burning", 13.075, 77.610, 60.0, list(range(18, 24)) + [0, 1, 2, 3], False, 0.0),
    ("Kiln belt NE",              "waste_burning", 13.060, 77.720, 30.0, list(range(17, 24)), False, 0.0),
    # --- emerging: commissioned three-quarters of the way through the window ---
    ("Unpermitted crusher SW",    "construction",  12.880, 77.490, 42.0, range(7, 20), False, 0.75),
]

N_DECOYS = 14           # mapped sites that emit nothing (dormant / compliant / finished)
OSM_POS_ERROR_M = 250   # OSM centroid != emission point
STATION_SEED = 7        # deterministic station placement
EMIT_SCALE = 42.0       # global calibration so PM2.5 lands in a realistic band
MAX_SOURCE_KM = 8.0

# Diffuse urban background: a real city is not 9 point sources on a flat field.
# Thousands of unmappable emitters (cooking, resuspension, small commercial,
# the road network itself) make a smooth, spatially structured background that
# is DENSER IN THE CORE. This matters for the evaluation, not just realism: with
# a spatially uniform background, every station reads the same thing, the
# city-mean baseline is near-perfect by construction, and no fusion model can
# beat it. Structured background is what gives spatial fusion something to do.
URBAN_AMP = 22.0        # ug/m3 of diffuse emission at the densest core (pre-trapping)
URBAN_NO2 = 25.0        # the road network is a NO2 tracer -> the satellite can see it
N_ROAD_NODES = 220      # OSM road density, sampled proportional to urban intensity
# Per active hour. Calibrated to real FIRMS: ~18 detections over ALL of Delhi in 60
# days. The old 0.25 gave us 281 — a gift we were giving ourselves.
FIRE_DETECT_RATE = 0.18   # per active hour DURING an episode (VIIRS ~2 passes/day)
URBAN_SEED = 11

# Station siting. CPCB norms deliberately place monitors away from immediate
# sources, and we reproduce that by excluding the source cell + its k-ring.
#
# THIS IS AN ASSUMPTION OF THE WORLD MODEL, NOT A FINDING. At k=2 the effective
# exclusion floor is ~1.9-2.4 km, so the statement "no source is within 2 km of a
# monitor" is true ~99% of the time BY CONSTRUCTION (only 1 of 1039 candidate
# cells survives inside 2 km; P(a station lands there) = 1.1%). Report it as the
# modelling assumption it is — grounded in real CPCB siting norms — and never as
# something the pipeline discovered. See scripts/eval_coverage_bias.py for the
# genuinely empirical version of this claim, measured on real monitors and real
# OSM industry.
#
# Detection does NOT depend on this: it runs on satellite + FIRMS and never reads
# a station. Set STATION_EXCLUSION_K = 0 and recall is unchanged.
STATION_EXCLUSION_K = 2


def hours_index(n_hours: int = PANEL_HOURS) -> pd.DatetimeIndex:
    """The world's 60-day window, ending at a FIXED anchor.

    This used to end at `Timestamp.utcnow()`, which meant the whole world — and
    the hour detection runs at — slid with the wall clock. Run the identical code
    twice four hours apart and you get different wind, different fires, different
    hotspots: 72 cells at 22:00, 93 at 02:00, with no code change. Every number we
    report would have a silent "as measured at 10pm last Tuesday" attached to it.

    A synthetic world exists to be reproducible. Anchor it. Live mode uses real
    timestamps from the real collectors and is unaffected.
    """
    end = pd.Timestamp(SYNTHETIC_ANCHOR, tz="UTC").floor("h")
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


# --------------------------------------------------------------- dispersion
def _plume(dist_km: np.ndarray, bearing: np.ndarray,
           wind_from_deg: float, wind_ms: float) -> np.ndarray:
    """Gaussian plume shape from one source to every cell. Vectorised over cells.

    Deliberately NOT the kernel the attribution scorer assumes. Crosswind spread
    widens with downwind distance; concentration dilutes as 1/(x * wind_speed).
    Upwind receptors get only weak back-diffusion.
    """
    wind_to = (wind_from_deg + 180.0) % 360.0        # direction the wind blows TOWARD
    dtheta = np.radians(bearing - wind_to)
    along = dist_km * np.cos(dtheta)                 # km downwind (negative = upwind)
    cross = np.abs(dist_km * np.sin(dtheta))         # km off the plume centreline

    # Virtual-source offset: a real stack/site has finite extent, so the near
    # field does not run away to infinity as x -> 0.
    x = np.maximum(along, 0.6)
    sigma_y = 0.12 * x + 0.20                        # plume widens with distance
    conc = np.exp(-(cross ** 2) / (2 * sigma_y ** 2)) / (x ** 0.85 * max(wind_ms, 1.0))

    back = 0.05 * np.exp(-dist_km / 0.8)             # weak upwind back-diffusion
    conc = np.where(along < -0.5, back, conc)
    return np.where(dist_km > MAX_SOURCE_KM, 0.0, conc)


def truth_field(n_hours: int = PANEL_HOURS):
    """Ground truth for every cell x hour.

    Returns per-type SURFACE contributions (`c_*`, what a station measures, BLH
    trapping applied) and per-type COLUMN loads (`col_*`, what a satellite sees,
    no trapping). The gap between them is the problem the fusion model exists to
    solve.
    """
    cells = city_cells()
    centers = np.array([cell_center(c) for c in cells])           # (n_cells, 2)
    wx = weather(n_hours)
    kinds = ["industrial", "construction", "waste_burning", "traffic"]
    urban = urban_field()

    # Precompute per-source geometry once: distance + bearing to every cell.
    geom = []
    for name, stype, slat, slon, strength, active, _reg, live_from in SOURCES:
        dist = np.array([_haversine_vec(slat, slon, centers[:, 0], centers[:, 1])]).ravel()
        brg = np.array([bearing_deg(slat, slon, la, lo) for la, lo in centers])
        geom.append((stype, strength, set(active), dist, brg, int(live_from * len(wx))))

    n_cells, n_hours_ = len(cells), len(wx)
    surf = {k: np.zeros((n_hours_, n_cells)) for k in kinds}
    col = {k: np.zeros((n_hours_, n_cells)) for k in kinds}
    pm = np.zeros((n_hours_, n_cells))
    # Track the single dominant SOURCE (not category) per cell x hour, so the
    # eval can split accuracy by whether that source was on the map at all.
    best_val = np.zeros((n_hours_, n_cells))
    best_idx = np.full((n_hours_, n_cells), -1, dtype=int)

    for h, wx_row in enumerate(wx.itertuples(index=False)):
        trap = float(np.clip(600.0 / wx_row.blh_m, 0.5, 3.0))
        for si, (stype, strength, active, dist, brg, live_at) in enumerate(geom):
            if wx_row.ts.hour not in active or h < live_at:
                continue
            load = EMIT_SCALE * strength / 50.0 * _plume(dist, brg, wx_row.wind_from_deg, wx_row.wind_ms)
            col[stype][h] += load                     # satellite: no trapping
            contrib = load * trap                     # station: trapped at the surface
            surf[stype][h] += contrib
            win = contrib > best_val[h]
            best_val[h][win], best_idx[h][win] = contrib[win], si
        # Background = regional floor + diffuse urban emission, both trapped by a
        # shallow boundary layer. Spatially structured, and NOT attributed to any
        # enforcement category: this is the city's baseline, not a violator.
        bg = 18.0 + (10.0 + URBAN_AMP * urban) * trap
        pm[h] = bg + sum(surf[k][h] for k in kinds) + RNG.normal(0, 3.0, n_cells)

    names = np.array([s[0] for s in SOURCES] + ["none"])
    reg = np.array([s[6] for s in SOURCES] + [False])
    idx = best_idx.ravel()                            # -1 -> "none" via wraparound

    truth = pd.DataFrame({
        "cell": np.tile(cells, n_hours_),
        "ts": np.repeat(wx.ts.values, n_cells),
        "pm25_true": np.maximum(pm.ravel(), 4.0),
        "top_source": names[idx],
        "top_source_val": best_val.ravel(),
        "top_source_registered": reg[idx],
        **{f"c_{k}": surf[k].ravel() for k in kinds},
        **{f"col_{k}": col[k].ravel() for k in kinds},
    })
    return truth, wx


@lru_cache(maxsize=1)
def urban_field() -> np.ndarray:
    """Per-cell diffuse-emission intensity in [0, 1]: dense core, smooth falloff.

    Deliberately OBSERVABLE — it drives OSM road density and the NO2 column, so a
    model with satellite + land-use features can learn it, while a station-only
    city-mean baseline cannot. That asymmetry is the whole coverage-bias thesis,
    and it only exists if the background actually varies in space.
    """
    cells = city_cells()
    pts = np.array([cell_center(c) for c in cells])
    lat0, lon0 = pts[:, 0].mean(), pts[:, 1].mean()
    d = _haversine_vec(lat0, lon0, pts[:, 0], pts[:, 1])
    radial = np.exp(-(d / (0.45 * d.max())) ** 2)              # dense core

    rng = np.random.default_rng(URBAN_SEED)
    smooth = _blur_matrix(cells) @ rng.normal(0, 1, len(cells))  # correlated texture
    smooth = (smooth - smooth.min()) / np.ptp(smooth)

    u = 0.6 * radial + 0.4 * smooth
    return (u - u.min()) / np.ptp(u)


def _haversine_vec(lat1, lon1, lat2, lon2):
    """Vectorised haversine (km) from one point to arrays of points."""
    R = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = np.radians(lat2 - lat1), np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(a))


def _blur_matrix(cells: list[str]) -> np.ndarray:
    """Row-normalised Gaussian spatial weights — the satellite's coarse footprint."""
    pts = np.array([cell_center(c) for c in cells])
    lat0 = np.radians(pts[:, 0].mean())
    dy = (pts[:, None, 0] - pts[None, :, 0]) * 111.32
    dx = (pts[:, None, 1] - pts[None, :, 1]) * 111.32 * np.cos(lat0)
    d = np.sqrt(dx ** 2 + dy ** 2)
    w = np.exp(-(d ** 2) / (2 * SAT_BLUR_SIGMA_KM ** 2))
    w[d > 3 * SAT_BLUR_SIGMA_KM] = 0.0
    return w / w.sum(axis=1, keepdims=True)


def pick_station_cells(n: int = 12, exclusion_k: int | None = None) -> list[str]:
    """Stations deliberately NOT at the source cells (mimics CPCB siting bias).

    `exclusion_k` is exposed so the assumption can be TESTED rather than trusted:
    set it to 0 and stations may land on top of sources. Detection recall is
    invariant to it (satellite + FIRMS never read a station); only the fusion
    field changes. See scripts/eval_station_sensitivity.py.
    """
    # Read the module global at CALL time, not as a default argument: a default is
    # bound when the function is defined, so `synth.STATION_EXCLUSION_K = 0` would
    # never reach it and the sensitivity sweep would silently test nothing.
    k = STATION_EXCLUSION_K if exclusion_k is None else exclusion_k
    rng = np.random.default_rng(STATION_SEED)
    cells = city_cells()
    if k <= 0:
        candidates = cells                     # monitors may land anywhere, even on a source
    else:
        from shared.grid import latlng_to_cell, neighbors
        src_cells = set()
        for _, _, slat, slon, _, _, _, _ in SOURCES:
            c0 = latlng_to_cell(slat, slon)
            src_cells |= {c0, *neighbors(c0, k)}
        candidates = [c for c in cells if c not in src_cells]
    return sorted(rng.choice(candidates, size=n, replace=False).tolist())


def _osm_layer() -> pd.DataFrame:
    """What the map knows — which is not what is true.

    Registered sources appear with a position error. Unregistered sources appear
    not at all. Decoys appear and emit nothing.
    """
    rows = []
    tag_of = {"industrial": "landuse=industrial", "construction": "landuse=construction",
              "waste_burning": "man_made=kiln", "traffic": "highway=trunk"}
    deg = OSM_POS_ERROR_M / 111_320.0

    for name, stype, slat, slon, _strength, _active, registered, _live in SOURCES:
        if not registered:
            continue                                    # illegal / unmapped: no OSM record
        rows.append({"name": name, "kind": stype, "tag": tag_of[stype],
                     "lat": slat + RNG.normal(0, deg), "lon": slon + RNG.normal(0, deg)})

    decoy_names = {"industrial": "Dormant industrial estate", "construction": "Completed project",
                   "waste_burning": "Decommissioned kiln", "traffic": "Arterial road"}
    for i in range(N_DECOYS):
        kind = ["industrial", "construction", "waste_burning", "traffic"][i % 4]
        rows.append({"name": f"{decoy_names[kind]} {i + 1}", "kind": kind, "tag": tag_of[kind],
                     "lat": RNG.uniform(BBOX["lat_min"], BBOX["lat_max"]),
                     "lon": RNG.uniform(BBOX["lon_min"], BBOX["lon_max"])})

    # The road network: sampled proportional to urban intensity, so OSM road
    # density is an observable proxy for the diffuse background. Tagged `road`,
    # NOT `traffic` — these are not enforcement candidates (you cannot serve a
    # notice on a road), they are a land-use feature. The two named traffic
    # CORRIDORS above remain the attributable traffic sources.
    cells = city_cells()
    u = urban_field()
    p = u ** 2 / (u ** 2).sum()
    for i, ci in enumerate(RNG.choice(len(cells), size=N_ROAD_NODES, replace=True, p=p)):
        lat, lon = cell_center(cells[ci])
        rows.append({"name": f"road_{i}", "kind": "road", "tag": "highway=primary",
                     "lat": lat + RNG.normal(0, 0.002), "lon": lon + RNG.normal(0, 0.002)})

    for i in range(25):  # schools/hospitals for the vulnerability layer
        rows.append({"name": f"school_{i}", "kind": "school", "tag": "amenity=school",
                     "lat": RNG.uniform(BBOX["lat_min"], BBOX["lat_max"]),
                     "lon": RNG.uniform(BBOX["lon_min"], BBOX["lon_max"])})
    return pd.DataFrame(rows)


def _assert_bbox_matches_sources() -> None:
    """The synthetic world is ANCHORED to its 9 hidden sources' coordinates.

    Those sources sit around Bengaluru. Point config.BBOX at another city and every
    one of them falls ~1700 km outside the grid, so the world emits NOTHING — and it
    does so SILENTLY: the pipeline runs to completion, exits 0, and the evaluation
    cheerfully scores a world with no sources in it (measured: recall 0/2, 0/4, 0/3,
    zero enforceable cells, CI green). That is the exact failure class this project
    exists to prevent, so it now raises.

    If you want the synthetic world in another city, move SOURCES to that city's
    coordinates. If you want another city's REAL data, drop --synthetic.
    """
    inside = [s for s in SOURCES
              if BBOX["lat_min"] <= s[2] <= BBOX["lat_max"]
              and BBOX["lon_min"] <= s[3] <= BBOX["lon_max"]]
    if len(inside) < len(SOURCES):
        raise ValueError(
            f"The synthetic world's hidden sources are not inside config.BBOX "
            f"(only {len(inside)}/{len(SOURCES)} land in it).\n"
            f"BBOX is currently AQ_CITY={CITY!r} = {BBOX}.\n"
            f"The synthetic sources are anchored around Bengaluru, so this world would "
            f"emit nothing and every evaluation would silently score 0.\n"
            f"Fix: run synthetic mode with AQ_CITY=bengaluru (or unset it), or drop "
            f"--synthetic to use {CITY}'s real data.")


def generate_all(n_hours: int = PANEL_HOURS):
    """Emit synthetic versions of every raw source, matching real ingestor schemas."""
    _assert_bbox_matches_sources()   # fail LOUDLY, never silently emit an empty world
    _reset_rng()          # the world must be a pure function of WORLD_SEED
    truth, wx = truth_field(n_hours)
    cells = city_cells()
    stations = pick_station_cells()
    centers = {c: cell_center(c) for c in cells}

    # 1) Station AQI (OpenAQ schema): only station cells, small sensor noise
    st = truth[truth.cell.isin(stations)][["cell", "ts", "pm25_true"]].copy()
    st["pm25"] = st.pm25_true + RNG.normal(0, 2.0, len(st))
    st["station_id"] = "ST_" + st.cell.str[-6:]
    st["lat"] = st.cell.map(lambda c: centers[c][0])
    st["lon"] = st.cell.map(lambda c: centers[c][1])
    station_df = st[["station_id", "cell", "ts", "lat", "lon", "pm25"]]

    # 2) Satellite columns (S5P schema): daily mean of the COLUMN load (no BLH
    #    trapping), Gaussian-blurred to a TROPOMI-like footprint, then noised.
    t2 = truth.copy()
    t2["date"] = pd.to_datetime(t2.ts).dt.date
    daily = t2.groupby(["cell", "date"], as_index=False)[
        ["col_traffic", "col_industrial", "col_waste_burning"]].mean()
    order = {c: i for i, c in enumerate(cells)}
    W = _blur_matrix(cells)
    blurred = []
    for date, g in daily.groupby("date"):
        g = g.set_index("cell").reindex(cells).fillna(0.0)
        v = W @ g[["col_traffic", "col_industrial", "col_waste_burning"]].values
        blurred.append(pd.DataFrame({"cell": cells, "date": date,
                                     "b_traffic": v[:, 0], "b_industrial": v[:, 1],
                                     "b_burn": v[:, 2]}))
    sat_df = pd.concat(blurred, ignore_index=True)
    n = len(sat_df)
    # NO2 is a combustion tracer: it sees BOTH the point sources and the diffuse
    # road network. That second term is what lets the fusion model infer the
    # spatial background in cells that have no monitor.
    urban_by_cell = dict(zip(cells, W @ urban_field()))
    u = sat_df.cell.map(urban_by_cell).values
    # INSTRUMENT NOISE, CALIBRATED TO THE REAL INSTRUMENT.
    #
    # This is where the old 4/4 came from, and it was our own fault. We made the
    # SOURCES adversarial and left the SENSORS perfect: SO2 got a clean industrial
    # signature (noise sigma 4.5 on a signal of ~60) and AAI a clean burning one. So
    # the detector learned to trust two channels that, in reality, are noise — and
    # scored 4/4 on a world that flattered its own instruments.
    #
    # Measured on real S5P over Bengaluru AND Delhi (scripts/compare_cities.py):
    #   NO2  median  43 umol/m2, MAD  12   -> SNR 2.6-2.8   usable
    #   SO2  median   3 umol/m2, MAD  91   -> SNR 0.66-0.87 NOISE (49% NEGATIVE)
    #   AAI  median -0.39,       MAD 0.48  -> SNR 0.76-1.03 NOISE
    #
    # So SO2 and AAI now carry the noise they really carry. They stay in the schema
    # (they are real products, and honest evidence for a human to look at) but any
    # model that leans on them will now be punished here, exactly as it is punished
    # in reality. Model an instrument's NOISE before you model its signal.
    sat_df["no2_col"] = (40 + 1.6 * (sat_df.b_traffic + sat_df.b_industrial)
                         + URBAN_NO2 * u + RNG.normal(0, 12, n))
    sat_df["so2_col"] = 3 + 1.3 * sat_df.b_industrial + RNG.normal(0, 135, n)
    sat_df["aai"] = -0.39 + 0.030 * sat_df.b_burn + RNG.normal(0, 0.71, n)
    sat_df = sat_df[["cell", "date", "no2_col", "so2_col", "aai"]]

    # 3) FIRMS fires near burning sources during their active hours. Fires are the
    #    only direct evidence of the unregistered burning sources.
    # FIRES ARE EPISODIC, NOT A COIN FLIP EVERY HOUR.
    #
    # This is the modelling error that a uniform per-hour probability hides, and it
    # is fatal to the thing we actually detect. A landfill does not emit one
    # independent fire per hour: it IGNITES and then BURNS FOR DAYS. Real Bhalswa
    # burned Nov 21-27 2025 — six detections inside seven days — and it is exactly
    # that CLUSTERING that puts fire persistence above threshold in a 7-day window.
    #
    # Drawn independently per hour, the same total number of fires scatters evenly
    # across 60 days, persistence is ~0 in every window, and the detector finds
    # nothing. Measured: 44 uniformly-scattered fires detect NOTHING; 7 clustered
    # ones found Bhalswa. The count was never the point. The burst is.
    episodes: dict[str, list[tuple[int, int]]] = {}
    for name, stype, *_rest in SOURCES:
        if stype != "waste_burning":
            continue
        eps, day = [], int(RNG.integers(0, 12))
        while day < 60:
            dur = int(RNG.integers(3, 7))            # a fire burns for 3-6 days
            eps.append((day * 24, (day + dur) * 24))
            day += dur + int(RNG.integers(8, 18))    # then weeks of quiet
        episodes[name] = eps

    def burning(name: str, h: int) -> bool:
        return any(a <= h < b for a, b in episodes.get(name, []))

    fires = []
    n_wx = len(wx)
    for h, wx_row in enumerate(wx.itertuples(index=False)):
        for name, stype, slat, slon, strength, active, _reg, live_from in SOURCES:
            if stype != "waste_burning" or wx_row.ts.hour not in active:
                continue
            if h < int(live_from * n_wx):
                continue
            if not burning(name, h):
                continue
            # FIRE DETECTION RATE, CALIBRATED TO THE REAL SATELLITE.
            #
            # This was 0.25/active-hour, which produced 281 detections over 60 days.
            # Real VIIRS passes overhead ~twice a day, and only catches a fire that
            # happens to be burning, uncovered, at that moment: real FIRMS returns
            # 18 detections over ALL of Delhi in 60 days, 7 of them at Bhalswa — the
            # landfill our detector successfully found. Seven is enough. 281 was a
            # gift we were giving ourselves.
            if RNG.random() < FIRE_DETECT_RATE:
                fires.append({"ts": wx_row.ts,
                              "lat": slat + RNG.normal(0, 0.004),
                              "lon": slon + RNG.normal(0, 0.004),
                              "frp": float(np.clip(RNG.normal(strength / 8, 2), 1, None)),
                              "confidence": "nominal"})
    # false positives: FIRMS picks up flares, kitchens, hot roofs
    for _ in range(int(0.08 * len(fires))):
        fires.append({"ts": wx.ts.sample(1, random_state=int(RNG.integers(1e6))).iloc[0],
                      "lat": RNG.uniform(BBOX["lat_min"], BBOX["lat_max"]),
                      "lon": RNG.uniform(BBOX["lon_min"], BBOX["lon_max"]),
                      "frp": float(np.clip(RNG.normal(3, 1), 1, None)),
                      "confidence": "low"})
    fires_df = pd.DataFrame(fires)

    # 4) OSM static geography — with position error, omissions, and decoys
    osm_df = _osm_layer()

    return {"stations": station_df, "satellite": sat_df, "fires": fires_df,
            "osm": osm_df, "weather": wx, "_truth": truth}


if __name__ == "__main__":
    out = generate_all()
    t = out["_truth"]
    print("PM2.5 true:", t.pm25_true.describe()[["mean", "50%", "max"]].round(1).to_dict())
    print("osm rows:", len(out["osm"]), "| fires:", len(out["fires"]))
