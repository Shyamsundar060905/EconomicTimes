"""Ingestion pollers: real API code with graceful synthetic fallback.

Each poller writes a parquet to data/raw/. Run all:  python -m ingest.pollers
Force offline mode:                                  python -m ingest.pollers --synthetic
Real mode requires: OPENAQ_API_KEY (free), FIRMS_KEY (free, instant email).
Sentinel-5P via Google Earth Engine lives in ingest/sentinel_gee.py (needs
a GEE service account; synthetic satellite is used until that's configured).
"""
import os
import sys
import json
import urllib.request
import urllib.parse

import pandas as pd

from shared.config import BBOX, DATA_RAW, OPENAQ_URL, OPENMETEO_URL, FIRMS_URL, OVERPASS_URL
from shared.grid import latlng_to_cell


def _get(url: str, headers: dict | None = None, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ---------------------------------------------------------------- OpenAQ
def fetch_stations() -> pd.DataFrame:
    """Hourly PM2.5 per CPCB/CAAQMS station inside the bbox, last 14 days."""
    key = os.environ.get("OPENAQ_API_KEY")
    if not key:
        raise RuntimeError("OPENAQ_API_KEY not set")
    headers = {"X-API-Key": key}
    q = urllib.parse.urlencode({
        "bbox": f'{BBOX["lon_min"]},{BBOX["lat_min"]},{BBOX["lon_max"]},{BBOX["lat_max"]}',
        "parameters_id": 2,  # pm25
        "limit": 1000,
    })
    locs = json.loads(_get(f"{OPENAQ_URL}/locations?{q}", headers))["results"]
    rows = []
    for loc in locs:
        sid = loc["id"]
        sens = [s for s in loc.get("sensors", []) if s["parameter"]["name"] == "pm25"]
        if not sens:
            continue
        data = json.loads(_get(
            f"{OPENAQ_URL}/sensors/{sens[0]['id']}/hours?limit=336", headers))["results"]
        for d in data:
            rows.append({
                "station_id": str(sid),
                "ts": pd.Timestamp(d["period"]["datetimeTo"]["utc"]),
                "lat": loc["coordinates"]["latitude"],
                "lon": loc["coordinates"]["longitude"],
                "pm25": d["value"],
            })
    df = pd.DataFrame(rows)
    df["cell"] = [latlng_to_cell(a, b) for a, b in zip(df.lat, df.lon)]
    return df


# ------------------------------------------------------------ Open-Meteo
def fetch_weather() -> pd.DataFrame:
    """Hourly wind, temp, boundary layer height for the city center. Keyless."""
    lat = (BBOX["lat_min"] + BBOX["lat_max"]) / 2
    lon = (BBOX["lon_min"] + BBOX["lon_max"]) / 2
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon,
        "hourly": "wind_speed_10m,wind_direction_10m,temperature_2m,boundary_layer_height",
        "past_days": 14, "forecast_days": 3, "wind_speed_unit": "ms",
    })
    j = json.loads(_get(f"{OPENMETEO_URL}?{q}"))["hourly"]
    return pd.DataFrame({
        "ts": pd.to_datetime(j["time"]),
        "wind_from_deg": j["wind_direction_10m"],
        "wind_ms": j["wind_speed_10m"],
        "blh_m": j["boundary_layer_height"],
        "temp_c": j["temperature_2m"],
    })


# ----------------------------------------------------------------- FIRMS
def fetch_fires() -> pd.DataFrame:
    """VIIRS thermal anomalies in bbox, last 2 days."""
    key = os.environ.get("FIRMS_KEY")
    if not key:
        raise RuntimeError("FIRMS_KEY not set")
    bbox = f'{BBOX["lon_min"]},{BBOX["lat_min"]},{BBOX["lon_max"]},{BBOX["lat_max"]}'
    csv = _get(f"{FIRMS_URL}/{key}/VIIRS_SNPP_NRT/{bbox}/2").decode()
    from io import StringIO
    df = pd.read_csv(StringIO(csv))
    if df.empty:
        return pd.DataFrame(columns=["ts", "lat", "lon", "frp", "confidence"])
    df["ts"] = pd.to_datetime(df.acq_date + " " + df.acq_time.astype(str).str.zfill(4),
                              format="%Y-%m-%d %H%M", utc=True)
    return df.rename(columns={"latitude": "lat", "longitude": "lon"})[
        ["ts", "lat", "lon", "frp", "confidence"]]


# ------------------------------------------------------------------- OSM
def fetch_osm() -> pd.DataFrame:
    """One Overpass bbox query: industry, construction, kilns, trunk roads, schools, hospitals."""
    bbox = f'{BBOX["lat_min"]},{BBOX["lon_min"]},{BBOX["lat_max"]},{BBOX["lon_max"]}'
    query = f"""
    [out:json][timeout:90];
    (
      way["landuse"="industrial"]({bbox});
      way["landuse"="construction"]({bbox});
      node["man_made"="kiln"]({bbox});
      way["landuse"="landfill"]({bbox});
      way["highway"~"trunk|motorway|primary"]({bbox});
      node["amenity"~"school|hospital"]({bbox});
      way["amenity"~"school|hospital"]({bbox});
    );
    out center 4000;
    """
    data = urllib.request.urlopen(
        urllib.request.Request(OVERPASS_URL, data=urllib.parse.urlencode({"data": query}).encode()),
        timeout=120).read()
    rows = []
    for el in json.loads(data)["elements"]:
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None:
            continue
        tags = el.get("tags", {})
        # `traffic` = a named major corridor (an enforceable suspect); `road` =
        # generic network density (a land-use feature, not something you can
        # serve a notice on). The panel and the attribution scorer treat them
        # differently — keep the synthetic schema in ingestion/synthetic.py in step.
        hw = tags.get("highway")
        kind = ("industrial" if tags.get("landuse") == "industrial" else
                "construction" if tags.get("landuse") == "construction" else
                "waste_burning" if tags.get("man_made") == "kiln" or tags.get("landuse") == "landfill" else
                "traffic" if hw in ("motorway", "trunk") else
                "road" if hw else
                tags.get("amenity", "other"))
        rows.append({"name": tags.get("name", f'{kind}_{el["id"]}'), "kind": kind,
                     "tag": ";".join(f"{k}={v}" for k, v in list(tags.items())[:3]),
                     "lat": lat, "lon": lon})
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- runner
REAL = {"stations": fetch_stations, "weather": fetch_weather,
        "fires": fetch_fires, "osm": fetch_osm}


def run(synthetic: bool = False) -> dict:
    out = {}
    if synthetic:
        from ingestion.synthetic import generate_all
        out = generate_all()
        print("[ingest] SYNTHETIC mode — all sources generated from world model")
    else:
        from ingestion.synthetic import generate_all
        synth = None
        for name, fn in REAL.items():
            try:
                out[name] = fn()
                print(f"[ingest] {name}: LIVE ok ({len(out[name])} rows)")
            except Exception as e:
                if synth is None:
                    synth = generate_all()
                out[name] = synth[name]
                print(f"[ingest] {name}: live failed ({type(e).__name__}: {e}) -> synthetic fallback")
        # satellite: GEE handled separately; use synthetic until configured
        if synth is None:
            synth = generate_all()
        out.setdefault("satellite", synth["satellite"])
        if "_truth" in synth:
            out["_truth"] = synth["_truth"]
    for name, df in out.items():
        df.to_parquet(DATA_RAW / f"{name.lstrip('_')}.parquet", index=False)
        print(f"[ingest] wrote data/raw/{name.lstrip('_')}.parquet  {df.shape}")
    return out


if __name__ == "__main__":
    run(synthetic="--synthetic" in sys.argv)
