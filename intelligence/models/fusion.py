"""Coverage-debiased fusion field.

Train on cells that HAVE a station (features -> measured PM2.5), predict every
cell citywide. Headline rigor number: leave-one-station-out (LOSO) validation —
hide each station entirely, predict its cell from the others, report the error.

Outputs:
  data/outputs/fusion_field.parquet   per (cell, hour): pm25_hat
  data/outputs/loso.json              per-station and overall LOSO metrics
  data/outputs/fusion_model.txt       trained LightGBM model
"""
import json

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import mean_squared_error, r2_score

from shared.config import DATA_OUT

FEATURES = ["no2_col", "so2_col", "aai",                 # satellite
            "wind_from_deg", "wind_ms", "blh_m", "temp_c",  # meteorology
            "fires_6h", "frp_6h",                         # fire activity
            "lu_industrial", "lu_construction", "lu_waste_burning", "lu_traffic",  # land use
            "lu_road",                                    # road density: the spatial background proxy
            "hour", "dow"]                                # time
LABEL = "pm25_station"
PARAMS = dict(objective="regression", metric="rmse", num_leaves=63,
              learning_rate=0.06, feature_fraction=0.9, bagging_fraction=0.8,
              bagging_freq=1, min_data_in_leaf=40, verbose=-1)


def _train(df: pd.DataFrame, rounds: int = 400) -> lgb.Booster:
    ds = lgb.Dataset(df[FEATURES], label=df[LABEL])
    return lgb.train(PARAMS, ds, num_boost_round=rounds)


def loso_validation(panel: pd.DataFrame) -> dict:
    """Leave-one-station-out: the honest test of citywide generalization."""
    labeled = panel[panel[LABEL].notna()]
    stations = sorted(labeled.cell.unique())
    per_station, all_true, all_pred = {}, [], []
    for held_out in stations:
        train = labeled[labeled.cell != held_out]
        test = labeled[labeled.cell == held_out]
        model = _train(train, rounds=250)
        pred = model.predict(test[FEATURES])
        rmse = float(np.sqrt(mean_squared_error(test[LABEL], pred)))
        r2 = float(r2_score(test[LABEL], pred))
        per_station[held_out] = {"rmse": round(rmse, 2), "r2": round(r2, 3), "n": len(test)}
        all_true.extend(test[LABEL]); all_pred.extend(pred)
    overall = {
        "rmse": round(float(np.sqrt(mean_squared_error(all_true, all_pred))), 2),
        "r2": round(float(r2_score(all_true, all_pred)), 3),
        "n_stations": len(stations),
        "mean_pm25": round(float(np.mean(all_true)), 1),
    }
    # naive-interpolation strawman for comparison: predict city-mean of other stations at each hour
    labeled_h = labeled.set_index(["ts", "cell"])[LABEL]
    naive_true, naive_pred = [], []
    for held_out in stations:
        test = labeled[labeled.cell == held_out]
        others = labeled[labeled.cell != held_out].groupby("ts")[LABEL].mean()
        m = test.ts.map(others)
        ok = m.notna()
        naive_true.extend(test[LABEL][ok]); naive_pred.extend(m[ok])
    overall["naive_citymean_rmse"] = round(float(np.sqrt(mean_squared_error(naive_true, naive_pred))), 2)
    return {"overall": overall, "per_station": per_station}


def run():
    panel = pd.read_parquet(DATA_OUT / "panel.parquet")

    print("[fusion] running leave-one-station-out validation ...")
    loso = loso_validation(panel)
    (DATA_OUT / "loso.json").write_text(json.dumps(loso, indent=2))
    o = loso["overall"]
    print(f"[fusion] LOSO  RMSE={o['rmse']}  R2={o['r2']}  "
          f"(naive city-mean RMSE={o['naive_citymean_rmse']}, mean PM2.5={o['mean_pm25']}, "
          f"{o['n_stations']} stations)")

    print("[fusion] training final model on all stations, predicting all cells ...")
    labeled = panel[panel[LABEL].notna()]
    model = _train(labeled)
    model.save_model(str(DATA_OUT / "fusion_model.txt"))

    field = panel[["cell", "ts"]].copy()
    field["pm25_hat"] = model.predict(panel[FEATURES])
    field.to_parquet(DATA_OUT / "fusion_field.parquet", index=False)

    imp = pd.Series(model.feature_importance("gain"), index=FEATURES).sort_values(ascending=False)
    print("[fusion] top features:", ", ".join(f"{k}({v:.0f})" for k, v in imp.head(5).items()))
    print(f"[fusion] wrote fusion_field.parquet ({len(field):,} rows)")
    return field, loso


if __name__ == "__main__":
    run()
