"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useReports } from "@/hooks/useReports";
import { REPORT_CATEGORY_LABELS, REPORT_CATEGORY_ICONS } from "@/lib/constants";
import type { ReportCategory, CreateReportPayload } from "@/lib/types";

interface Params { wardId: string }

const CATEGORIES: ReportCategory[] = [
  "waste_burning", "construction_dust", "industrial", "traffic", "other"
];

export default function ReportPage({ params }: { params: Promise<Params> }) {
  const { wardId } = use(params);
  const router = useRouter();
  const { submitReport, submitting, submitError } = useReports();

  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) return;
    const payload: CreateReportPayload = {
      ward_id: wardId,
      category,
      description: description.trim() || undefined,
      photo: photo ?? undefined,
    };
    const result = await submitReport(payload);
    if (result) setSubmitted(true);
  };

  if (submitted) {
    return (
      <div style={{ padding: "var(--space-xl)", maxWidth: 560, margin: "0 auto", width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: "3rem", marginBottom: "var(--space-lg)" }}>✅</div>
        <h2 style={{ marginBottom: "var(--space-md)" }}>Report Submitted</h2>
        <p style={{ marginBottom: "var(--space-xl)" }}>
          Your report has been received. You can track its status in My Reports.
          If your report corroborates a detection, it will appear in the attribution evidence chain.
        </p>
        <div style={{ display: "flex", gap: "var(--space-md)", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/citizen/reports" className="btn btn-primary" style={{ textDecoration: "none" }}>
            View My Reports
          </Link>
          <Link href={`/citizen/${wardId}`} className="btn btn-ghost" style={{ textDecoration: "none" }}>
            ← Back to Ward
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "var(--space-xl)", maxWidth: 560, margin: "0 auto", width: "100%" }}>
      {/* Back */}
      <Link
        href={`/citizen/${wardId}`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          color: "var(--text-tertiary)", textDecoration: "none",
          fontSize: "0.8rem", marginBottom: "var(--space-lg)",
        }}
      >
        ← Back to ward
      </Link>

      <h1 style={{ marginBottom: 8 }}>Report Pollution</h1>
      <p style={{ marginBottom: "var(--space-xl)" }}>
        Help us identify pollution sources in {wardId}. Your report becomes evidence.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
        {/* Category */}
        <div>
          <label>What type of pollution did you see? *</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "var(--space-sm)", marginTop: 8 }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className="card"
                style={{
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderColor: category === cat ? "var(--accent-blue)" : undefined,
                  background: category === cat ? "rgba(59,130,246,0.08)" : undefined,
                  transition: "all var(--transition-fast)",
                }}
              >
                <span style={{ fontSize: "1.3rem" }}>{REPORT_CATEGORY_ICONS[cat]}</span>
                <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>
                  {REPORT_CATEGORY_LABELS[cat]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Photo */}
        <div>
          <label>Photo (optional)</label>
          <div
            style={{
              marginTop: 8,
              border: "2px dashed var(--border-default)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-lg)",
              textAlign: "center",
              cursor: "pointer",
              transition: "border-color var(--transition-fast)",
              position: "relative",
            }}
            onClick={() => document.getElementById("photo-input")?.click()}
          >
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoPreview}
                alt="Preview"
                style={{ maxHeight: 200, maxWidth: "100%", objectFit: "contain", borderRadius: 6 }}
              />
            ) : (
              <div style={{ color: "var(--text-tertiary)" }}>
                <div style={{ fontSize: "2rem", marginBottom: 8 }}>📷</div>
                <div style={{ fontSize: "0.875rem" }}>Tap to add a photo</div>
              </div>
            )}
            <input
              id="photo-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhoto}
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label>Description (optional)</label>
          <textarea
            rows={3}
            placeholder="What did you see? Where exactly? Any other details..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ resize: "vertical" }}
          />
        </div>

        {/* Error */}
        {submitError && (
          <div
            style={{
              padding: "10px 14px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: "var(--radius-sm)",
              color: "#f87171",
              fontSize: "0.875rem",
            }}
          >
            {submitError}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!category || submitting}
          style={{ width: "100%", justifyContent: "center", padding: "12px" }}
        >
          {submitting ? (
            <span className="animate-spin" style={{ display: "inline-block" }}>⬡</span>
          ) : "Submit Report"}
        </button>
      </form>
    </div>
  );
}
