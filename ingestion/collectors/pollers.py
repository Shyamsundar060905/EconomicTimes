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
import time
import urllib.request
import urllib.parse

import pandas as pd

from shared.config import (BBOX, DATA_RAW, OPENAQ_URL, OPENMETEO_URL,
                           OPENMETEO_ARCHIVE_URL, FIRMS_URL, OVERPASS_URL,
                           PANEL_HOURS, window_end)
from shared.grid import latlng_to_cell


def _get(url: str, headers: dict | None = None, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ---------------------------------------------------------------- OpenAQ
OPENAQ_PAGE = 1000   # API hard cap per page


def fetch_stations(days: int | None = None) -> pd.DataFrame:
    """Hourly PM2.5 per CPCB/CAAQMS station in the bbox, over the WHOLE panel window.

    This used to ask for `limit=336` — 14 days — while the panel spans 60. Since
    build_panel() takes the INTERSECTION of station hours and weather hours, that
    silently truncated the entire panel to 14 days, which would have emptied the
    30-day detection window and made every chronic source disappear. Same bug as
    FIRMS' 2-day window, in a different collector.

    OpenAQ caps a page at 1000 rows, so a 60-day (1440 h) pull needs paging.
    """
    key = os.environ.get("OPENAQ_API_KEY")
    if not key:
        raise RuntimeError("OPENAQ_API_KEY not set — get one free at "
                           "https://explore.openaq.org/register")
    days = days or PANEL_HOURS // 24
    headers = {"X-API-Key": key}
    q = urllib.parse.urlencode({
        "bbox": f'{BBOX["lon_min"]},{BBOX["lat_min"]},{BBOX["lon_max"]},{BBOX["lat_max"]}',
        "parameters_id": 2,  # pm25
        "limit": 1000,
    })
    locs = json.loads(_get(f"{OPENAQ_URL}/locations?{q}", headers))["results"]

    end = window_end()
    start = end - pd.Timedelta(days=days)
    rows = []
    for loc in locs:
        sid = loc["id"]
        sens = [s for s in loc.get("sensors", []) if s["parameter"]["name"] == "pm25"]
        if not sens:
            continue
        # One flaky sensor must not sink the whole city. OpenAQ intermittently 500s on
        # a single sensor's history; retry a few times, then SKIP that sensor rather
        # than aborting the collector. A run with 25 of 27 stations is a degraded
        # panel; a run with zero is a dead pipeline. (This was silently killing every
        # live Delhi run — fetch_stations is the first thing ingest does.)
        page, failed = 1, False
        while True:
            sq = urllib.parse.urlencode({
                "datetime_from": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "datetime_to": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "limit": OPENAQ_PAGE, "page": page,
            })
            res = None
            for attempt in range(4):
                try:
                    res = json.loads(_get(
                        f"{OPENAQ_URL}/sensors/{sens[0]['id']}/hours?{sq}", headers))["results"]
                    break
                except Exception as e:
                    if attempt == 3:
                        print(f"[openaq] sensor {sens[0]['id']} page {page} failed "
                              f"({type(e).__name__}); skipping this sensor")
                        failed = True
                        break
                    time.sleep(2 * (attempt + 1))
            if res is None:
                break
            for d in res:
                rows.append({
                    "station_id": str(sid),
                    "ts": pd.Timestamp(d["period"]["datetimeTo"]["utc"]),
                    "lat": loc["coordinates"]["latitude"],
                    "lon": loc["coordinates"]["longitude"],
                    "pm25": d["value"],
                })
            if len(res) < OPENAQ_PAGE:
                break
            page += 1
        _ = failed

    df = pd.DataFrame(rows)
    if df.empty:
        raise RuntimeError(f"OpenAQ returned no PM2.5 readings for {len(locs)} "
                           f"locations in the bbox over {days} days")
    df["cell"] = [latlng_to_cell(a, b) for a, b in zip(df.lat, df.lon)]
    print(f"[openaq] {df.station_id.nunique()} stations, {len(df):,} hourly readings "
          f"over {days} days")
    return df


# ------------------------------------------------------------ Open-Meteo
def fetch_weather(days: int | None = None) -> pd.DataFrame:
    """Hourly wind, temp, boundary layer height for the city centre. Keyless.

    Must cover the SAME window as the stations: build_panel() intersects the two,
    so whichever is shorter silently truncates the panel. `past_days` was 14 while
    the panel spans 60. (Open-Meteo allows up to 92.)
    """
    days = days or PANEL_HOURS // 24
    lat = (BBOX["lat_min"] + BBOX["lat_max"]) / 2
    lon = (BBOX["lon_min"] + BBOX["lon_max"]) / 2
    end = window_end()
    start = end - pd.Timedelta(days=days)

    # The forecast endpoint only reaches ~92 days back. A historical episode needs
    # the ERA5 archive, which is a different host entirely — and still carries
    # boundary_layer_height, which is the single strongest meteorological predictor
    # we have (a shallow boundary layer traps everything).
    historical = (pd.Timestamp.now("UTC").normalize() - end).days > 60
    if historical:
        q = urllib.parse.urlencode({
            "latitude": lat, "longitude": lon,
            "start_date": str(start.date()), "end_date": str(end.date()),
            "hourly": "wind_speed_10m,wind_direction_10m,temperature_2m,boundary_layer_height",
            "wind_speed_unit": "ms",
        })
        url = f"{OPENMETEO_ARCHIVE_URL}?{q}"
    else:
        q = urllib.parse.urlencode({
            "latitude": lat, "longitude": lon,
            "hourly": "wind_speed_10m,wind_direction_10m,temperature_2m,boundary_layer_height",
            "past_days": min(days, 92), "forecast_days": 3, "wind_speed_unit": "ms",
        })
        url = f"{OPENMETEO_URL}?{q}"
    j = json.loads(_get(url, timeout=90))["hourly"]
    return pd.DataFrame({
        "ts": pd.to_datetime(j["time"]),
        "wind_from_deg": j["wind_direction_10m"],
        "wind_ms": j["wind_speed_10m"],
        "blh_m": j["boundary_layer_height"],
        "temp_c": j["temperature_2m"],
    })


# ----------------------------------------------------------------- FIRMS
# The API enforces this and says so plainly: "Invalid day range. Expects [1..5]".
# The web form's dropdown offers more, which is misleading. 60 days = 12 calls,
# against a quota of 5000 per 10 minutes, so the chunking costs us nothing.
FIRMS_MAX_DAY_RANGE = 5
FIRMS_SOURCE = "VIIRS_SNPP_NRT"          # last ~2 months only
FIRMS_ARCHIVE_SOURCE = "VIIRS_SNPP_SP"   # reprocessed archive, for older windows


def fetch_fires(days: int | None = None) -> pd.DataFrame:
    """VIIRS thermal anomalies in the bbox, over the WHOLE panel window.

    This used to request 2 days, which would have quietly destroyed the detector on
    real data. Fire PERSISTENCE is the signal — the fraction of a 24h/7d/30d window
    that a cell was burning — and it is what separates a landfill that burns every
    night (chronic; build a case file) from one bonfire (acute; send a truck). It is
    also what locates the unregistered burning sources that are our headline result,
    since they appear on no map at all.

    With 2 days of history the 7d and 30d fire channels are empty, every chronic
    burning source silently disappears, and nothing anywhere says why.

    The FIRMS area API caps DAY_RANGE at 10, so we walk the window in chunks using
    the /[DATE] form, which returns DATE .. DATE+DAY_RANGE-1.
    """
    from io import StringIO

    key = os.environ.get("FIRMS_KEY")
    if not key:
        raise RuntimeError("FIRMS_KEY not set — get one free at "
                           "https://firms.modaps.eosdis.nasa.gov/api/map_key/")
    days = days or PANEL_HOURS // 24
    bbox = f'{BBOX["lon_min"]},{BBOX["lat_min"]},{BBOX["lon_max"]},{BBOX["lat_max"]}'
    end = window_end()
    start = end - pd.Timedelta(days=days)

    # NRT ("near real time") only covers roughly the last two months. Anything older
    # lives in SP ("standard processing"), the reprocessed archive. Asking NRT for a
    # date outside its retention returns an empty CSV rather than an error — i.e. it
    # looks exactly like "no fires", which is the single most dangerous failure mode
    # in this collector: a burning season would come back silent and clean.
    age_days = (pd.Timestamp.now("UTC").normalize() - end).days
    source = FIRMS_SOURCE if age_days < 55 else FIRMS_ARCHIVE_SOURCE
    print(f"[firms] {source} | {start.date()} .. {end.date()} ({days}d)")

    frames, day = [], start
    while day < end:
        chunk = min(FIRMS_MAX_DAY_RANGE, (end - day).days)
        url = f"{FIRMS_URL}/{key}/{source}/{bbox}/{chunk}/{day.date()}"
        text = _get(url, timeout=60).decode()
        # FIRMS can return a plain-text error body with HTTP 200 (e.g. an invalid
        # key), which pandas would happily parse into a garbage frame. Validate on
        # the real header — the /area endpoint leads with `latitude,longitude`
        # (NOT `country_id`, which is the /country endpoint's schema).
        if "acq_date" not in text.split("\n", 1)[0]:
            head = text.strip().splitlines()[0][:120] if text.strip() else "(empty)"
            raise RuntimeError(f"FIRMS returned an error, not CSV: {head}")
        part = pd.read_csv(StringIO(text))
        if not part.empty:
            frames.append(part)
        print(f"[firms] {day.date()} +{chunk}d: {len(part)} detections")
        day += pd.Timedelta(days=chunk)

    cols = ["ts", "lat", "lon", "frp", "confidence"]
    if not frames:
        return pd.DataFrame(columns=cols)
    df = pd.concat(frames, ignore_index=True)
    df["ts"] = pd.to_datetime(df.acq_date + " " + df.acq_time.astype(str).str.zfill(4),
                              format="%Y-%m-%d %H%M", utc=True)
    return df.rename(columns={"latitude": "lat", "longitude": "lon"})[cols]


# ------------------------------------------------------------------- OSM
# Public Overpass instances are free, shared, and rate-limited. One 504 is not
# evidence that a city has no industry.
OVERPASS_MIRRORS = [
    OVERPASS_URL,
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
]


def fetch_osm() -> pd.DataFrame:
    """One Overpass bbox query: industry, construction, kilns, trunk roads, schools, hospitals."""
    bbox = f'{BBOX["lat_min"]},{BBOX["lon_min"]},{BBOX["lat_max"]},{BBOX["lon_max"]}'
    # NOTE ON THE OUTPUT LIMIT: this used to end `out center 4000;`, and a real
    # Bengaluru fetch returns ~3,900 features — i.e. it was pinned against the cap
    # and silently truncating, with *which* features survived decided by whatever
    # Overpass happened to emit first. A missing industrial polygon is a source
    # attribution can never name. Uncapped.
    #
    # The amenity regex is anchored: `~"school|hospital"` is a substring match and
    # was pulling in driving_school, music_school, dancing_school... A driving
    # school is not a room full of children, and this layer feeds the vulnerability
    # term that decides whether a hotspot outranks another one.
    query = f"""
    [out:json][timeout:180];
    (
      way["landuse"="industrial"]({bbox});
      way["landuse"="construction"]({bbox});
      node["man_made"="kiln"]({bbox});
      way["landuse"="landfill"]({bbox});
      way["highway"~"^(trunk|motorway|primary)$"]({bbox});
      node["amenity"~"^(school|hospital)$"]({bbox});
      way["amenity"~"^(school|hospital)$"]({bbox});
    );
    out center;
    """
    # Overpass returns 406 Not Acceptable to a request with no User-Agent. urllib's
    # default ("Python-urllib/3.x") is rejected outright, which is why this quietly
    # fell back to synthetic OSM on every live run.
    #
    # It also 504s under load — reliably so on a city the size of Delhi, where the
    # uncapped query is heavy. The public instance is a shared free service and
    # owes us nothing, so we retry across mirrors rather than treat one bad minute
    # as "this city has no factories". Failing here is NOT allowed to fall back to
    # synthetic (see NO_FALLBACK), so it has to actually succeed.
    elements, last = None, None
    for attempt, endpoint in enumerate(OVERPASS_MIRRORS * 2):
        try:
            req = urllib.request.Request(
                endpoint,
                data=urllib.parse.urlencode({"data": query}).encode(),
                headers={"User-Agent": "aq-intelligence-platform/0.1 (civic air quality research)",
                         "Accept": "application/json"})
            got = json.loads(urllib.request.urlopen(req, timeout=300).read())["elements"]
            # A loaded mirror returns 200 with an EMPTY element list rather than an
            # error. Accepting that writes a city with no industry in it, silently.
            # An empty answer is not an answer.
            if not got:
                raise RuntimeError("200 OK but zero elements")
            elements = got
            break
        except Exception as e:                       # 504/429/timeout/empty: next mirror
            last = e
            print(f"[osm] {endpoint.split('/')[2]} failed ({type(e).__name__}: {e}); "
                  f"trying next mirror")
            time.sleep(3 * (attempt + 1))
    if elements is None:
        raise RuntimeError(f"all Overpass mirrors failed or returned nothing; last: {last}")
    rows = []
    for el in elements:
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
def fetch_s5p() -> pd.DataFrame:
    from ingestion.collectors.sentinel import fetch_satellite
    return fetch_satellite()


REAL = {"stations": fetch_stations, "weather": fetch_weather,
        "fires": fetch_fires, "osm": fetch_osm, "satellite": fetch_s5p}

# Sources that may NOT silently degrade to synthetic in live mode, and why.
#
# The test is not "is this source important" — it is "would a synthetic version of
# this INVENT A PLACE that we would then accuse". Anything feeding detection or
# attribution names locations, and a fabricated location becomes a real inspector
# knocking on a real door.
#
# `stations` is deliberately NOT on this list: it feeds the fusion EXPOSURE map, not
# the detector, so a synthetic station degrades an estimate rather than fabricating
# an accusation. It still warns.
NO_FALLBACK = {
    "satellite": "Detection runs on satellite NO2 contrast. A synthetic satellite "
                 "carries nine invented sources at invented coordinates.",
    "fires":     "FIRMS fire persistence is HALF the detector, and it is what locates "
                 "the unregistered burning sources — our headline result. Synthetic "
                 "fires are invented fires at invented coordinates.",
    "osm":       "OSM supplies the named candidates attribution accuses, and decides "
                 "whether a zone is enforceable at all. Synthetic OSM is a list of "
                 "factories that do not exist.",
}


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
                df = fn()
                # AN EMPTY CRITICAL SOURCE IS AS DANGEROUS AS A FAILED ONE, and it
                # does not raise. A public Overpass mirror under load will happily
                # return HTTP 200 with an empty element list; we then wrote a
                # zero-row OSM layer, and the whole run proceeded as if the city
                # contained no industry at all. Treat "succeeded with nothing" as
                # the failure it is.
                if name in NO_FALLBACK and len(df) == 0:
                    raise RuntimeError("returned ZERO rows (the request succeeded "
                                       "but the payload was empty)")
                out[name] = df
                print(f"[ingest] {name}: LIVE ok ({len(df):,} rows)")
            except Exception as e:
                # The SATELLITE is not allowed to fall back. Every other source can
                # degrade to synthetic and still leave a coherent (if partly
                # simulated) world. The satellite cannot, for two reasons:
                #
                #   1. Detection runs ENTIRELY on it. A synthetic satellite carries
                #      nine invented sources at invented coordinates. Joined to real
                #      stations, the pipeline would confidently name polluters that
                #      do not exist, in a real city, on a real map. That is not a
                #      degraded output — it is a fabricated one.
                #   2. The units differ by six orders of magnitude (mol/m^2 vs the
                #      synthetic world's arbitrary scale), so the mixture is not even
                #      internally consistent.
                #
                # Failing loudly is the only honest option. Use --synthetic to run
                # the whole world offline, which is coherent, or fix GEE auth.
                if name in NO_FALLBACK:
                    raise RuntimeError(
                        f"{name} fetch failed in LIVE mode ({type(e).__name__}: {e}).\n\n"
                        f"REFUSING to substitute synthetic {name}. {NO_FALLBACK[name]}\n\n"
                        f"Substituting it would mean naming polluters that do not exist, "
                        f"in a real city, on a real map — a fabricated output, not a "
                        f"degraded one.\n"
                        f"Fix the source, or run the whole world offline with --synthetic "
                        f"(which is coherent, because everything in it is invented "
                        f"together)."
                    ) from e
                if synth is None:
                    synth = generate_all()
                out[name] = synth[name]
                print(f"[ingest] {name}: live failed ({type(e).__name__}: {e}) -> synthetic fallback")

    for name, df in out.items():
        df.to_parquet(DATA_RAW / f"{name.lstrip('_')}.parquet", index=False)
        print(f"[ingest] wrote data/raw/{name.lstrip('_')}.parquet  {df.shape}")
    return out


if __name__ == "__main__":
    run(synthetic="--synthetic" in sys.argv)
