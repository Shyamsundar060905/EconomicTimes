"""Attribution accuracy vs synthetic ground truth.

The synthetic world knows the TRUE per-category contribution at every cell x
hour (c_industrial, c_construction, ...). For each attributed hotspot, the true
primary source = argmax of those contributions. Judging criteria ask for
"source attribution accuracy versus ground-truth emission inventories" — in
synthetic mode we have a perfect inventory, so we can print that exact number.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

from shared.config import DATA_RAW, DATA_OUT

CONTRIB = {"c_industrial": "industrial", "c_construction": "construction",
           "c_waste_burning": "waste_burning", "c_traffic": "traffic"}


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
            if t.empty:
                continue
            c = t[list(CONTRIB)].astype(float).mean()
        else:
            t = truth[(truth.cell == a["cell"]) & (truth.ts == ts)]
            if t.empty:
                continue
            c = t.iloc[0][list(CONTRIB)].astype(float)
        true_src = CONTRIB[c.idxmax()] if c.max() > 1.0 else "background"
        rows.append({"cell": a["cell"], "predicted": a["primary_source"],
                     "true": true_src, "confidence": a["confidence"],
                     "hit": a["primary_source"] == true_src})
    df = pd.DataFrame(rows)
    scored = df[df.true != "background"]
    acc = scored.hit.mean() if len(scored) else float("nan")
    print(f"[eval] attribution accuracy: {acc:.0%}  ({scored.hit.sum()}/{len(scored)} "
          f"hotspots with a true dominant source)")
    if len(scored):
        print("[eval] mean confidence on hits  :", round(scored[scored.hit].confidence.mean(), 2))
        if (~scored.hit).any():
            print("[eval] mean confidence on misses:", round(scored[~scored.hit].confidence.mean(), 2))
        conf = pd.crosstab(scored.true, scored.predicted)
        print(conf.to_string())


if __name__ == "__main__":
    main()
