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

from shared.config import DATA_OUT
from shared.wards import ward_frame

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
    """cell -> ward map, so the frontend can aggregate any layer to ward level."""
    w = ward_frame()
    return {"synthetic": bool(w.attrs.get("synthetic", True)),
            "n_wards": int(w.ward_id.nunique()),
            "cells": w.to_dict("records")}


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
    snap = f[f.ts == at].merge(ward_frame()[["cell", "ward_id"]], on="cell", how="left")
    return {"ts": str(at), "n_hours": len(hours),
            "cells": [{"cell": r.cell, "ward_id": r.ward_id, "pm25": round(float(r.pm25_hat), 1)}
                      for r in snap.itertuples()]}


@app.get("/loso")
def loso():
    return _json("loso.json")
