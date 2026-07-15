import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AQ Intelligence Platform — Select Role",
  description: "AI-powered urban air quality intelligence: signal → attribution → action.",
};

export default function LandingPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-xl)",
        gap: "var(--space-2xl)",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", maxWidth: 640 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 14px",
            background: "rgba(59,130,246,0.1)",
            border: "1px solid rgba(59,130,246,0.25)",
            borderRadius: "var(--radius-full)",
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "var(--accent-blue)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: "var(--space-lg)",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-blue)", display: "inline-block" }} />
          Delhi · Live AQ Intelligence
        </div>

        <h1
          style={{
            background: "linear-gradient(135deg, #f0f4ff 30%, #60a5fa 70%, #a78bfa 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            marginBottom: "var(--space-md)",
            fontSize: "clamp(2rem, 5vw, 3.2rem)",
          }}
        >
          AQ Intelligence Platform
        </h1>

        <p style={{ fontSize: "1.1rem", lineHeight: 1.7, color: "var(--text-secondary)" }}>
          From AQI dashboards to enforcement dispatch —{" "}
          <em style={{ color: "var(--text-primary)", fontStyle: "normal" }}>signal → attribution → action.</em>{" "}
          Names <strong>who</strong> is polluting, <strong>where</strong>, with{" "}
          <strong>what evidence</strong>, and <strong>what to do about it today</strong>.
        </p>
      </div>

      {/* Role cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "var(--space-lg)",
          width: "100%",
          maxWidth: 720,
        }}
      >
        {/* Admin */}
        <Link href="/admin" style={{ textDecoration: "none" }}>
          <div
            className="card card-hover"
            style={{
              padding: "var(--space-xl)",
              textAlign: "center",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--space-md)",
              borderColor: "rgba(59,130,246,0.2)",
            }}
          >
            <div
              style={{
                width: 64, height: 64, borderRadius: "var(--radius-lg)",
                background: "rgba(59,130,246,0.12)",
                border: "1px solid rgba(59,130,246,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.8rem",
              }}
            >
              🗺️
            </div>
            <div>
              <h3 style={{ color: "var(--text-primary)", marginBottom: 6 }}>Admin Console</h3>
              <p style={{ fontSize: "0.875rem" }}>
                Interactive map dashboard, agent control, enforcement queue, and evidence chains.
              </p>
            </div>
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                color: "var(--accent-blue)", fontSize: "0.875rem", fontWeight: 600,
              }}
            >
              Open console →
            </span>
          </div>
        </Link>

        {/* Citizen */}
        <Link href="/citizen" style={{ textDecoration: "none" }}>
          <div
            className="card card-hover"
            style={{
              padding: "var(--space-xl)",
              textAlign: "center",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--space-md)",
              borderColor: "rgba(16,185,129,0.2)",
            }}
          >
            <div
              style={{
                width: 64, height: 64, borderRadius: "var(--radius-lg)",
                background: "rgba(16,185,129,0.10)",
                border: "1px solid rgba(16,185,129,0.22)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.8rem",
              }}
            >
              🏙️
            </div>
            <div>
              <h3 style={{ color: "var(--text-primary)", marginBottom: 6 }}>Citizen View</h3>
              <p style={{ fontSize: "0.875rem" }}>
                Your ward&apos;s air quality, 72h forecast, multilingual advisory, and pollution reports.
              </p>
            </div>
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                color: "var(--accent-emerald)", fontSize: "0.875rem", fontWeight: 600,
              }}
            >
              Open citizen view →
            </span>
          </div>
        </Link>
      </div>

      {/* Stats strip */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-xl)",
          flexWrap: "wrap",
          justifyContent: "center",
          color: "var(--text-tertiary)",
          fontSize: "0.8rem",
        }}
      >
        {[
          ["~1,210", "H3 cells · Res 8"],
          ["60", "Voronoi wards"],
          ["6", "Data sources"],
          ["6", "AI agents"],
          ["0.90", "Fusion LOSO R²"],
        ].map(([val, label]) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "1.1rem",
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: 2,
              }}
            >
              {val}
            </div>
            <div>{label}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
