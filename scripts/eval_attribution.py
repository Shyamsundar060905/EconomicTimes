"""Attribution accuracy vs synthetic ground truth.

The synthetic world knows the TRUE per-category contribution at every cell x
hour (c_industrial, c_construction, ...) AND which individual hidden source
dominated it. For each attributed hotspot, the true primary source = argmax of
those contributions. Judging criteria ask for "source attribution accuracy
versus ground-truth emission inventories" — in synthetic mode we have a perfect
inventory, so we can print that exact number.

Reported as TWO numbers, because they are two different claims:

  REGISTERED   — the dominant source is on the map (with a ~250 m position error,
                 among decoy sites that emit nothing). Attribution has a named
                 candidate to find, and must pick it out of the decoys.
  UNREGISTERED — the dominant source appears in NO map layer: illegal landfill
                 burning, an unpermitted crusher. There is nothing to match
                 against; the category must be recovered from pollutant signature
                 and fire evidence alone.

The unregistered number is the honest one, and the one the old answer-key
synthetic world could not have produced — there, every source was in OSM with
its true label and true coordinates.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

from shared.config import DATA_RAW, DATA_OUT

CONTRIB = {"c_industrial": "industrial", "c_construction": "construction",
           "c_waste_burning": "waste_burning", "c_traffic": "traffic"}
MIN_DOMINANT = 1.0   # below this the cell is just background; nothing to attribute


def _truth_for(t: pd.DataFrame) -> tuple[str, bool] | None:
    """(true dominant category, was that source on the map?) for a slice of truth."""
    c = t[list(CONTRIB)].astype(float).mean()
    if c.max() <= MIN_DOMINANT:
        return None                                   # background cell
    kind = CONTRIB[c.idxmax()]
    # Which individual source drove it? Whichever accumulated the most dominance
    # over the slice; its `registered` flag says whether attribution had a
    # candidate to match against at all.
    winners = t[t.top_source != "none"].groupby("top_source").top_source_val.sum()
    if winners.empty:
        return kind, False
    top = winners.idxmax()
    registered = bool(t.loc[t.top_source == top, "top_source_registered"].iloc[0])
    return kind, registered


def main():
    attrs = json.loads((DATA_OUT / "attributions.json").read_text())
    if not attrs:
        print("[eval] no attributions to score")
        return
    truth = pd.read_parquet(DATA_RAW / "truth.parquet")
    truth["ts"] = pd.to_datetime(truth.ts, utc=True)

    rows = []
    for a in attrs:
        ts = pd.Timestamp(a["ts"])
        if a.get("evidence", {}).get("hotspot_kind") == "chronic":
            t = truth[(truth.cell == a["cell"]) & (truth.ts > ts - pd.Timedelta(days=7))]
        else:
            t = truth[(truth.cell == a["cell"]) & (truth.ts == ts)]
        if t.empty:
            continue
        got = _truth_for(t)
        if got is None:
            continue
        true_src, registered = got
        rows.append({"cell": a["cell"], "predicted": a["primary_source"], "true": true_src,
                     "registered": registered, "confidence": a["confidence"],
                     "hit": a["primary_source"] == true_src})

    df = pd.DataFrame(rows)
    if df.empty:
        print("[eval] no hotspots with a true dominant source")
        return

    def report(label: str, d: pd.DataFrame):
        if d.empty:
            print(f"[eval] {label:<24} n=0")
            return
        print(f"[eval] {label:<24} {d.hit.mean():>5.0%}  ({d.hit.sum()}/{len(d)})")

    print(f"[eval] scored {len(df)} hotspots with a true dominant source")
    report("OVERALL accuracy", df)
    report("  registered sources", df[df.registered])
    report("  UNREGISTERED sources", df[~df.registered])
    print()
    print("[eval] mean confidence on hits  :", round(df[df.hit].confidence.mean(), 2)
          if df.hit.any() else "n/a")
    if (~df.hit).any():
        print("[eval] mean confidence on misses:", round(df[~df.hit].confidence.mean(), 2))
    print()
    print("[eval] confusion (rows = truth, cols = predicted)")
    print(pd.crosstab(df.true, df.predicted).to_string())


if __name__ == "__main__":
    main()
