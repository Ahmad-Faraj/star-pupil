"use client";

// The live belief map. One node per concept, positioned on a circle in the
// order Pip learned them. Edges show a belief that was reasoned FROM an
// earlier one (derivedFrom) — this is how a red node quietly poisons a later
// green-looking one, made visible instead of buried in a quote nobody reads.
// Selection lives in the page, not here, so the transcript can point at nodes
// and a node can point back at the sentence that created it.

import { useEffect, useRef, useState } from "react";
import { Belief, rootCause } from "@/lib/student";

const STATUS_COLOR: Record<Belief["status"], string> = {
  correct: "oklch(0.72 0.13 85)",
  wrong: "oklch(0.55 0.19 27)",
  fuzzy: "oklch(0.93 0.01 92)",
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

// Everything the selected belief was built on, plus everything built on it —
// the full blast radius of one sentence, walked in both directions.
function chainOf(beliefs: Belief[], id: number): Set<number> {
  const byId = new Map(beliefs.map((b) => [b.id, b]));
  const chain = new Set<number>([id]);
  const up = [id];
  while (up.length) {
    for (const pid of byId.get(up.pop()!)?.derivedFrom ?? []) {
      if (byId.has(pid) && !chain.has(pid)) {
        chain.add(pid);
        up.push(pid);
      }
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of beliefs) {
      if (!chain.has(b.id) && b.derivedFrom.some((pid) => chain.has(pid))) {
        chain.add(b.id);
        grew = true;
      }
    }
  }
  return chain;
}

export function BeliefGraph({
  beliefs,
  selected,
  onSelect,
}: {
  beliefs: Belief[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  const size = 300;
  const points = layout(beliefs.length, size);
  const byId = new Map(beliefs.map((b) => [b.id, b]));
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
  const chain = selectedBelief ? chainOf(beliefs, selectedBelief.id) : null;
  const root = selectedBelief ? rootCause(beliefs, selectedBelief.id) : undefined;

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
          <filter id="halo-gold" x="-100%" y="-100%" width="300%" height="300%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="oklch(0.78 0.14 85)" floodOpacity="0.85" />
          </filter>
          <filter id="halo-red" x="-100%" y="-100%" width="300%" height="300%">
            <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="oklch(0.55 0.19 27)" floodOpacity="0.7" />
          </filter>
        </defs>
        {beliefs.map((b, i) => {
          const from = points[i];
          return b.derivedFrom
            .map((pid) => {
              const pi = beliefs.findIndex((x) => x.id === pid);
              if (pi === -1) return null;
              const to = points[pi];
              const inChain = chain ? chain.has(b.id) && chain.has(pid) : true;
              return (
                <line
                  key={`${b.id}-${pid}`}
                  x1={to.x}
                  y1={to.y}
                  x2={from.x}
                  y2={from.y}
                  stroke={chain && inChain ? "oklch(0.45 0.06 55)" : "oklch(0.75 0.01 80)"}
                  strokeWidth={chain && inChain ? 1.75 : 1.25}
                  markerEnd="url(#edge-arrow)"
                  opacity={chain && !inChain ? 0.15 : 0.7}
                  style={{ transition: "opacity 200ms, stroke 200ms" }}
                />
              );
            })
            .filter(Boolean);
        })}
        {beliefs.map((b, i) => {
          const p = points[i];
          const isNew = justAdded.has(b.id);
          const isSelected = selected === b.id;
          const dimmed = chain ? !chain.has(b.id) : false;
          return (
            <g
              key={b.id}
              transform={`translate(${p.x} ${p.y})`}
              onClick={() => onSelect(isSelected ? null : b.id)}
              className="cursor-pointer"
              opacity={dimmed ? 0.25 : 1}
              style={{ transition: "opacity 200ms" }}
            >
              <title>{`${b.concept} (${b.status})`}</title>
              <g
                style={{
                  transition: "transform 400ms cubic-bezier(.34,1.56,.64,1)",
                  transform: isNew ? "scale(1.4)" : "scale(1)",
                }}
              >
                <circle
                  r={isSelected ? 15 : 12}
                  fill={STATUS_COLOR[b.status]}
                  stroke={
                    isSelected
                      ? "oklch(0.26 0.015 70)"
                      : b.status === "fuzzy"
                        ? "oklch(0.6 0.015 75)"
                        : "none"
                  }
                  strokeWidth={isSelected ? 2 : 1.25}
                  strokeDasharray={b.status === "fuzzy" && !isSelected ? "3 2" : undefined}
                  filter={
                    dimmed
                      ? undefined
                      : b.status === "correct"
                        ? "url(#halo-gold)"
                        : b.status === "wrong"
                          ? "url(#halo-red)"
                          : undefined
                  }
                />
              </g>
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
          {chain && chain.size > 1 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Everything dimmed played no part in this belief. The dark edges are its whole chain.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
