import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Citizen View — AQ Intelligence Platform",
  description: "Your ward's air quality, 72-hour forecast, health advisory, and pollution reports.",
};

export default function CitizenLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-primary)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Simple top header ─────────────────────────────────────────────── */}
      <header
        className="glass"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-lg)",
          height: 56,
          borderBottom: "1px solid var(--border-subtle)",
          position: "sticky",
          top: 0,
          zIndex: "var(--z-header)",
        }}
      >
        <Link
          href="/citizen"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            textDecoration: "none",
            color: "var(--text-primary)",
          }}
        >
          <div
            style={{
              width: 32, height: 32,
              borderRadius: "var(--radius-sm)",
              background: "rgba(16,185,129,0.12)",
              border: "1px solid rgba(16,185,129,0.22)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1rem",
            }}
          >
            🌿
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.2 }}>My Ward Air Quality</div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", lineHeight: 1 }}>Delhi</div>
          </div>
        </Link>

        <nav style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <Link
            href="/citizen/reports"
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              border: "1px solid var(--border-default)",
              fontSize: "0.8rem",
              fontWeight: 500,
              color: "var(--text-secondary)",
              textDecoration: "none",
              transition: "all var(--transition-fast)",
            }}
          >
            My Reports
          </Link>
          <Link
            href="/admin"
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              border: "1px solid rgba(59,130,246,0.25)",
              fontSize: "0.8rem",
              fontWeight: 500,
              color: "var(--accent-blue)",
              textDecoration: "none",
            }}
          >
            Admin →
          </Link>
        </nav>
      </header>

      {/* ── Page content ──────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {children}
      </main>
    </div>
  );
}
