import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Admin Console — AQ Intelligence Platform",
  description:
    "Interactive map dashboard with H3 hexagonal cells, hotspot detection, " +
    "source attribution, enforcement queue, and agent control.",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "var(--bg-base)",
      }}
    >
      {/* ── Top header ─────────────────────────────────────────────────────── */}
      <header
        className="glass"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-lg)",
          height: 52,
          borderBottom: "1px solid var(--border-subtle)",
          zIndex: "var(--z-header)",
          flexShrink: 0,
        }}
      >
        {/* Logo + title */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              textDecoration: "none",
              color: "var(--text-primary)",
            }}
          >
            <span style={{ fontSize: "1.3rem" }}>⬡</span>
            <span style={{ fontWeight: 700, fontSize: "0.95rem", letterSpacing: "-0.01em" }}>
              AQ Intelligence
            </span>
          </Link>
          <span
            style={{
              width: 1, height: 16,
              background: "var(--border-default)",
              display: "inline-block",
            }}
          />
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--accent-blue)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Admin Console
          </span>
        </div>

        {/* Nav tabs */}
        <nav style={{ display: "flex", gap: 4 }}>
          {[
            { href: "/admin", label: "Map" },
            { href: "/admin/ledger", label: "Ledger" },
            { href: "/admin/registry", label: "Registry" },
            { href: "/admin/audit", label: "Audit" },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              style={{
                padding: "4px 12px",
                borderRadius: "var(--radius-sm)",
                fontSize: "0.8rem",
                fontWeight: 500,
                color: "var(--text-secondary)",
                textDecoration: "none",
                transition: "all var(--transition-fast)",
              }}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Right: city badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: "0.75rem",
            color: "var(--text-tertiary)",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
          Delhi · H3 Res-8
          <Link
            href="/citizen"
            style={{
              marginLeft: 8,
              padding: "3px 10px",
              borderRadius: "var(--radius-full)",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
              textDecoration: "none",
              fontSize: "0.7rem",
              fontWeight: 500,
            }}
          >
            Citizen View
          </Link>
        </div>
      </header>

      {/* ── Page content (fills remaining height) ──────────────────────────── */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {children}
      </div>
    </div>
  );
}
