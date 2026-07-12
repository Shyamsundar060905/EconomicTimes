"""Central configuration. One place to change city, resolution, paths."""
import os
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_RAW = ROOT / "data" / "raw"
DATA_OUT = ROOT / "data" / "outputs"


def _load_dotenv(path: Path = ROOT / ".env") -> None:
    """Populate os.environ from .env. Real env vars always win (CI sets secrets).

    Hand-rolled rather than python-dotenv: six lines, one fewer dependency, and
    the documented workflow ('copy .env.example to .env') has to actually work.
    """
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.split("#")[0].strip().strip("'\"")
        if key and val:
            os.environ.setdefault(key, val)


_load_dotenv()

# ---- City: Bengaluru (swap bbox + ward geojson to change city) ----
CITY = "bengaluru"
BBOX = {"lat_min": 12.85, "lat_max": 13.10, "lon_min": 77.45, "lon_max": 77.75}
WARD_GEOJSON = ROOT / "data" / "BBMP.geojson"   # official ward boundaries

H3_RES = 8            # ~460 m edge -> satisfies "1 km grid" requirement
PANEL_HOURS = 24 * 14 # synthetic/backfill window: 14 days hourly

# Wards: point-in-polygon against WARD_GEOJSON when it exists, else a
# deterministic Voronoi tessellation of the H3 fabric (see shared/wards.py).
# BBMP has 198 wards; the fallback approximates that granularity.
N_FALLBACK_WARDS = 60

# Satellite realism: TROPOMI ground pixels are ~5.5 km, an order of magnitude
# coarser than an H3 res-8 cell. The synthetic satellite is blurred to match,
# so no model can cheat by reading a per-cell truth signal out of the columns.
SAT_BLUR_SIGMA_KM = 2.5

# API endpoints (all free)
OPENAQ_URL = "https://api.openaq.org/v3"
OPENMETEO_URL = "https://api.open-meteo.com/v1/forecast"
FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"  # + /{KEY}/VIIRS_SNPP_NRT/{bbox}/2
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

for d in (DATA_RAW, DATA_OUT):
    d.mkdir(parents=True, exist_ok=True)
