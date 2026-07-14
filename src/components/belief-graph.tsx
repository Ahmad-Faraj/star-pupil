"use client";

// The live belief map, drawn like a commit graph. One row per belief in the
// order Pip learned them, so time flows down the page the way a notebook
// fills; indentation is derivation depth, so a belief reasoned from an earlier
// one steps right, and a chain of reasoning is literally a staircase. Edges
// connect a belief to what it was built on: how a red node quietly poisons a
// later, correct-looking one, made visible. Selection lives in the page:
// clicking a node tells the page, and the page opens the belief's file. The
// map's own job while something is selected is to dim every row that played
// no part in it.

import { useEffect, useRef, useState } from "react";
import { Belief } from "@/lib/student";

const STATUS_COLOR: Record<Belief["status"], string> = {
  correct: "oklch(0.72 0.13 85)",
  wrong: "oklch(0.55 0.19 27)",
  // Dark enough to read against the card; the dashed stroke says "not sure",
  // the fill just has to be visible.
  fuzzy: "oklch(0.87 0.012 85)",
};

const W = 336; // viewBox width; the svg stretches to the sidebar
const ROW = 40;
const R = 9;
const PAD_TOP = 16;
const GUTTER = 28; // left gutter for turn numbers
const INDENT = 26; // one derivation step
const MAX_INDENT = 6;

// Everything the selected belief was built on, plus everything built on it:
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

// Derivation depth: 0 for a standalone fact, one more than the deepest parent
// otherwise. Cycle-safe: a cycle just stops counting instead of recursing.
function depthsOf(beliefs: Belief[]): Map<number, number> {
  const byId = new Map(beliefs.map((b) => [b.id, b]));
  const depth = new Map<number, number>();
  function walk(id: number, trail: Set<number>): number {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (trail.has(id)) return 0;
    trail.add(id);
    const parents = (byId.get(id)?.derivedFrom ?? []).filter((p) => byId.has(p));
    const d = parents.length ? Math.max(...parents.map((p) => walk(p, trail))) + 1 : 0;
    depth.set(id, d);
    return d;
  }
  beliefs.forEach((b) => walk(b.id, new Set()));
  return depth;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<Set<number>>(new Set());
  const [justAdded, setJustAdded] = useState<Set<number>>(new Set());

  useEffect(() => {
    const fresh = beliefs.filter((b) => !seenRef.current.has(b.id));
    if (fresh.length) {
      fresh.forEach((b) => seenRef.current.add(b.id));
      setJustAdded(new Set(fresh.map((b) => b.id)));
      // New rows land at the bottom, which may be scrolled out of view.
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      const t = setTimeout(() => setJustAdded(new Set()), 700);
      return () => clearTimeout(t);
    }
  }, [beliefs]);

  if (beliefs.length === 0) {
    return (
      <p className="m-auto max-w-[30ch] text-center text-sm text-muted-foreground">
        Empty. Everything you teach lands here as a row, correct, fuzzy, or flat
        wrong, and a belief built on an earlier one steps to the right.
      </p>
    );
  }

  const depths = depthsOf(beliefs);
  const rows = beliefs.map((b, i) => ({
    belief: b,
    x: GUTTER + R + Math.min(depths.get(b.id) ?? 0, MAX_INDENT) * INDENT,
    y: PAD_TOP + i * ROW + ROW / 2,
  }));
  const posById = new Map(rows.map((r) => [r.belief.id, r]));
  const height = PAD_TOP + beliefs.length * ROW + 6;

  const selectedBelief = selected != null ? beliefs.find((b) => b.id === selected) : undefined;
  const chain = selectedBelief ? chainOf(beliefs, selectedBelief.id) : null;

  // Parent-to-child edge: drop out of the parent's underside, curve into the
  // child's left side, the same gesture a commit graph makes.
  function edgePath(p: { x: number; y: number }, c: { x: number; y: number }): string {
    const sy = p.y + R;
    const ex = c.x - R - 3;
    if (c.x <= p.x) {
      // Child no deeper than parent (updates can do this), so swing out left.
      return `M ${p.x - R} ${p.y} C ${p.x - 22} ${p.y}, ${ex - 14} ${c.y}, ${ex} ${c.y}`;
    }
    return `M ${p.x} ${sy} C ${p.x} ${(sy + c.y) / 2}, ${p.x} ${c.y}, ${ex} ${c.y}`;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="block w-full"
          onClick={() => onSelect(null)}
        >
          <title>Belief map: taught top to bottom, reasoning steps right</title>
          <defs>
            <marker id="edge-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="oklch(0.7 0.015 75)" />
            </marker>
            <filter id="halo-gold" x="-100%" y="-100%" width="300%" height="300%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="oklch(0.78 0.14 85)" floodOpacity="0.85" />
            </filter>
            <filter id="halo-red" x="-100%" y="-100%" width="300%" height="300%">
              <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="oklch(0.55 0.19 27)" floodOpacity="0.7" />
            </filter>
          </defs>

          {/* turn number in the gutter, once per turn, like a notebook margin */}
          {rows.map(({ belief: b, y }, i) =>
            i === 0 || beliefs[i - 1].turn !== b.turn ? (
              <text
                key={`t-${b.id}`}
                x={GUTTER - 12}
                y={y + 3}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 9.5, opacity: 0.65 }}
              >
                {b.turn}
              </text>
            ) : null
          )}

          {rows.map(({ belief: b, x, y }) =>
            b.derivedFrom.map((pid) => {
              const parent = posById.get(pid);
              if (!parent) return null;
              const inChain = chain ? chain.has(b.id) && chain.has(pid) : true;
              return (
                <path
                  key={`${b.id}-${pid}`}
                  d={edgePath(parent, { x, y })}
                  fill="none"
                  stroke={chain && inChain ? "oklch(0.45 0.06 55)" : "oklch(0.78 0.01 80)"}
                  strokeWidth={chain && inChain ? 1.75 : 1.25}
                  markerEnd="url(#edge-arrow)"
                  opacity={chain && !inChain ? 0.15 : 0.7}
                  style={{ transition: "opacity 200ms, stroke 200ms" }}
                />
              );
            })
          )}

          {rows.map(({ belief: b, x, y }) => {
            const isNew = justAdded.has(b.id);
            const isSelected = selected === b.id;
            const dimmed = chain ? !chain.has(b.id) : false;
            const labelX = x + R + 10;
            const maxChars = Math.floor((W - labelX - 6) / 6.1);
            return (
              <g
                key={b.id}
                role="button"
                tabIndex={0}
                aria-label={`${b.concept} (${b.status}), taught turn ${b.turn}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(b.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(b.id);
                  }
                }}
                className="group cursor-pointer outline-none"
                opacity={dimmed ? 0.25 : 1}
                style={{ transition: "opacity 200ms" }}
              >
                <title>{`${b.concept} (${b.status})`}</title>
                {/* full-row hit area so the label is as clickable as the dot */}
                <rect x={0} y={y - ROW / 2} width={W} height={ROW} fill="transparent" />
                <g transform={`translate(${x} ${y})`}>
                  <g
                    className="tb-fill"
                    style={{
                      transition: "transform 400ms cubic-bezier(.34,1.56,.64,1)",
                      transform: isNew ? "scale(1.5)" : "scale(1)",
                    }}
                  >
                  <circle
                    r={isSelected ? R + 2.5 : R}
                    className="tb-fill transition-transform duration-200 ease-out group-hover:scale-110 group-focus-visible:scale-110"
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
                </g>
                <text
                  x={labelX}
                  y={y + 4}
                  className="fill-foreground"
                  style={{ fontSize: 11.5, fontWeight: isSelected ? 600 : 500 }}
                >
                  {b.concept.length > maxChars ? b.concept.slice(0, maxChars - 1) + "…" : b.concept}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR.correct }} />
          right
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR.wrong }} />
          wrong
        </span>
        <span className="flex items-center gap-1">
          <span
            className="h-2 w-2 rounded-full border border-dashed"
            style={{ background: STATUS_COLOR.fuzzy, borderColor: "oklch(0.6 0.015 75)" }}
          />
          fuzzy
        </span>
        <span className="ml-auto">indent = built on earlier belief</span>
      </div>

      {selectedBelief && chain && chain.size > 1 && (
        <p className="mt-2 text-xs text-muted-foreground animate-in fade-in duration-200">
          The bright rows are everything &ldquo;{selectedBelief.concept}&rdquo; was built on
          or fed into. The dimmed ones played no part.
        </p>
      )}
    </div>
  );
}
