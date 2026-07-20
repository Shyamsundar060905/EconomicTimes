"use client";
import Link from "next/link";
import { useReports } from "@/hooks/useReports";
import { REPORT_CATEGORY_LABELS, REPORT_CATEGORY_ICONS, REPORT_STATUS_LABELS, REPORT_STATUS_COLORS } from "@/lib/constants";
import type { CitizenReport } from "@/lib/types";

function ReportCard({ report }: { report: CitizenReport }) {
  const statusColor = REPORT_STATUS_COLORS[report.status] ?? "#6b7280";
  return (
    <div
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}
    >
      {/* Top row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "1.2rem" }}>{REPORT_CATEGORY_ICONS[report.category]}</span>
          <span style={{ fontWeight: 500 }}>{REPORT_CATEGORY_LABELS[report.category]}</span>
        </div>
        <span
          style={{
            padding: "2px 10px",
            borderRadius: "var(--radius-full)",
            fontSize: "0.7rem",
            fontWeight: 600,
            background: statusColor + "20",
            color: statusColor,
            border: `1px solid ${statusColor}40`,
          }}
        >
          {REPORT_STATUS_LABELS[report.status] ?? report.status}
        </span>
      </div>

      {/* Ward + date */}
      <div style={{ display: "flex", gap: "var(--space-md)", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
        <span>{report.ward_name || report.ward_id}</span>
        <span>{new Date(report.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
      </div>

      {/* Description */}
      {report.description && (
        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>{report.description}</p>
      )}

      {/* Status message */}
      {report.status_message && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(16,185,129,0.08)",
            border: "1px solid rgba(16,185,129,0.18)",
            borderRadius: "var(--radius-sm)",
            fontSize: "0.8rem",
            color: "var(--accent-emerald)",
          }}
        >
          ℹ {report.status_message}
        </div>
      )}

      {/* Photo thumbnail */}
      {report.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={report.photo_url}
          alt="Report photo"
          style={{ width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: "var(--radius-sm)" }}
        />
      )}
    </div>
  );
}

export default function MyReportsPage() {
  const { reports, isLoading, error } = useReports();

  return (
    <div className="page-pad" style={{ padding: "var(--space-xl)", maxWidth: 680, margin: "0 auto", width: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-xl)" }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>My Reports</h1>
          <p style={{ fontSize: "0.875rem" }}>
            {reports.length} report{reports.length !== 1 ? "s" : ""} submitted
          </p>
        </div>
        <Link
          href="/citizen"
          className="btn btn-ghost btn-sm"
          style={{ textDecoration: "none" }}
        >
          + New Report
        </Link>
      </div>

      {/* States */}
      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 120, borderRadius: "var(--radius-md)" }} />
          ))}
        </div>
      )}

      {error && !isLoading && (
        <div
          style={{
            padding: "var(--space-lg)",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: "var(--radius-md)",
            textAlign: "center",
            color: "#f87171",
          }}
        >
          Could not load reports. Please try again.
        </div>
      )}

      {!isLoading && !error && reports.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "var(--space-2xl)",
            border: "1px dashed var(--border-default)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>📋</div>
          <h3 style={{ marginBottom: 8 }}>No reports yet</h3>
          <p style={{ marginBottom: "var(--space-lg)", fontSize: "0.875rem" }}>
            Help us detect pollution sources by submitting your first report.
          </p>
          <Link href="/citizen" className="btn btn-primary" style={{ textDecoration: "none" }}>
            Select my ward
          </Link>
        </div>
      )}

      {!isLoading && reports.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {reports.map((r) => (
            <ReportCard key={r.report_id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}
