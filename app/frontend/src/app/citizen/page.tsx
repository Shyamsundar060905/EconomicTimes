"use client";
/**
 * Citizen home — Ward selector.
 * Fetches all wards, shows a searchable grid of ward cards with current AQI.
 * Selected ward is stored in localStorage (Q2: citizen identity, open).
 */
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/api";
import { useCitizenWard } from "@/hooks/useReports";
import type { WardsResponse } from "@/lib/types";

export default function CitizenHomePage() {
  const router = useRouter();
  const { wardId: savedWard, setWardId } = useCitizenWard();
  const [search, setSearch] = useState("");

  const { data: wardsData, isLoading } = useSWR<WardsResponse>("wards", () => api.getWards());

  // Derive unique ward list from the cells array
  const wards = useMemo(() => {
    if (!wardsData?.cells) return [];
    const seen = new Set<string>();
    return wardsData.cells
      .filter((c) => {
        if (seen.has(c.ward_id)) return false;
        seen.add(c.ward_id);
        return true;
      })
      .sort((a, b) => a.ward_name.localeCompare(b.ward_name));
  }, [wardsData]);

  const filtered = useMemo(() =>
    wards.filter((w) =>
      w.ward_name.toLowerCase().includes(search.toLowerCase()) ||
      w.ward_id.toLowerCase().includes(search.toLowerCase())
    ),
    [wards, search]
  );

  const handleSelect = (wardId: string) => {
    setWardId(wardId);
    router.push(`/citizen/${wardId}`);
  };

  return (
    <div style={{ padding: "var(--space-xl)", maxWidth: 900, margin: "0 auto", width: "100%" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "var(--space-xl)" }}>
        <h1 style={{ marginBottom: 12 }}>Select Your Ward</h1>
        <p>Choose your ward to see current air quality, 72-hour forecast, and report pollution.</p>

        {savedWard && (
          <button
            className="btn btn-primary"
            onClick={() => router.push(`/citizen/${savedWard}`)}
            style={{ marginTop: "var(--space-md)" }}
          >
            ↩ Go to my ward ({savedWard})
          </button>
        )}
      </div>

      {/* Search */}
      <div style={{ marginBottom: "var(--space-lg)", position: "relative" }}>
        <span
          style={{
            position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
            color: "var(--text-tertiary)", pointerEvents: "none",
          }}
        >
          🔍
        </span>
        <input
          type="search"
          placeholder="Search wards..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: 36 }}
        />
      </div>

      {/* Ward grid */}
      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--space-sm)" }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 72, borderRadius: "var(--radius-md)" }} />
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--space-sm)" }}>
          {filtered.map((w) => (
            <button
              key={w.ward_id}
              onClick={() => handleSelect(w.ward_id)}
              className="card card-hover"
              style={{
                textAlign: "left",
                cursor: "pointer",
                border: savedWard === w.ward_id
                  ? "1px solid var(--accent-emerald)"
                  : "1px solid var(--border-subtle)",
                background: savedWard === w.ward_id ? "rgba(16,185,129,0.06)" : undefined,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                  {w.ward_id}
                </span>
                {savedWard === w.ward_id && <span style={{ fontSize: "0.7rem", color: "var(--accent-emerald)" }}>✓ My ward</span>}
              </div>
              <div style={{ fontWeight: 500, fontSize: "0.9rem", color: "var(--text-primary)" }}>
                {w.ward_name}
              </div>
            </button>
          ))}
          {filtered.length === 0 && !isLoading && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--text-tertiary)", padding: "var(--space-2xl)" }}>
              No wards match &quot;{search}&quot;
            </div>
          )}
        </div>
      )}

      {wardsData?.synthetic && (
        <p style={{ marginTop: "var(--space-xl)", textAlign: "center", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
          ⚠ Using synthetic Voronoi ward boundaries (BBMP GeoJSON not yet loaded)
        </p>
      )}
    </div>
  );
}
