"""The money stat: does the fusion field recover hotspots that naive
station-interpolation misses? Only computable in synthetic mode (we know truth).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import pandas as pd
from sklearn.metrics import mean_squared_error

from shared.config import DATA_RAW, DATA_OUT


def main():
    truth = pd.read_parquet(DATA_RAW / "truth.parquet")[["cell", "ts", "pm25_true"]]
    field = pd.read_parquet(DATA_OUT / "fusion_field.parquet")
    stations = pd.read_parquet(DATA_RAW / "stations.parquet")
    truth["ts"] = pd.to_datetime(truth.ts, utc=True)
    field["ts"] = pd.to_datetime(field.ts, utc=True)
    stations["ts"] = pd.to_datetime(stations.ts, utc=True)

    df = truth.merge(field, on=["cell", "ts"], how="inner")
    # naive baseline: every cell = mean of all stations at that hour (what a
    # station-only dashboard effectively shows citywide)
    city_mean = stations.groupby("ts").pm25.mean().rename("pm25_naive")
    df = df.join(city_mean, on="ts")

    def rmse(a, b):
        return float(np.sqrt(mean_squared_error(a, b)))

    overall_f = rmse(df.pm25_true, df.pm25_hat)
    overall_n = rmse(df.pm25_true, df.pm25_naive)

    # hotspot slice: top 10% most-polluted (cell,hour) rows by TRUE pm2.5
    hot = df[df.pm25_true >= df.pm25_true.quantile(0.90)]
    hot_f = rmse(hot.pm25_true, hot.pm25_hat)
    hot_n = rmse(hot.pm25_true, hot.pm25_naive)
    bias_f = float((hot.pm25_hat - hot.pm25_true).mean())
    bias_n = float((hot.pm25_naive - hot.pm25_true).mean())

    print(f"ALL cells x hours   : fusion RMSE {overall_f:6.2f}  | naive station-mean RMSE {overall_n:6.2f}")
    print(f"HOTSPOTS (top 10%)  : fusion RMSE {hot_f:6.2f}  | naive station-mean RMSE {hot_n:6.2f}")
    print(f"HOTSPOT bias        : fusion {bias_f:+6.1f} ug/m3 | naive {bias_n:+6.1f} ug/m3  (negative = understates)")
    print(f"-> naive interpolation understates hotspots by {abs(bias_n):.0f} ug/m3 on average; "
          f"fusion cuts hotspot error by {100*(1-hot_f/hot_n):.0f}%")


if __name__ == "__main__":
    main()
