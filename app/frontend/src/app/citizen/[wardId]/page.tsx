"use client";
import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import { api } from "@/lib/api";
import { pm25ToAqi, getAqiCategory } from "@/lib/colors";
import { AQI_ADVICE } from "@/lib/constants";

interface Params { wardId: string }

export default function WardDashboardPage({ params }: { params: Promise<Params> }) {
  const { wardId } = use(params);

  const { data: summary, isLoading } = useSWR(
    ["ward-summary", wardId],
    () => api.getWardSummary(wardId)
  );

  const aqi = summary ? pm25ToAqi(summary.pm25) : null;
  const category = aqi != null ? getAqiCategory(aqi) : null;
  const adviceIndex = aqi != null ? Math.min(Math.floor(aqi / 100), 5) : 0;

  return (
    <div style={{ padding: "var(--space-xl)", maxWidth: 680, margin: "0 auto", width: "100%" }}>
      {/* Back */}
      <Link
        href="/citizen"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          color: "var(--text-tertiary)", textDecoration: "none",
          fontSize: "0.8rem", marginBottom: "var(--space-lg)",
          transition: "color var(--transition-fast)",
        }}
      >
        ← All wards
      </Link>

      {/* Ward name */}
      <div style={{ marginBottom: "var(--space-xl)" }}>
        <h1 style={{ marginBottom: 4 }}>
          {isLoading ? (
            <span className="skeleton" style={{ display: "inline-block", width: 200, height: 32, borderRadius: 6 }} />
          ) : (
            summary?.ward_name ?? wardId
          )}
        </h1>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-tertiary)" }}>
          {wardId}
        </span>
      </div>

      {/* AQI Card */}
      <div
        className="card"
        style={{
          marginBottom: "var(--space-lg)",
          borderColor: category ? category.color + "40" : undefined,
          background: category ? category.color + "08" : undefined,
        }}
      >
        {isLoading ? (
          <div className="skeleton" style={{ height: 120, borderRadius: 8 }} />
        ) : (
          <div style={{ display: "flex", gap: "var(--space-xl)", alignItems: "center" }}>
            {/* AQI dial */}
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div
                style={{
                  width: 100, height: 100, borderRadius: "50%",
                  background: category?.color ?? "#666",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  boxShadow: `0 0 30px ${category?.color ?? "#666"}40`,
                }}
              >
                <div style={{ fontSize: "1.8rem", fontWeight: 700, color: category?.textColor ?? "#fff", lineHeight: 1 }}>
                  {aqi ?? "—"}
                </div>
                <div style={{ fontSize: "0.6rem", color: category?.textColor ?? "#fff", opacity: 0.85, marginTop: 2 }}>
                  AQI
                </div>
              </div>
            </div>
            {/* Details */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: 4 }}>
                {category?.label ?? "No data"}
              </div>
              <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: 8 }}>
                PM2.5: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {summary?.pm25 != null ? `${summary.pm25.toFixed(1)} µg/m³` : "—"}
                </span>
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {AQI_ADVICE[adviceIndex]}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Advisory */}
      {summary?.advisory && (
        <div
          className="card"
          style={{
            marginBottom: "var(--space-lg)",
            borderColor: "rgba(245,158,11,0.3)",
            background: "rgba(245,158,11,0.05)",
          }}
        >
          <h5 style={{ marginBottom: 8, color: "var(--accent-amber)" }}>📢 Advisory</h5>
          <p style={{ fontSize: "0.9rem", color: "var(--text-primary)", lineHeight: 1.6 }}>
            {summary.advisory}
          </p>
        </div>
      )}

      {/* Forecast placeholder */}
      <div className="card" style={{ marginBottom: "var(--space-lg)" }}>
        <h5 style={{ marginBottom: "var(--space-md)" }}>72-Hour Forecast</h5>
        <div
          style={{
            height: 160, display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px dashed var(--border-default)", borderRadius: "var(--radius-sm)",
            color: "var(--text-tertiary)", fontSize: "0.875rem",
          }}
        >
          ForecastChart component (recharts) — loaded in next phase
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "var(--space-md)", flexWrap: "wrap" }}>
        <Link
          href={`/citizen/${wardId}/report`}
          className="btn btn-primary"
          style={{ flex: 1, justifyContent: "center", textDecoration: "none" }}
        >
          📸 Report Pollution
        </Link>
        <Link
          href="/citizen/reports"
          className="btn btn-ghost"
          style={{ flex: 1, justifyContent: "center", textDecoration: "none" }}
        >
          📋 My Reports
        </Link>
      </div>
    </div>
  );
}
