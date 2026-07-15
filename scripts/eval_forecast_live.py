"""Real-city forecast number without the full GEE pipeline.

The forecast RMSE-vs-persistence metric is scored at STATIONS only, and stations need
just two collectors — OpenAQ (pm25) + Open-Meteo (met) — neither of which touches
GEE. So we can measure the honest Delhi number in ~1 minute instead of a 15-minute
satellite pipeline. Set AQ_CITY / AQ_WINDOW_END as usual.
"""
import sys, warnings
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
warnings.filterwarnings("ignore")
import pandas as pd
from shared.config import CITY, window_end
from ingestion.collectors.pollers import fetch_stations, fetch_weather
from intelligence.models.forecast import evaluate, HORIZONS, TEST_TAIL_DAYS

st = fetch_stations()
wx = fetch_weather()
st["ts"] = pd.to_datetime(st.ts, utc=True).dt.floor("h")
wx["ts"] = pd.to_datetime(wx.ts, utc=True).dt.floor("h")
# minimal panel: one row per (station cell, hour) with pm25_station + met
sta = st.groupby(["cell", "ts"], as_index=False).pm25.mean().rename(columns={"pm25": "pm25_station"})
panel = sta.merge(wx, on="ts", how="left")
for c in ["lu_road", "lu_industrial", "lu_traffic"]:
    panel[c] = 0
print(f"[{CITY}] {panel.cell.nunique()} stations, {len(panel):,} station-hours, "
      f"window ends {window_end().date()}")

ev = evaluate(panel)
print("=" * 74)
print(f"PM2.5 FORECAST — REAL {CITY.upper()} — RMSE vs persistence "
      f"(last {TEST_TAIL_DAYS} days held out)")
print("=" * 74)
print(f"{'horizon':<9}{'model':>9}{'persistence':>14}{'diurnal':>11}{'vs persist':>12}{'vs diurnal':>12}")
for h in HORIZONS:
    r = ev.get(f"h{h}", {})
    if "rmse_model" not in r:
        print(f"{h}h  {r.get('note','n/a')}  (n_test={r.get('n_test')})"); continue
    print(f"{h}h{'':<6}{r['rmse_model']:>9}{r['rmse_persistence']:>14}{r['rmse_diurnal']:>11}"
          f"{r['skill_vs_persistence_pct']:>11.0f}%{r['skill_vs_diurnal_pct']:>11.0f}%")
print("=" * 74)
