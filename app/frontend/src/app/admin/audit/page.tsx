"use client";
/**
 * Network Audit — two panels:
 * 1. Monitoring Blind Spots: cells where satellite says "high" but no monitor exists → next-sensor placement
 * 2. Sensor Anomaly Flags: stations reading flat while satellite spikes → malfunction/tampering review
 */
import useSWR from "swr";
import { api } from "@/lib/api";
import type { AuditResponse, BlindSpot, SensorFlag } from "@/lib/types";

function BlindSpotsTable({ spots }: { spots: BlindSpot[] }) {
  if (!spots.length) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: 160,
        border: "1px dashed var(--border-default)",
        borderRadius: "var(--radius-md)", color: "var(--text-tertiary)",
        fontSize: "0.875rem", gap: 8, padding: "var(--space-xl)",
        textAlign: "center",
      }}>
        <span style={{ fontSize: "1.8rem" }}>📡</span>
        No blind spots detected — or audit agent not yet run.
      </div>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
            {["Rank", "Cell", "Ward", "Satellite Signal"].map((h) => (
              <th key={h} style={{
                padding: "8px 12px", textAlign: "left",
                fontSize: "0.7rem", fontWeight: 700,
                color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase",
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spots.slice(0, 20).map((s) => (
            <tr key={s.cell} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "#fde047", fontWeight: 700 }}>
                #{s.rank}
              </td>
              <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                {s.cell.slice(0, 12)}…
              </td>
              <td style={{ padding: "8px 12px", fontSize: "0.85rem" }}>
                {s.ward_id}
              </td>
              <td style={{ padding: "8px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: `${Math.min(100, s.satellite_signal * 100).toFixed(0)}%`,
                    height: 6, background: "#fde047",
                    borderRadius: "var(--radius-full)",
                    maxWidth: 120, minWidth: 4,
                  }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    {s.satellite_signal.toFixed(3)}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {spots.length > 20 && (
        <div style={{ padding: "8px 12px", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
          Showing top 20 of {spots.length} blind spots
        </div>
      )}
    </div>
  );
}

function SensorFlagCard({ flag }: { flag: SensorFlag }) {
  const isTampering = flag.reason === "flat_while_satellite_spikes";
  return (
    <div className="card" style={{
      display: "flex", alignItems: "flex-start",
      gap: "var(--space-md)",
      borderLeft: `3px solid ${isTampering ? "#ef4444" : "#6b7280"}`,
    }}>
      <span style={{ fontSize: "1.5rem", flexShrink: 0 }}>{isTampering ? "⚠️" : "🔇"}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{flag.station_name}</div>
        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 4 }}>
          {isTampering
            ? "Station reads flat while satellite column spikes overhead — possible malfunction or tampering"
            : "No data in expected window"}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
          {flag.ward_id} · {flag.cell.slice(0, 12)}…
        </div>
      </div>
      <span style={{
        padding: "2px 8px", borderRadius: "var(--radius-full)",
        background: isTampering ? "rgba(239,68,68,0.12)" : "rgba(107,114,128,0.12)",
        color: isTampering ? "#ef4444" : "#6b7280",
        border: `1px solid ${isTampering ? "#ef444430" : "#6b728030"}`,
        fontSize: "0.7rem", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
      }}>
        {isTampering ? "Anomaly" : "No Data"}
      </span>
    </div>
  );
}

export default function AuditPage() {
  const { data, isLoading } = useSWR<AuditResponse>(
    "audit",
    () => api.getAudit()
  );

  const blindSpots = data?.blind_spots ?? [];
  const sensorFlags = data?.sensor_flags ?? [];
  const recommendations = data?.placement_recommendations ?? [];

  return (
    <div style={{ padding: "var(--space-xl)", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: "var(--space-xl)" }}>
        <h1 style={{ marginBottom: 8 }}>Monitoring Network Audit</h1>
        <p style={{ maxWidth: 700 }}>
          Free byproducts of the fusion field. Cells where satellite + fusion say{" "}
          <strong>&quot;high&quot;</strong> but no monitor exists → next-sensor placement.
          Stations that read flat while the satellite spikes overhead → malfunction/tampering review.
          Direct answer to the 2024 CAG audit.
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))",
        gap: "var(--space-xl)",
        alignItems: "start",
      }}>
        {/* Blind spots */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "var(--space-md)" }}>
            <h2>📡 Monitoring Blind Spots</h2>
            {blindSpots.length > 0 && (
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: "0.8rem",
                color: "#fde047", background: "rgba(253,224,71,0.1)",
                padding: "2px 8px", borderRadius: "var(--radius-full)",
                border: "1px solid rgba(253,224,71,0.2)",
              }}>
                {blindSpots.length}
              </span>
            )}
          </div>
          <p style={{ fontSize: "0.875rem", marginBottom: "var(--space-lg)" }}>
            Ranked by satellite signal strength. Top entries are the optimal next-sensor placement candidates.
          </p>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {isLoading
              ? <div className="skeleton" style={{ height: 200, borderRadius: "var(--radius-md)" }} />
              : <BlindSpotsTable spots={blindSpots} />
            }
          </div>

          {recommendations.length > 0 && (
            <div style={{ marginTop: "var(--space-lg)" }}>
              <h4 style={{ marginBottom: "var(--space-sm)" }}>Placement Recommendations</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {recommendations.map((r: string, i: number) => (
                  <div key={i} className="card" style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    fontSize: "0.85rem", color: "var(--text-secondary)",
                  }}>
                    <span style={{ color: "#fde047", flexShrink: 0, fontWeight: 700 }}>#{i+1}</span>
                    {r}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sensor anomaly flags */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "var(--space-md)" }}>
            <h2>⚠️ Sensor Anomaly Flags</h2>
            {sensorFlags.length > 0 && (
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: "0.8rem",
                color: "#ef4444", background: "rgba(239,68,68,0.1)",
                padding: "2px 8px", borderRadius: "var(--radius-full)",
                border: "1px solid rgba(239,68,68,0.2)",
              }}>
                {sensorFlags.length}
              </span>
            )}
          </div>
          <p style={{ fontSize: "0.875rem", marginBottom: "var(--space-lg)" }}>
            Stations reading flat while the satellite spikes overhead.
            Possible malfunction or tampering — flagged for physical review.
          </p>
          {isLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {[1,2].map((i) => <div key={i} className="skeleton" style={{ height: 80, borderRadius: "var(--radius-md)" }} />)}
            </div>
          ) : sensorFlags.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", minHeight: 160,
              border: "1px dashed var(--border-default)",
              borderRadius: "var(--radius-md)", color: "var(--text-tertiary)",
              fontSize: "0.875rem", gap: 8, textAlign: "center",
              padding: "var(--space-xl)",
            }}>
              <span style={{ fontSize: "1.8rem" }}>✅</span>
              No anomalies detected — all stations reporting normally.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {sensorFlags.map((f) => <SensorFlagCard key={f.cell} flag={f} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
