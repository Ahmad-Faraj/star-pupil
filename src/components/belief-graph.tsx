"use client";

// The live belief map. One node per concept, positioned on a circle in the
// order Pip learned them. Edges show a belief that was reasoned FROM an
// earlier one (derivedFrom) — this is how a red node quietly poisons a later
// green-looking one, made visible instead of buried in a quote nobody reads.

import { useEffect, useRef, useState } from "react";
import { Belief, rootCause } from "@/lib/student";

const STATUS_COLOR: Record<Belief["status"], string> = {
  correct: "oklch(0.72 0.13 85)",
  wrong: "oklch(0.55 0.19 27)",
  fuzzy: "oklch(0.65 0.015 75)",
};

interface Point {
  x: number;
  y: number;
}

function layout(n: number, size: number): Point[] {
  const center = size / 2;
  const radius = size * 0.36;
  if (n <= 1) return [{ x: center, y: center }];
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
  });
}

export function BeliefGraph({ beliefs }: { beliefs: Belief[] }) {
  const size = 300;
  const points = layout(beliefs.length, size);
  const byId = new Map(beliefs.map((b) => [b.id, b]));
  const [selected, setSelected] = useState<number | null>(null);
  const seenRef = useRef<Set<number>>(new Set());
  const [justAdded, setJustAdded] = useState<Set<number>>(new Set());

  useEffect(() => {
    const fresh = beliefs.filter((b) => !seenRef.current.has(b.id));
    if (fresh.length) {
      fresh.forEach((b) => seenRef.current.add(b.id));
      setJustAdded(new Set(fresh.map((b) => b.id)));
      const t = setTimeout(() => setJustAdded(new Set()), 700);
      return () => clearTimeout(t);
    }
  }, [beliefs]);

  const selectedBelief = selected != null ? byId.get(selected) : undefined;
  const root = selected != null ? rootCause(beliefs, selected) : undefined;

  if (beliefs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Empty. Everything you teach lands here as a node — correct, fuzzy, or flat wrong.
      </p>
    );
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto block w-full max-w-[300px]"
        role="img"
        aria-label="Belief map"
      >
        <defs>
          <marker id="edge-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="oklch(0.75 0.01 80)" />
          </marker>
        </defs>
        {beliefs.map((b, i) => {
          const from = points[i];
          return b.derivedFrom
            .map((pid) => {
              const pi = beliefs.findIndex((x) => x.id === pid);
              if (pi === -1) return null;
              const to = points[pi];
              return (
                <line
                  key={`${b.id}-${pid}`}
                  x1={to.x}
                  y1={to.y}
                  x2={from.x}
                  y2={from.y}
                  stroke="oklch(0.75 0.01 80)"
                  strokeWidth={1.25}
                  markerEnd="url(#edge-arrow)"
                  opacity={0.7}
                />
              );
            })
            .filter(Boolean);
        })}
        {beliefs.map((b, i) => {
          const p = points[i];
          const isNew = justAdded.has(b.id);
          const isSelected = selected === b.id;
          return (
            <g
              key={b.id}
              transform={`translate(${p.x} ${p.y})`}
              onClick={() => setSelected(isSelected ? null : b.id)}
              className="cursor-pointer"
              style={{
                transition: "transform 400ms ease",
                transform: isNew ? `translate(${p.x}px ${p.y}px) scale(1.35)` : undefined,
              }}
            >
              <circle
                r={isSelected ? 15 : 12}
                fill={STATUS_COLOR[b.status]}
                stroke={isSelected ? "oklch(0.26 0.015 70)" : "none"}
                strokeWidth={2}
                opacity={b.status === "fuzzy" ? 0.55 : 1}
              />
              <text
                y={26}
                textAnchor="middle"
                className="fill-foreground"
                style={{ fontSize: 9, fontWeight: 500 }}
              >
                {b.concept.length > 14 ? b.concept.slice(0, 13) + "…" : b.concept}
              </text>
            </g>
          );
        })}
      </svg>

      {selectedBelief && (
        <div className="mt-3 rounded-md border bg-secondary/40 p-3 text-sm">
          <p className="font-medium">{selectedBelief.concept}</p>
          <p className="mt-1 text-muted-foreground">{selectedBelief.statement}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            your words, turn {selectedBelief.turn}: &ldquo;{selectedBelief.quote}&rdquo;
          </p>
          {selectedBelief.status !== "correct" && (
            <p className="mt-1 text-xs text-destructive">{selectedBelief.note}</p>
          )}
          {root && root.id !== selectedBelief.id && (
            <p className="mt-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              Built on a shakier belief, turn {root.turn}: &ldquo;{root.quote}&rdquo;
            </p>
          )}
        </div>
      )}
    </div>
  );
}
