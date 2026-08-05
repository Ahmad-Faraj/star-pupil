"use client";

// The map of the subject, drawn by React Flow over a dagre layout.
//
// What changed the map from a log into a map: the nodes are the SUBJECT's
// concepts, written by the examiner at enrollment, not the concepts the teacher
// happened to mention. Teaching lights them gold, red or fuzzy.
//
// It shows the frontier, never the whole syllabus. Handing the teacher the full
// list turns the lesson into a checklist, and then the exam is only measuring
// how well they worked through a to-do list. So an unlit concept is only drawn
// once everything it stands on is taught: teach one and the next ones surface
// behind it. `revealAll` opens the rest, and only the report card sets it.
//
// Two kinds of edge, and they mean different things. A dashed edge is the
// subject's own order: this concept needs that one first. A solid edge is Pip
// reasoning: he built this belief on that one. The second kind is how a
// misconception spreads, and seeing it cross the map is the point.
//
// Beliefs the map has no place for still get drawn, off to the side. A teacher
// going somewhere the syllabus never went is worth seeing, not hiding.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import { Belief, ConceptState, SyllabusNode, conceptStates, frontierOf } from "@/lib/student";

// A map key addresses whatever a node stands for: a syllabus concept by its
// slug, or a single off-syllabus belief. The page selects by this, so the chat
// dots, the notebook and the map all point at the same thing.
export const offMapKey = (beliefId: number) => `off:${beliefId}`;
export const keyOfBelief = (b: Belief) => b.nodeId ?? offMapKey(b.id);

const NODE_W = 198;
const NODE_H = 48;
const ROUTE_INK = "oklch(0.26 0.015 70)";

const STATE_COLOR: Record<ConceptState, string> = {
  correct: "oklch(0.72 0.13 85)",
  wrong: "oklch(0.55 0.19 27)",
  fuzzy: "oklch(0.8 0.05 85)",
  unlit: "oklch(0.86 0.012 90)",
};

// One exam answer's working: the concepts Pip actually read on his way to it,
// in the order he cited them, and the concept the question itself sits on.
// Betty's Brain earned its reputation on this move. Knowing the answer was
// wrong teaches nobody anything; watching which route through your own lesson
// produced it does.
export interface Trace {
  steps: string[]; // map keys, in citation order
  target: string | null; // the concept the question was set on
}

interface ConceptData extends Record<string, unknown> {
  label: string;
  detail: string;
  state: ConceptState;
  count: number; // beliefs filed here
  marks: number; // exam questions sitting on it, hidden until the paper is open
  offMap: boolean;
  dimmed: boolean;
  selected: boolean;
  fresh: boolean; // lit since the last render pass, so it can flare
  step: number; // 1-based position in the working, 0 when not on the path
  target: boolean; // the concept the question was set on
  // Mid-lesson an unlit concept is one you could teach next. On the report card
  // the same node means one you never reached. Same colour, opposite news.
  revealAll: boolean;
}

type ConceptNode = Node<ConceptData, "concept">;

// The one node component. React Flow renders node types through components by
// design, so this is its extension point rather than a hand-rolled control.
function ConceptNodeView({ data }: NodeProps<ConceptNode>) {
  const { state, offMap } = data;
  const ink = STATE_COLOR[state];
  return (
    <div
      className={`sp-node group flex items-center gap-2 rounded-md border-2 px-2.5 py-2 text-left transition-all duration-300 ${
        data.dimmed ? "opacity-25" : "opacity-100"
      } ${data.selected ? "sp-node-selected" : ""} ${data.fresh ? "sp-node-lit" : ""}`}
      style={{
        width: NODE_W,
        height: NODE_H,
        borderColor: state === "unlit" ? "var(--border)" : ink,
        borderStyle: state === "fuzzy" || state === "unlit" ? "dashed" : "solid",
        background: state === "unlit" ? "transparent" : "var(--color-card)",
        // the node's own ink, so the flare when it lights is its own colour and
        // a misconception never flashes gold. Every label sets its own colour.
        color: ink,
      }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" isConnectable={false} />
      {data.step > 0 ? (
        <span
          aria-hidden
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-foreground text-[9px] font-semibold leading-none text-background"
        >
          {data.step}
        </span>
      ) : (
        <span
          aria-hidden
          className="grid h-4 w-4 shrink-0 place-items-center text-[13px] leading-none"
          style={{ color: ink }}
        >
          {state === "correct" ? "★" : state === "wrong" ? "✗" : state === "fuzzy" ? "?" : "○"}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[12px] leading-tight font-medium ${
            state === "unlit" ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {data.label}
        </span>
        <span className="block truncate text-[9px] uppercase tracking-wide text-muted-foreground/80">
          {data.target
            ? "the question was set here"
            : data.step > 0
              ? "he read this"
              : offMap
                ? "off the syllabus"
                : state === "unlit"
                  ? data.marks > 0
                    ? `never taught · ${data.marks} mark${data.marks === 1 ? "" : "s"}`
                    : data.revealAll
                      ? "never taught"
                      : "open next"
                  : `${data.count} belief${data.count === 1 ? "" : "s"}`}
        </span>
      </span>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" isConnectable={false} />
    </div>
  );
}

const nodeTypes = { concept: ConceptNodeView };

// dagre wants sizes up front and gives back centres; React Flow wants top-left.
function layout(nodes: ConceptNode[], edges: Edge[]): ConceptNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  // Prerequisite chains are deep and narrow, so the rank gap is what decides
  // whether a nine-concept subject is legible in a sidebar. Tight enough to
  // fit, wide enough that the edges still read as edges.
  g.setGraph({ rankdir: "TB", nodesep: 22, ranksep: 36, marginx: 10, marginy: 10 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  });
  dagre.layout(g);
  return nodes.map((n) => {
    const { x, y } = g.node(n.id);
    return { ...n, position: { x: x - NODE_W / 2, y: y - NODE_H / 2 } };
  });
}

// Everything one node is tangled with: what its beliefs were reasoned from,
// what was reasoned from them, and its immediate place in the subject's order.
// One rule, so the legend can state it in a line.
function blastRadius(keys: string[], edges: Edge[], from: string): Set<string> {
  const hit = new Set<string>([from]);
  const derived = edges.filter((e) => e.data?.kind === "derived");
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of derived) {
      if (hit.has(e.source) !== hit.has(e.target)) {
        hit.add(e.source);
        hit.add(e.target);
        grew = true;
      }
    }
  }
  for (const e of edges) {
    if (e.data?.kind !== "requires") continue;
    if (e.source === from) hit.add(e.target);
    if (e.target === from) hit.add(e.source);
  }
  return new Set(keys.filter((k) => hit.has(k)));
}

function Canvas({
  syllabus,
  beliefs,
  selected,
  onSelect,
  revealMarks,
  revealAll,
  questionNodeIds,
  trace,
  interactive = true,
}: {
  syllabus: SyllabusNode[];
  beliefs: Belief[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  revealMarks: boolean;
  revealAll: boolean;
  questionNodeIds: string[];
  trace: Trace | null;
  interactive?: boolean;
}) {
  const { fitView } = useReactFlow();
  // Which concepts were already lit last time we drew, and which came on since.
  // A node that has just lit flares once; a node that was already gold must not
  // flare again every time the ledger changes, or the whole map twitches on
  // every turn. The ref is only ever touched from the effect below.
  const litRef = useRef<Set<string>>(new Set());
  const [justLit, setJustLit] = useState<Set<string>>(new Set());

  const states = useMemo(() => conceptStates(syllabus, beliefs), [syllabus, beliefs]);
  // Mid-lesson the map draws the frontier only. On the report card it draws
  // everything, including what was never reached, which is the whole point of
  // the report card.
  const shown = useMemo(() => {
    if (revealAll) return syllabus;
    const open = frontierOf(syllabus, states);
    return syllabus.filter((n) => open.has(n.id));
  }, [syllabus, states, revealAll]);
  const offMap = useMemo(() => beliefs.filter((b) => !b.nodeId || !states.has(b.nodeId)), [beliefs, states]);

  const marksPerNode = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of questionNodeIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [questionNodeIds]);

  const { nodes, edges } = useMemo(() => {
    const raw: ConceptNode[] = shown.map((n) => {
      const entry = states.get(n.id)!;
      return {
        id: n.id,
        type: "concept" as const,
        position: { x: 0, y: 0 },
        data: {
          label: n.label,
          detail: n.detail,
          state: entry.state,
          count: entry.beliefs.length,
          marks: revealMarks ? (marksPerNode.get(n.id) ?? 0) : 0,
          offMap: false,
          dimmed: false,
          selected: false,
          fresh: justLit.has(n.id),
          step: 0,
          target: false,
          revealAll,
        },
      };
    });
    for (const b of offMap) {
      raw.push({
        id: offMapKey(b.id),
        type: "concept" as const,
        position: { x: 0, y: 0 },
        data: {
          label: b.concept,
          detail: b.statement,
          state: b.status,
          count: 1,
          marks: 0,
          offMap: true,
          dimmed: false,
          selected: false,
          fresh: justLit.has(offMapKey(b.id)),
          step: 0,
          target: false,
          revealAll,
        },
      });
    }

    const keys = new Set(raw.map((n) => n.id));
    const edges: Edge[] = [];
    for (const n of shown) {
      for (const req of n.requires) {
        if (!keys.has(req)) continue;
        edges.push({
          id: `req-${req}-${n.id}`,
          source: req,
          target: n.id,
          type: "smoothstep",
          data: { kind: "requires" },
          style: { stroke: "oklch(0.82 0.012 85)", strokeWidth: 1.25, strokeDasharray: "4 4" },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: "oklch(0.82 0.012 85)" },
        });
      }
    }
    // Derivation lives on beliefs, so it has to be lifted onto the nodes those
    // beliefs are filed under. Two beliefs on one concept collapse to nothing,
    // which is right: reasoning inside a concept is not a chain across the map.
    const byId = new Map(beliefs.map((b) => [b.id, b]));
    const drawn = new Set<string>();
    for (const b of beliefs) {
      const to = keyOfBelief(b);
      for (const pid of b.derivedFrom) {
        const parent = byId.get(pid);
        if (!parent) continue;
        const from = keyOfBelief(parent);
        const id = `der-${from}-${to}`;
        if (from === to || drawn.has(id) || !keys.has(from) || !keys.has(to)) continue;
        drawn.add(id);
        const poisoned = parent.status !== "correct";
        edges.push({
          id,
          source: from,
          target: to,
          type: "smoothstep",
          data: { kind: "derived", poisoned },
          label: "built on",
          labelStyle: { fontSize: 8.5, fill: "var(--color-muted-foreground)" },
          labelBgStyle: { fill: "var(--color-card)" },
          labelBgPadding: [3, 1],
          style: {
            stroke: poisoned ? "oklch(0.6 0.17 27)" : "oklch(0.6 0.02 75)",
            strokeWidth: 1.75,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 13,
            height: 13,
            color: poisoned ? "oklch(0.6 0.17 27)" : "oklch(0.6 0.02 75)",
          },
        });
      }
    }
    return { nodes: layout(raw, edges), edges };
  }, [shown, beliefs, states, offMap, marksPerNode, revealMarks, revealAll, justLit]);

  useEffect(() => {
    const fresh = nodes
      .filter((n) => n.data.state !== "unlit" && !litRef.current.has(n.id))
      .map((n) => n.id);
    if (!fresh.length) return;
    fresh.forEach((id) => litRef.current.add(id));
    setJustLit(new Set(fresh));
    // Long enough for the flare to finish; leaving the class on would replay it
    // the next time anything about the map changes.
    const t = setTimeout(() => setJustLit(new Set()), 950);
    return () => clearTimeout(t);
  }, [nodes]);

  // A new row of concepts can land outside the viewport, so the map re-frames
  // itself whenever its shape changes, not on every belief.
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.12, duration: 320 }), 60);
    return () => clearTimeout(t);
  }, [nodes.length, fitView]);

  // A trace is its own focus, so it replaces the selection's blast radius
  // rather than fighting it: while you are reading one answer's working, the
  // map should show that working and nothing else.
  const radius = useMemo(() => {
    if (trace) {
      const keys = new Set(nodes.map((n) => n.id));
      const hit = new Set(
        [...trace.steps, trace.target].filter((k): k is string => !!k && keys.has(k))
      );
      // He cited nothing and the question sits nowhere we can point to. Dimming
      // the whole map would just look broken; the page says it in words instead.
      return hit.size ? hit : null;
    }
    return selected ? blastRadius(nodes.map((n) => n.id), edges, selected) : null;
  }, [trace, selected, nodes, edges]);

  // The route: step to step, then into the question. Most of it already exists
  // on the map, because reasoning from one belief to the next is exactly what a
  // "built on" edge is. Drawing a second arrow over the top of one made a
  // tangle, so the route reuses the edge that is already there and only adds
  // the hops the map has no edge for.
  const route = useMemo(() => {
    if (!trace) return { edges: [] as Edge[], pairs: new Set<string>() };
    const keys = new Set(nodes.map((n) => n.id));
    const path = trace.steps.filter((k) => keys.has(k));
    if (trace.target && keys.has(trace.target) && path[path.length - 1] !== trace.target) {
      path.push(trace.target);
    }
    const pairs = new Set(path.slice(1).map((to, i) => `${path[i]}>${to}`));
    const existing = new Set(edges.map((e) => `${e.source}>${e.target}`));
    const extra: Edge[] = path.slice(1).flatMap((to, i) => {
      const pair = `${path[i]}>${to}`;
      if (existing.has(pair)) return [];
      return [
        {
          id: `route-${pair}`,
          source: path[i],
          target: to,
          type: "straight",
          animated: true,
          zIndex: 10,
          style: { stroke: ROUTE_INK, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: ROUTE_INK },
        },
      ];
    });
    return { edges: extra, pairs };
  }, [trace, nodes, edges]);

  // Selecting a concept, or opening one answer's working, flies the map to the
  // whole chain rather than the one node. In a nine-concept map the interesting
  // thing is never one box, it is the run of boxes a single sentence reached.
  useEffect(() => {
    if (!radius?.size) return;
    const t = setTimeout(
      () =>
        fitView({
          nodes: Array.from(radius, (id) => ({ id })),
          padding: 0.35,
          maxZoom: 1.15,
          duration: 420,
        }),
      40
    );
    return () => clearTimeout(t);
  }, [radius, fitView]);

  const painted = useMemo(
    () =>
      nodes.map((n) => {
        const step = trace ? trace.steps.indexOf(n.id) : -1;
        return {
          ...n,
          data: {
            ...n.data,
            dimmed: radius ? !radius.has(n.id) : false,
            selected: trace ? n.id === trace.target : n.id === selected,
            step: step >= 0 ? step + 1 : 0,
            target: !!trace && n.id === trace.target && step < 0,
          },
        };
      }),
    [nodes, radius, selected, trace]
  );

  const paintedEdges = useMemo(
    () =>
      [...edges, ...route.edges].map((e) => {
        if (e.id.startsWith("route-")) return e;
        // An edge the working actually walked stops being background structure
        // and becomes the route itself.
        if (route.pairs.has(`${e.source}>${e.target}`)) {
          return {
            ...e,
            animated: true,
            zIndex: 10,
            style: { ...e.style, stroke: ROUTE_INK, strokeWidth: 2, strokeDasharray: undefined },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: ROUTE_INK },
          };
        }
        const inRadius = radius ? radius.has(e.source) && radius.has(e.target) : true;
        return {
          ...e,
          // React Flow's animated edges are marching dashes, and the
          // prerequisite edges are already dashed, so animating every
          // derivation makes the two kinds indistinguishable the moment
          // anything is selected. Only a derivation off a bad belief marches:
          // that one is red, so nothing else looks like it, and the thing
          // actually moving is the thing actually spreading.
          animated: !!radius && inRadius && e.data?.kind === "derived" && !!e.data?.poisoned,
          style: { ...e.style, opacity: radius && !inRadius ? 0.12 : 1 },
        };
      }),
    [edges, route, radius]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => onSelect(node.id === selected ? null : node.id),
    [onSelect, selected]
  );

  return (
    <ReactFlow
      nodes={painted}
      edges={paintedEdges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={() => onSelect(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll={interactive}
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      panOnDrag={interactive}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.25}
      className="sp-map"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="oklch(0.88 0.02 85)" />
      {/* left, because React Flow's credit lives in the bottom-right corner */}
      {interactive && <Controls showInteractive={false} position="bottom-left" />}
    </ReactFlow>
  );
}

export function BeliefMap(props: {
  syllabus: SyllabusNode[];
  beliefs: Belief[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  revealMarks?: boolean;
  revealAll?: boolean;
  questionNodeIds?: string[];
  trace?: Trace | null;
  interactive?: boolean;
  className?: string;
}) {
  const {
    className,
    revealMarks = false,
    revealAll = false,
    questionNodeIds = [],
    trace = null,
    interactive = true,
    ...rest
  } = props;
  if (!props.syllabus.length && !props.beliefs.length) {
    return (
      <p className={`m-auto max-w-[32ch] p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}>
        The examiner is still sketching the subject. In a moment this shows you
        where a lesson starts, and nothing further.
      </p>
    );
  }
  return (
    <div className={className}>
      <ReactFlowProvider>
        <Canvas
          {...rest}
          revealMarks={revealMarks}
          revealAll={revealAll}
          questionNodeIds={questionNodeIds}
          trace={trace}
          interactive={interactive}
        />
      </ReactFlowProvider>
    </div>
  );
}

export function MapLegend({
  lit,
  total,
  next,
  revealAll,
}: {
  lit: number;
  total: number;
  next?: number;
  revealAll?: boolean;
}) {
  return (
    <div className="flex h-4 flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLOR.correct }} />
        right
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLOR.wrong }} />
        wrong
      </span>
      <span className="flex items-center gap-1">
        <span
          className="h-2 w-2 rounded-full border border-dashed"
          style={{ background: STATE_COLOR.fuzzy, borderColor: "oklch(0.6 0.015 75)" }}
        />
        fuzzy
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full border border-dashed border-muted-foreground/60" />
        {revealAll ? "never taught" : "open next"}
      </span>
      {total > 0 && (
        // Mid-lesson this must never print the total. The number of concepts
        // left is exactly the spoiler the frontier exists to withhold.
        <span className="ml-auto tabular-nums">
          {revealAll ? `${lit} of ${total} lit` : `${lit} lit · ${next ?? 0} open next`}
        </span>
      )}
    </div>
  );
}
