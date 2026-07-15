"""Enforcement Priority Score & Dispatch Agent.

Calculates the deterministic Enforcement Priority Score (EPS) for each enforceable
zone, and routes inspection teams using a greedy maximum-coverage algorithm.
"""
import json
import math
import pandas as pd
from typing import Dict, List, Any

import sys
from pathlib import Path
# Add project root to path so `shared` can be imported when run directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from shared.config import DATA_OUT, BBOX
from shared.grid import cell_center, haversine_km

COVER_RADIUS_KM = 2.0


def calculate_eps(zone_cells: List[Dict], attributions: Dict[str, Dict], panel: pd.DataFrame) -> Dict[str, Any]:
    """Calculate the deterministic EPS for a given zone.
    
    EPS = 100 * (0.35*severity + 0.25*attribution_conf + 0.20*actionability + 0.20*vulnerability)
    """
    # Max severity over the zone's cells
    severity = max(cell.get("severity", 0.0) for cell in zone_cells)
    
    # Kind and locatability
    kind = zone_cells[0].get("kind", "chronic")
    kind_weight = {"acute": 1.0, "emerging": 0.8, "chronic": 0.6}.get(kind, 0.6)
    
    nearest_candidate_km = min(cell.get("nearest_candidate_km", 99.0) for cell in zone_cells)
    locatable = 1.0 if nearest_candidate_km <= 3.0 else 0.6
    
    attributable = zone_cells[0].get("attributable", True)
    base = 1.0 if attributable else 0.0
    actionability = base * kind_weight * locatable
    
    # Attribution confidence
    cell_ids = [c["cell"] for c in zone_cells]
    confidences = [attributions.get(cid, {}).get("confidence", 0.0) for cid in cell_ids]
    attribution_conf = max(confidences) if confidences else 0.0
    
    # Vulnerability (max over the zone's cells from panel.parquet)
    # count of schools/hospitals within 1.5 km (lu_sensitive)
    if not panel.empty and "lu_sensitive" in panel.columns:
        zone_panel = panel[panel.cell.isin(cell_ids)]
        if not zone_panel.empty:
            max_sensitive = zone_panel["lu_sensitive"].max()
            vulnerability = min(max_sensitive / 5.0, 1.0)
        else:
            vulnerability = 0.0
    else:
        vulnerability = 0.0
        
    # Not available: forecast
    FORECAST_WEIGHT = 0.0
    forecast_delta = 0.0
    
    severity_term = max(0.0, min(severity + FORECAST_WEIGHT * forecast_delta, 1.0))
    
    eps = 100.0 * (0.35 * severity_term + 
                   0.25 * attribution_conf + 
                   0.20 * actionability + 
                   0.20 * vulnerability)
    
    components = {
        "severity": round(severity_term, 3),
        "attribution_conf": round(attribution_conf, 3),
        "actionability": round(actionability, 3),
        "vulnerability": round(vulnerability, 3)
    }
    
    weighted_sum = (0.35 * components["severity"] + 
                    0.25 * components["attribution_conf"] + 
                    0.20 * components["actionability"] + 
                    0.20 * components["vulnerability"])
    assert math.isclose(weighted_sum * 100, eps, abs_tol=1.0), "EPS components do not sum to EPS"    
    return {"eps": round(eps, 1), "components": components}


def run_dispatch(actions: List[Dict], all_hotspots: List[Dict], n_teams: int, stop_budget: int) -> List[Dict]:
    """Maximum-coverage set cover for dispatch."""
    # Citywide burden (sum of severity across all hotspot cells)
    citywide_burden = sum(h.get("severity", 0.0) for h in all_hotspots)
    if citywide_burden == 0:
        return []

    # Candidates: centroids of the enforceable zones
    candidates = []
    for a in actions:
        candidates.append({
            "action_id": a["action_id"],
            "zone_id": a["zone_id"],
            "ward_id": a["ward_id"],
            "eps": a["eps"],
            "lat": a["centroid"]["lat"],
            "lon": a["centroid"]["lon"],
            "covered_burden": 0.0,
            "covered_cells": set()
        })
        
    # Cells to cover (using severity as burden, weighted by EPS of the covering action?
    # Spec: "A stop covers the EPS-weighted burden of every hotspot cell within 0.4km"
    # Let's say burden of cell = cell.severity. covered by a stop = cell.severity * stop.eps
    
    # We need to repeatedly take the stop that adds the most uncovered burden
    selected_stops = []
    covered_cells = set()
    
    for _ in range(stop_budget):
        best_candidate = None
        best_marginal_coverage = -1.0
        best_newly_covered = set()
        
        for cand in candidates:
            if cand in selected_stops:
                continue
                
            marginal_coverage = 0.0
            newly_covered = set()
            
            for h in all_hotspots:
                cid = h["cell"]
                if cid in covered_cells:
                    continue
                
                h_lat, h_lon = cell_center(cid)
                if haversine_km(cand["lat"], cand["lon"], h_lat, h_lon) <= COVER_RADIUS_KM:
                    # The spec says "EPS-weighted burden of every hotspot cell"
                    # Here we use cell severity * (cand.eps / 100) as the burden value covered
                    burden = h.get("severity", 0.0) * (cand["eps"] / 100.0)
                    marginal_coverage += burden
                    newly_covered.add(cid)
                    
            if marginal_coverage > best_marginal_coverage:
                best_marginal_coverage = marginal_coverage
                best_candidate = cand
                best_newly_covered = newly_covered
                
        if best_candidate and best_marginal_coverage > 0:
            selected_stops.append(best_candidate)
            covered_cells.update(best_newly_covered)
        else:
            break
            
    # Calculate total coverage_pct
    # "covered burden / total citywide burden"
    # To be precise, if we use eps-weighted for selection, the final pct can just be the sum of covered cells' severity / citywide burden
    total_covered_burden = sum(h.get("severity", 0.0) for h in all_hotspots if h["cell"] in covered_cells)
    coverage_pct = round(100.0 * (total_covered_burden / citywide_burden), 1)
    
    # Split across N_TEAMS (round-robin by EPS)
    selected_stops.sort(key=lambda x: x["eps"], reverse=True)
    teams = [{"team_id": f"T{i+1}", "stops": [], "route_km": 0.0, "coverage_pct": coverage_pct} for i in range(n_teams)]
    
    for i, stop in enumerate(selected_stops):
        teams[i % n_teams]["stops"].append(stop)
        
    # Nearest-neighbour routing per team
    DEPOT_LAT = (BBOX["lat_min"] + BBOX["lat_max"]) / 2.0
    DEPOT_LON = (BBOX["lon_min"] + BBOX["lon_max"]) / 2.0
    
    for team in teams:
        if not team["stops"]:
            continue
            
        unvisited = team["stops"]
        route = []
        current_lat, current_lon = DEPOT_LAT, DEPOT_LON
        route_km = 0.0
        seq = 1
        
        while unvisited:
            # Find nearest
            best_idx = -1
            min_dist = float('inf')
            for i, stop in enumerate(unvisited):
                dist = haversine_km(current_lat, current_lon, stop["lat"], stop["lon"])
                if dist < min_dist:
                    min_dist = dist
                    best_idx = i
                    
            nxt = unvisited.pop(best_idx)
            route_km += min_dist
            current_lat, current_lon = nxt["lat"], nxt["lon"]
            
            route.append({
                "seq": seq,
                "action_id": nxt["action_id"],
                "zone_id": nxt["zone_id"],
                "ward_id": nxt["ward_id"],
                "eps": nxt["eps"],
                "lat": nxt["lat"],
                "lon": nxt["lon"]
            })
            seq += 1
            
        team["stops"] = route
        team["route_km"] = round(route_km, 1)
        
    return teams


def run(n_teams: int = 4, stop_budget: int = 10) -> None:
    try:
        hotspots = json.loads((DATA_OUT / "hotspots.json").read_text())
        attributions_list = json.loads((DATA_OUT / "attributions.json").read_text())
    except FileNotFoundError:
        print("[prioritise] hotspots.json or attributions.json not found. Run previous steps.")
        return
        
    attributions = {a["cell"]: a for a in attributions_list}
    
    try:
        panel = pd.read_parquet(DATA_OUT / "panel.parquet")
    except Exception:
        panel = pd.DataFrame()
        
    # Group by zone_id
    by_zone = {}
    for h in hotspots:
        zone = h.get("zone_id") or h["cell"]
        by_zone.setdefault(zone, []).append(h)
        
    actions = []
    action_idx = 1
    
    for zone_id, cells in by_zone.items():
        attributable = cells[0].get("attributable", True)
        if not attributable:
            continue
            
        eps_data = calculate_eps(cells, attributions, panel)
        
        # Centroid
        lats, lons = [], []
        for c in cells:
            lat, lon = cell_center(c["cell"])
            lats.append(lat)
            lons.append(lon)
        centroid = {"lat": round(sum(lats)/len(lats), 4), "lon": round(sum(lons)/len(lons), 4)}
        
        anchor = max(cells, key=lambda x: x.get("severity", 0.0))
        pm25_med = round(anchor.get("pm25_med", 0.0), 1)
        
        # Primary source and confidence from the anchor cell's attribution
        anchor_attr = attributions.get(anchor["cell"], {})
        source = anchor_attr.get("primary_source", "unknown")
        confidence = anchor_attr.get("confidence", 0.0)
        
        actions.append({
            "action_id": f"A{action_idx:02d}",
            "zone_id": zone_id,
            "ward_id": anchor.get("ward_id", "unknown"),
            "ward_name": anchor.get("ward_name", "unknown"),
            "cells": [c["cell"] for c in cells],
            "centroid": centroid,
            "eps": eps_data["eps"],
            "components": eps_data["components"],
            "kind": anchor.get("kind", "chronic"),
            "source": source,
            "confidence": confidence,
            "n_cells": len(cells),
            "pm25_med": pm25_med,
            "status": "pending"
        })
        action_idx += 1
        
    actions.sort(key=lambda x: x["eps"], reverse=True)
    
    (DATA_OUT / "actions.json").write_text(json.dumps(actions, indent=2))
    print(f"[prioritise] Wrote {len(actions)} actions to actions.json")
    
    teams = run_dispatch(actions, hotspots, n_teams=n_teams, stop_budget=stop_budget)
    (DATA_OUT / "dispatch.json").write_text(json.dumps(teams, indent=2))
    print(f"[prioritise] Wrote dispatch plan for {n_teams} teams (max {stop_budget} stops) to dispatch.json")


if __name__ == "__main__":
    run()
