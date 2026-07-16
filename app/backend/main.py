"""Read-only serving API — the app-layer backend.

Heavy compute happens in the batch pipeline; this only reads precomputed
contracts from data/outputs/. Run:

    uvicorn app.backend.main:app --reload --port 8000

Endpoints:
    GET /health
    GET /hotspots                latest ranked hotspots (anomaly + chronic)
    GET /attribution/{cell}      full evidence chain for one hotspot
    GET /attributions            all attributions (summary fields)
    GET /fusion?hour_offset=0    fusion field snapshot (0 = latest hour)
    GET /wards                   cell -> ward map (real boundaries or fallback)
    GET /loso                    fusion validation metrics
"""
import json

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from shared.config import DATA_OUT, DATA_RAW

app = FastAPI(title="AQ Intelligence Platform API", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _json(name: str):
    p = DATA_OUT / name
    if not p.exists():
        raise HTTPException(404, f"{name} not generated yet — run the pipeline first")
    return json.loads(p.read_text())


@app.get("/health")
def health():
    return {"ok": True, "outputs_present": sorted(p.name for p in DATA_OUT.glob("*"))}


@app.get("/hotspots")
def hotspots():
    return _json("hotspots.json")


@app.get("/attributions")
def attributions():
    return [{k: a[k] for k in ("cell", "ward_id", "ts", "primary_source", "confidence", "reason")}
            for a in _json("attributions.json")]


@app.get("/wards")
def wards():
    """cell -> ward map, as WRITTEN BY THE PIPELINE.

    Never recomputed here. The API cannot know which city the data on disk belongs
    to — config.CITY reads an env var the server process may not have — and guessing
    wrong silently maps Delhi cells through a Bengaluru ward table, yielding NaN for
    every ward and a 500 on any endpoint that joins against it.
    """
    return _json("wards.json")


@app.get("/attribution/{cell}")
def attribution(cell: str):
    for a in _json("attributions.json"):
        if a["cell"] == cell:
            return a
    raise HTTPException(404, f"no attribution for cell {cell}")


@app.get("/fusion")
def fusion(hour_offset: int = 0):
    p = DATA_OUT / "fusion_field.parquet"
    if not p.exists():
        raise HTTPException(404, "fusion field not generated yet")
    f = pd.read_parquet(p)
    f["ts"] = pd.to_datetime(f.ts, utc=True)
    hours = sorted(f.ts.unique())
    if not 0 <= hour_offset < len(hours):
        raise HTTPException(400, f"hour_offset must be in [0, {len(hours) - 1}] "
                                 f"(0 = latest hour); got {hour_offset}")
    at = hours[-1 - hour_offset]
    wmap = {c["cell"]: c["ward_id"] for c in _json("wards.json")["cells"]}
    snap = f[f.ts == at].dropna(subset=["pm25_hat"])   # NaN is not valid JSON
    return {"ts": str(at), "n_hours": len(hours),
            "cells": [{"cell": r.cell, "ward_id": wmap.get(r.cell, "unassigned"),
                       "pm25": round(float(r.pm25_hat), 1)}
                      for r in snap.itertuples()]}


@app.get("/loso")
def loso():
    return _json("loso.json")


@app.get("/stations")
def stations():
    """CAAQMS station locations + their latest reading. Feeds the map's station markers."""
    p = DATA_RAW / "stations.parquet"
    if not p.exists():
        raise HTTPException(404, "stations not ingested yet — run the pipeline first")
    df = pd.read_parquet(p)
    df["ts"] = pd.to_datetime(df.ts, utc=True)
    # Real CPCB stations drop readings — NaN is NOT valid JSON and FastAPI raises a
    # 500 on it. Take each station's latest VALID reading, not its latest row.
    df = df.dropna(subset=["pm25"])
    if df.empty:
        return []
    latest = df.sort_values("ts").groupby("station_id").last().reset_index()
    return [{"station_id": r.station_id, "cell": r.cell,
             "lat": float(r.lat), "lon": float(r.lon),
             "pm25": round(float(r.pm25), 1), "ts": str(r.ts)}
            for r in latest.itertuples()]


@app.get("/forecast")
def forecast(h: int | None = None):
    """PM2.5 forecast per cell. ?h=24|48|72 filters to one horizon; omit for all.

    Precomputed in batch (principle 3). Each row: {cell, horizon_h, pm25_hat, urgency}.
    """
    field = _json("forecast.json")
    if h is not None:
        field = [f for f in field if f["horizon_h"] == h]
    return field


@app.get("/forecast/eval")
def forecast_eval():
    """RMSE at each horizon vs persistence + diurnal baselines. The rubric's number."""
    return _json("forecast_eval.json")


@app.get("/memos")
def memos():
    """All drafted enforcement memos (the EPS queue turned into documents)."""
    return _json("memos.json")


@app.get("/memo/{action_id}")
def memo(action_id: str):
    """One memo, with its evidence chain and its legal basis.

    GET, not POST: the memo is PRECOMPUTED by the batch pipeline, like everything
    else this API serves (principle 3 — serving never computes). The frontend's
    "Generate memo" button fetches a document that already exists; it does not
    trigger an LLM call inside a request handler.
    """
    for x in _json("memos.json"):
        if action_id in (x.get("action_id"), x.get("zone_id"), x.get("memo_id")):
            return x
    raise HTTPException(404, f"no memo for {action_id}")


@app.get("/fires")
def fires():
    """FIRMS thermal detections in the window. The instrument that finds burning
    sources directly — and the one that located Bhalswa."""
    p = DATA_RAW / "fires.parquet"
    if not p.exists():
        raise HTTPException(404, "fires not ingested yet — run the pipeline first")
    df = pd.read_parquet(p)
    if df.empty:
        return []
    df["ts"] = pd.to_datetime(df.ts, utc=True)
    return [{"lat": float(r.lat), "lon": float(r.lon),
             "frp": round(float(r.frp), 2), "confidence": str(r.confidence),
             "ts": str(r.ts)}
            for r in df.sort_values("ts").itertuples()]

@app.get("/actions")
def actions():
    """Ranked enforceable hotspots."""
    return _json("actions.json")
@app.get("/dispatch")
def dispatch():
    """Team routes for maximum-coverage dispatch."""
    return _json("dispatch.json")