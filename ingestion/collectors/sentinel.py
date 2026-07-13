"""Sentinel-5P collector — the real satellite, via Google Earth Engine.

This is the layer detection actually runs on. Everything else in the platform can
degrade gracefully to synthetic; this one cannot, because a synthetic satellite
joined to real stations is not a degraded product, it is a *wrong* one (see
`pollers.run`, which now refuses that combination outright).

WHAT WE PULL — the four products the detector already expects:

    L3_NO2     tropospheric_NO2_column_number_density   traffic, combustion, industry
    L3_SO2     SO2_column_number_density                INDUSTRY (point-source tracer)
    L3_CO      CO_column_number_density                 combustion
    L3_AER_AI  absorbing_aerosol_index                  SMOKE / burning

TWO PHYSICAL FACTS THAT SHAPE THIS FILE

1. S5P's ground pixel is ~5.5 x 3.5 km. An H3 res-8 cell is ~460 m. The GEE L3
   product is *gridded* to ~1113 m, but gridding does not manufacture information
   that the instrument never resolved. Neighbouring cells are therefore strongly
   correlated by construction — which is exactly why detection scores a cell
   against an annulus 4-8 km away (outside the footprint) and not against its
   immediate neighbours, and why the synthetic world blurs to match. Do not
   "improve" this by sampling at a finer scale; the detail is not there.

2. One overpass per day, ~13:30 local, and clouds punch holes in it. So a single
   day is a weak observation, which is why every window here is a MEDIAN over
   many days and why gaps are left as NaN for the panel to forward-fill rather
   than being invented here.

UNITS: columns come back in mol/m^2 (~1e-5). We rescale to umol/m^2 so the numbers
are human-readable. This is safe because every consumer is scale-invariant —
detection uses robust z-scores and neighbourhood contrast, attribution uses city
percentiles, and LightGBM is invariant to monotone per-feature transforms. AAI is
already dimensionless and is left alone.
"""
import os
import sys

import pandas as pd

from shared.config import BBOX, DATA_RAW, GEE_PROJECT, PANEL_HOURS
from shared.grid import city_cells, cell_center

# collection -> (band, output column, scale factor)
#
# This MUST stay byte-identical to the schema ingestion/synthetic.py emits, or the
# two worlds silently diverge and the panel grows a column that is populated in one
# mode and NaN in the other.
#
# CO is deliberately NOT here. S5P does carry it (COPERNICUS/S5P/OFFL/L3_CO, band
# CO_column_number_density) and it is a real combustion tracer worth having — but
# adding it is a DELIBERATE change, not a freebie: it means adding CO to the
# synthetic world too, which perturbs the RNG draw, which changes the world, which
# changes every number in the README. Do it on purpose, re-run all four evals, and
# update the docs. Do not do it by accident here.
PRODUCTS = {
    "COPERNICUS/S5P/OFFL/L3_NO2":    ("tropospheric_NO2_column_number_density", "no2_col", 1e6),
    "COPERNICUS/S5P/OFFL/L3_SO2":    ("SO2_column_number_density",              "so2_col", 1e6),
    "COPERNICUS/S5P/OFFL/L3_AER_AI": ("absorbing_aerosol_index",                "aai",     1.0),
}
S5P_SCALE_M = 1113.2   # the native L3 grid; asking for finer is asking for fiction

# OFFL = "offline": the reprocessed, good product, published with a LAG of several
# days. Querying the last few days returns literally nothing, which is not a bug in
# the sky, it is a bug in the query. (There is an NRTI collection with ~3-hour
# latency, but it is noisier and we do not need it: every window in the detector is
# a 24 h / 7 d / 30 d median, so being a week behind costs us nothing and buys us
# the better-calibrated product.)
S5P_LAG_DAYS = 6


def _init_ee():
    """Authenticate. Application Default Credentials first, key only as a fallback.

    ADC is the preferred path: `gcloud auth application-default login` once, and no
    secret exists to leak, commit, or rotate. (Our project has
    constraints/iam.disableServiceAccountKeyCreation switched on, which forbids
    JSON keys outright — that is Google doing us a favour, not an obstacle.)
    Anything running ON GCP should attach the service account instead, which also
    needs no key.
    """
    import ee

    # 1) Service-account key, if one was explicitly provided (CI, a server). Our
    #    project forbids key creation by org policy, so this is the rare path.
    key = os.environ.get("GEE_SERVICE_ACCOUNT_JSON")
    if key and os.path.exists(key):
        import json
        email = json.loads(open(key).read())["client_email"]
        ee.Initialize(ee.ServiceAccountCredentials(email, key), project=GEE_PROJECT)
        return ee

    # 2) Application Default Credentials — the normal path. Ask for them EXPLICITLY
    #    rather than letting ee.Initialize() go looking: its implicit lookup prefers
    #    Earth Engine's own credential file and, when nothing is there, raises
    #    "run earthengine authenticate" — which sends you down a different auth path
    #    than the one this project actually uses, on a machine that just needs
    #    `gcloud auth application-default login`.
    try:
        import google.auth
        creds, _ = google.auth.default()
        ee.Initialize(credentials=creds, project=GEE_PROJECT)
        return ee
    except Exception as adc_err:
        # 3) Fall back to whatever `earthengine authenticate` may have stored.
        try:
            ee.Initialize(project=GEE_PROJECT)
            return ee
        except Exception:
            raise RuntimeError(
                f"No Earth Engine credentials on this machine (ADC lookup said: "
                f"{type(adc_err).__name__}: {adc_err}).\n\n"
                f"Fix with EITHER:\n"
                f"  gcloud auth application-default login "
                f"--scopes=https://www.googleapis.com/auth/earthengine,"
                f"https://www.googleapis.com/auth/cloud-platform\n"
                f"  gcloud auth application-default set-quota-project {GEE_PROJECT}\n\n"
                f"OR, if you would rather not install gcloud at all:\n"
                f"  python -c \"import ee; ee.Authenticate()\"\n\n"
                f"Then make sure your Google account has roles/earthengine.viewer and\n"
                f"roles/serviceusage.serviceUsageConsumer on project '{GEE_PROJECT}'.\n"
                f"See docs/gcp-setup.md."
            ) from adc_err


def _cell_points(ee):
    """The H3 fabric as an Earth Engine FeatureCollection of cell centroids.

    Centroids, not polygons: a 460 m cell sits well inside a single 1113 m S5P
    grid cell, so averaging over the polygon returns the same pixel value at
    several times the cost.
    """
    cells = city_cells()
    feats = []
    for c in cells:
        lat, lon = cell_center(c)
        feats.append(ee.Feature(ee.Geometry.Point([lon, lat]), {"cell": c}))
    return ee.FeatureCollection(feats), cells


def fetch_satellite(days: int | None = None) -> pd.DataFrame:
    """Per (H3 cell, day) S5P columns for the city bbox.

    Returns the same schema the synthetic satellite emits, so nothing downstream
    knows or cares which one it got: [cell, date, no2_col, so2_col, co_col, aai].
    """
    ee = _init_ee()
    days = days or PANEL_HOURS // 24
    end = pd.Timestamp.utcnow().normalize() - pd.Timedelta(days=S5P_LAG_DAYS)
    start = end - pd.Timedelta(days=days)

    region = ee.Geometry.Rectangle(
        [BBOX["lon_min"], BBOX["lat_min"], BBOX["lon_max"], BBOX["lat_max"]])
    points, cells = _cell_points(ee)

    print(f"[s5p] {len(cells)} cells x {days} days from {start.date()} to {end.date()} "
          f"(project={GEE_PROJECT})")

    frames = []
    for i in range(days):
        d0 = start + pd.Timedelta(days=i)
        d1 = d0 + pd.Timedelta(days=1)

        # One multi-band image per day: mean of whatever passed quality control.
        #
        # The empty case is NOT exotic — it is most days for some products. S5P
        # passes once, clouds block it, and SO2/AAI in particular are often absent
        # entirely. An empty ImageCollection's .mean() is an image with ZERO bands,
        # and .multiply() on that throws. So we substitute a single FULLY MASKED
        # band instead, which is the honest representation: the band exists, the
        # instrument saw nothing, the value is null. reduceRegions then returns no
        # property, pandas makes it NaN, and the panel forward-fills. Never
        # zero-fill: 0.0 is a measurement, and "no observation" is not 0.
        bands = []
        for coll_id, (band, out, scale) in PRODUCTS.items():
            coll = (ee.ImageCollection(coll_id)
                    .filterDate(str(d0.date()), str(d1.date()))
                    .filterBounds(region)
                    .select(band))
            nothing = ee.Image.constant(0).selfMask().rename(out)
            img = ee.Image(ee.Algorithms.If(
                coll.size().gt(0),
                coll.mean().multiply(scale).rename(out),
                nothing))
            bands.append(img)
        daily = ee.Image.cat(bands)

        # Bands are absent entirely on a day with no usable overpass. reduceRegions
        # then simply omits those properties, which pandas turns into NaN — the
        # correct representation of "the satellite did not see this", and what the
        # panel's forward-fill expects. Never zero-fill a missing observation.
        try:
            fc = daily.reduceRegions(collection=points,
                                     reducer=ee.Reducer.mean(),
                                     scale=S5P_SCALE_M)
            rows = fc.getInfo()["features"]
        except Exception as e:
            print(f"[s5p]   {d0.date()}: FAILED ({type(e).__name__}: {e}) — skipping day")
            continue

        recs = []
        for f in rows:
            p = f["properties"]
            recs.append({"cell": p["cell"], "date": d0.normalize(),
                         **{out: p.get(out) for _, (_, out, _) in PRODUCTS.items()}})
        df = pd.DataFrame(recs)
        counts = {out: int(df[out].notna().sum()) if out in df else 0
                  for _, (_, out, _) in PRODUCTS.items()}
        print(f"[s5p]   {d0.date()}: " + "  ".join(f"{k}={v}" for k, v in counts.items())
              + f"  (of {len(cells)} cells)")
        frames.append(df)

    if not frames:
        raise RuntimeError(
            f"S5P returned no data for any day in {start.date()}..{end.date()}.\n"
            f"Most likely the window is too recent: OFFL products lag by several "
            f"days (we already back off {S5P_LAG_DAYS}). Try a window further back.")

    out = pd.concat(frames, ignore_index=True)
    cover = out.no2_col.notna().mean()
    print(f"[s5p] {len(out):,} rows; {cover:.0%} of cell-days have a usable NO2 column")
    if cover < 0.15:
        print("[s5p] WARNING: very sparse coverage. The 24h window will be mostly empty; "
              "7d/30d medians should still hold. Check for a cloudy season.")
    return out


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    df = fetch_satellite(days=n)
    df.to_parquet(DATA_RAW / "satellite.parquet", index=False)
    print(df.describe().round(2).to_string())
