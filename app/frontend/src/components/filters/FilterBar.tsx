"use client";
import type { MapFilters, HotspotKind, SourceCategory } from "@/lib/types";
import { PERSISTENCE_LABELS, SOURCE_LABELS } from "@/lib/constants";

interface Props {
  filters: MapFilters;
  onWards: (ids: string[]) => void;
  onSources: (s: SourceCategory[]) => void;
  onPersistence: (p: HotspotKind[]) => void;
  onReset: () => void;
}

const PERSISTENCE_OPTIONS: HotspotKind[] = ["chronic", "emerging", "acute"];
const SOURCE_OPTIONS: SourceCategory[] = ["industrial", "waste_burning", "construction", "traffic"];

const PERSIST_COLORS: Record<HotspotKind, string> = {
  chronic:  "var(--persist-chronic)",
  emerging: "var(--persist-emerging)",
  acute:    "var(--persist-acute)",
};

function MultiChip<T extends string>({
  options,
  selected,
  onToggle,
  labels,
  colors,
}: {
  options: T[];
  selected: T[];
  onToggle: (val: T) => void;
  labels: Record<T, string>;
  colors?: Partial<Record<T, string>>;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            style={{
              padding: "3px 8px",
              borderRadius: "var(--radius-full)",
              border: `1px solid ${active ? (colors?.[opt] ?? "var(--accent-blue)") : "var(--border-default)"}`,
              background: active ? `${colors?.[opt] ?? "var(--accent-blue)"}20` : "transparent",
              color: active ? (colors?.[opt] ?? "var(--accent-blue)") : "var(--text-tertiary)",
              fontSize: "0.72rem",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              transition: "all var(--transition-fast)",
            }}
          >
            {labels[opt]}
          </button>
        );
      })}
    </div>
  );
}

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}

export default function FilterBar({ filters, onSources, onPersistence, onReset }: Props) {
  const hasActive = filters.source_types.length > 0 || filters.persistence_types.length > 0;

  return (
    <div
      className="glass"
      style={{
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        minWidth: 170,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span
          style={{
            fontSize: "0.7rem", fontWeight: 600,
            letterSpacing: "0.06em", textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          Filters
        </span>
        {hasActive && (
          <button
            onClick={onReset}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "0.7rem", color: "var(--accent-blue)",
              fontFamily: "var(--font-sans)",
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Persistence */}
        <div>
          <div style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", marginBottom: 5, fontWeight: 600 }}>
            PERSISTENCE
          </div>
          <MultiChip
            options={PERSISTENCE_OPTIONS}
            selected={filters.persistence_types}
            onToggle={(v) => onPersistence(toggle(filters.persistence_types, v))}
            labels={PERSISTENCE_LABELS}
            colors={PERSIST_COLORS}
          />
        </div>

        {/* Source type */}
        <div>
          <div style={{ fontSize: "0.68rem", color: "var(--text-tertiary)", marginBottom: 5, fontWeight: 600 }}>
            SOURCE TYPE
          </div>
          <MultiChip
            options={SOURCE_OPTIONS}
            selected={filters.source_types}
            onToggle={(v) => onSources(toggle(filters.source_types, v))}
            labels={SOURCE_LABELS}
          />
        </div>
      </div>
    </div>
  );
}
