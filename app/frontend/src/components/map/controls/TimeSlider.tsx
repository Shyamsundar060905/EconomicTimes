"use client";

interface Props {
  value: number;        // 0 = "Now", positive = hours back, negative = forecast ahead
  onChange: (v: number) => void;
  maxBack?: number;     // max hours back (default 0 = live only)
  maxForward?: number;  // max forecast hours (default 72)
}

export default function TimeSlider({ value, onChange, maxBack = 0, maxForward = 72 }: Props) {
  const total = maxBack + maxForward;
  const sliderVal = maxBack - value;  // slider 0 = maxBack hours ago, max = now+72h forecast

  const formatLabel = (offset: number) => {
    if (offset === 0) return "Now";
    if (offset > 0) return `+${offset}h forecast`;
    return `${Math.abs(offset)}h ago`;
  };

  return (
    <div
      className="glass"
      style={{
        borderRadius: "var(--radius-md)",
        padding: "10px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.75rem",
        }}
      >
        <span style={{ color: "var(--text-tertiary)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Time
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            color: value === 0 ? "var(--accent-emerald)" : value > 0 ? "var(--accent-amber)" : "var(--text-primary)",
            fontWeight: 600,
            fontSize: "0.8rem",
          }}
        >
          {formatLabel(value)}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={total}
        step={1}
        value={sliderVal}
        onChange={(e) => {
          const sv = Number(e.target.value);
          onChange(maxBack - sv);
        }}
        style={{
          width: "100%",
          accentColor: "var(--accent-blue)",
          cursor: "pointer",
        }}
      />

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "var(--text-tertiary)" }}>
        <span>{maxBack > 0 ? `${maxBack}h ago` : "Live"}</span>
        <span>Now</span>
        <span>+{maxForward}h</span>
      </div>
    </div>
  );
}
