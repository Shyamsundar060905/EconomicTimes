"use client";
/**
 * Citizen home — find YOUR ward, no scrolling.
 *   1. "Use my location" -> geolocate -> resolve to ward via H3 (client-side).
 *   2. or tap the map on your area.
 *   3. or type to search (kept as a fallback, collapsed by default).
 * The 227-ward scroll grid is gone: a citizen should land on their map, not hunt
 * a list.
 */
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { api } from "@/lib/api";
import { pm25ToAqi, getAqiCategory } from "@/lib/colors";
import { useCitizenWard } from "@/hooks/useReports";
import { useWardLocator } from "@/hooks/useWardLocator";
import { useCity } from "@/lib/CityContext";
import type { FusionResponse } from "@/lib/types";

const CitizenMap = dynamic(() => import("@/components/citizen/CitizenMap"), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: 340, borderRadius: "var(--radius-lg)" }} />,
});

export default function CitizenHomePage() {
  const router = useRouter();
  const { city } = useCity();
  const { wardId: savedWard, setWardId } = useCitizenWard();
  const { locate, hasData } = useWardLocator();

  const { data: fusion } = useSWR<FusionResponse>([city, "fusion"], () => api.cityFusion(city));
  const cells = useMemo(() => fusion?.cells ?? [], [fusion]);

  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState("");

  const go = (wardId: string) => {
    setWardId(wardId);
    router.push(`/citizen/${wardId}`);
  };

  const useMyLocation = () => {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("Your browser doesn't support location. Tap the map instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const hit = locate(pos.coords.latitude, pos.coords.longitude);
        if (hit) go(hit.ward_id);
        else setGeoError("Couldn't match your location to a ward. Tap the map instead.");
      },
      () => {
        setLocating(false);
        setGeoError("Location permission denied. Tap the map to pick your area.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // search fallback (collapsed)
  const wards = useMemo(() => {
    const seen = new Set<string>();
    return cells
      .filter((c) => c.ward_id && !seen.has(c.ward_id) && seen.add(c.ward_id))
      .map((c) => ({ ward_id: c.ward_id!, ward_name: (c as { ward_name?: string }).ward_name ?? c.ward_id! }));
  }, [cells]);
  const searchHits = useMemo(
    () => (search.trim() ? wards.filter((w) => w.ward_name.toLowerCase().includes(search.toLowerCase())).slice(0, 8) : []),
    [wards, search]
  );

  // Live city snapshot — the citywide median AQI, and its worst wards right now.
  const cityAqi = useMemo(() => {
    if (!cells.length) return null;
    const vals = cells.map((c) => c.pm25).sort((a, b) => a - b);
    return pm25ToAqi(vals[Math.floor(vals.length / 2)]);
  }, [cells]);
  const cityCat = cityAqi != null ? getAqiCategory(cityAqi) : null;

  const worstWards = useMemo(() => {
    const byWard = new Map<string, number[]>();
    for (const c of cells) {
      if (!c.ward_id || c.ward_id === "unassigned") continue;
      (byWard.get(c.ward_id) ?? byWard.set(c.ward_id, []).get(c.ward_id)!).push(c.pm25);
    }
    return [...byWard.entries()]
      .map(([wid, v]) => ({ wid, pm25: v.sort((a, b) => a - b)[Math.floor(v.length / 2)] }))
      .sort((a, b) => b.pm25 - a.pm25)
      .slice(0, 6);
  }, [cells]);

  return (
    <div style={{ padding: "var(--space-xl)", maxWidth: 720, margin: "0 auto", width: "100%" }}>
      <div style={{ textAlign: "center", marginBottom: "var(--space-lg)" }}>
        <h1 style={{ marginBottom: 8 }}>Your air, your ward</h1>
        <p style={{ color: "var(--text-secondary)" }}>
          Find your area to see live air quality, a 72-hour forecast, and to report pollution.
        </p>
      </div>

      {/* Live city AQI band — substance before you even pick a ward */}
      {cityCat && (
        <div
          className="card"
          style={{
            display: "flex", alignItems: "center", gap: "var(--space-md)",
            marginBottom: "var(--space-md)", padding: "var(--space-md) var(--space-lg)",
            borderLeft: `4px solid ${cityCat.color}`,
            background: `${cityCat.color}0d`,
          }}
        >
          <div style={{
            width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
            background: cityCat.color, color: cityCat.textColor,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 24px ${cityCat.color}55`,
          }}>
            <div style={{ fontSize: "1.15rem", fontWeight: 700, lineHeight: 1 }}>{cityAqi}</div>
            <div style={{ fontSize: "0.5rem", opacity: 0.85 }}>AQI</div>
          </div>
          <div>
            <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--text-primary)" }}>
              Citywide air is {cityCat.label}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              Median across every ward, live now. Find yours below.
            </div>
          </div>
        </div>
      )}

      {savedWard && (
        <button
          className="btn btn-primary"
          onClick={() => router.push(`/citizen/${savedWard}`)}
          style={{ width: "100%", justifyContent: "center", marginBottom: "var(--space-md)" }}
        >
          ↩ Back to my ward
        </button>
      )}

      {/* Primary action: geolocate */}
      <button
        className="btn btn-emerald"
        onClick={useMyLocation}
        disabled={locating || !hasData}
        style={{ width: "100%", justifyContent: "center", marginBottom: "var(--space-sm)", padding: "var(--space-md)" }}
      >
        {locating ? "Locating…" : "📍 Use my location"}
      </button>
      {geoError && (
        <p style={{ fontSize: "0.8rem", color: "var(--accent-amber)", textAlign: "center", marginBottom: "var(--space-sm)" }}>
          {geoError}
        </p>
      )}

      <p style={{ textAlign: "center", fontSize: "0.8rem", color: "var(--text-tertiary)", margin: "var(--space-sm) 0" }}>
        …or tap your area on the map
      </p>

      {/* Tappable map */}
      <CitizenMap cells={cells} onPickWard={(wardId) => go(wardId)} height={360} />

      {/* Worst wards right now — live, tappable, fills the space with substance */}
      {worstWards.length > 0 && (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: "var(--space-sm)" }}>
            Worst air right now
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "var(--space-sm)" }}>
            {worstWards.map((w) => {
              const aqi = pm25ToAqi(w.pm25);
              const cat = getAqiCategory(aqi);
              const name = wards.find((x) => x.ward_id === w.wid)?.ward_name ?? w.wid;
              return (
                <button
                  key={w.wid}
                  onClick={() => go(w.wid)}
                  className="card card-hover"
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    cursor: "pointer", textAlign: "left", borderLeft: `3px solid ${cat.color}`,
                  }}
                >
                  <div style={{
                    minWidth: 40, height: 40, borderRadius: "var(--radius-sm)", flexShrink: 0,
                    background: cat.color, color: cat.textColor,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: "0.95rem",
                  }}>
                    {aqi}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {name}
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "var(--text-tertiary)" }}>{cat.label}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search fallback (collapsed) */}
      <div style={{ marginTop: "var(--space-md)", textAlign: "center" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSearch((s) => !s)}>
          {showSearch ? "Hide search" : "Prefer to type? Search by name"}
        </button>
        {showSearch && (
          <div style={{ marginTop: "var(--space-sm)", textAlign: "left" }}>
            <input
              type="search"
              placeholder="Type your ward or locality…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {searchHits.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {searchHits.map((w) => (
                  <button
                    key={w.ward_id}
                    className="card card-hover"
                    onClick={() => go(w.ward_id)}
                    style={{ textAlign: "left", padding: "8px 12px", cursor: "pointer", fontSize: "0.88rem" }}
                  >
                    {w.ward_name}
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-tertiary)", marginLeft: 8 }}>
                      {w.ward_id}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
