"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface CanvasNode {
  id: string;
  name: string;
  type: string;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

const TYPE_COLORS: Record<string, string> = {
  Company: "#6366f1",
  Department: "#8b5cf6",
  Employee: "#10b981",
  Person: "#34d399",
  User: "#2dd4bf",
  Role: "#f59e0b",
  Document: "#f43f5e",
  Chunk: "#fb7185",
  Policy: "#ef4444",
  Procedure: "#f97316",
  Requirement: "#ea580c",
  Product: "#06b6d4",
  Project: "#22d3ee",
  Technology: "#3b82f6",
  Organization: "#60a5fa",
  Location: "#a3e635",
  Event: "#e879f9",
  Topic: "#94a3b8"
};

function colorFor(type: string): string {
  return TYPE_COLORS[type] ?? "#94a3b8";
}

interface Point {
  x: number;
  y: number;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ideal spacing between neighboring nodes so labels remain readable. */
const NODE_SEP = 150;

/**
 * Build a radial (concentric ring) layout rooted at the selected node.
 *
 * The root sits at the centre; every other node is placed on the ring
 * corresponding to its hop distance (BFS) from the root, with the ring
 * radius grown to guarantee at least ~NODE_SEP of arc between neighbours.
 * This is deterministic, independent of the node/edge content, and never
 * collapses nodes onto each other the way an unconstrained force layout can.
 */
function computeLayout(nodes: CanvasNode[], edges: CanvasEdge[], selectedId: string | null): Record<string, Point> {
  const positions: Record<string, Point> = {};
  if (nodes.length === 0) return positions;

  // Adjacency from edges (undirected), so the root's true neighbours are found.
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  // Pick the root: the selected node when present (neighbourhood mode),
  // otherwise the most-connected node (full-graph mode).
  let rootId = selectedId;
  if (!rootId || !adj.has(rootId)) {
    let best: string | null = null;
    let bestDegree = -1;
    for (const n of nodes) {
      const d = adj.get(n.id)?.size ?? 0;
      if (d > bestDegree) {
        bestDegree = d;
        best = n.id;
      }
    }
    rootId = best ?? nodes[0].id;
  }

  // BFS to assign each node a hop level from the root.
  const level = new Map<string, number>();
  const byLevel = new Map<number, string[]>();
  const queue: { id: string; lv: number }[] = [{ id: rootId, lv: 0 }];
  const visited = new Set([rootId]);
  level.set(rootId, 0);
  byLevel.set(0, [rootId]);
  while (queue.length > 0) {
    const { id, lv } = queue.shift() as { id: string; lv: number };
    for (const nb of adj.get(id) ?? []) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      level.set(nb, lv + 1);
      (byLevel.get(lv + 1) ?? (byLevel.set(lv + 1, []), byLevel.get(lv + 1)!)).push(nb);
      queue.push({ id: nb, lv: lv + 1 });
    }
  }
  // Any nodes unreachable from the root (disconnected) are placed on the next ring.
  const unreachable = nodes.filter((n) => !level.has(n.id)).map((n) => n.id);
  if (unreachable.length > 0) {
    const maxLv = byLevel.size;
    (byLevel.get(maxLv) ?? (byLevel.set(maxLv, []), byLevel.get(maxLv)!)).push(...unreachable);
    for (const id of unreachable) level.set(id, maxLv);
  }

  const maxLevel =
    byLevel.size > 0 ? Math.max(...Array.from(byLevel.keys())) : 0;

  // Angular offset so consecutive rings don't line up and increase crowding.
  const rootPos = { x: 0, y: 0 };
  positions[rootId] = { x: rootPos.x, y: rootPos.y };

  for (let lv = 1; lv <= maxLevel; lv++) {
    const members = byLevel.get(lv) ?? [];
    if (members.length === 0) continue;
    // Ring radius large enough that adjacent members keep ~NODE_SEP of arc
    // separation, plus increasing clearance for outer rings' labels.
    const radius = Math.max(260, (members.length * NODE_SEP) / (2 * Math.PI)) + lv * 200;
    const stagger = (lv % 2) * (Math.PI / Math.max(members.length, 1));
    members.forEach((id, i) => {
      const angle = stagger + (i / members.length) * Math.PI * 2;
      positions[id] = {
        x: rootPos.x + radius * Math.cos(angle),
        y: rootPos.y + radius * Math.sin(angle)
      };
    });
  }

  return positions;
}

/** Compute a viewBox that fits every node, centred, with padding. */
function computeViewBox(positions: Record<string, Point>, count: number): ViewBox {
  if (count === 0) return { x: 0, y: 0, w: 900, h: 560 };
  const entries = Object.values(positions);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of entries) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 130;
  const w = Math.max(560, (maxX - minX) + pad * 2);
  const h = Math.max(560, (maxY - minY) + pad * 2);
  // Centre the content.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export default function GraphCanvas({
  nodes,
  edges,
  onSelect,
  selectedId,
  height = 520
}: {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  onSelect?: (node: CanvasNode) => void;
  selectedId?: string | null;
  height?: number;
}) {
  const [, setDim] = useState({ w: 900, h: 560 });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const measure = () => setDim({ w: wrapRef.current?.clientWidth ?? 900, h: height });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [height]);

  // Compute the layout purely from the current props. Using useMemo (not a
  // state setter from an effect) means positions update synchronously with the
  // props and are immune to async state-update race conditions (req: race-free).
  const layout = useMemo(
    () => computeLayout(nodes, edges, selectedId ?? null),
    [nodes, edges, selectedId]
  );

  // Fit/zoom to the visible nodes after every layout change (req: auto fit).
  const viewBox = useMemo(
    () => computeViewBox(layout, nodes.filter((n) => layout[n.id]).length),
    [layout, nodes]
  );

  if (nodes.length === 0) {
    return (
      <div ref={wrapRef} className="flex items-center justify-center rounded-xl border border-dashed border-slate-800" style={{ height }}>
        <div className="text-center">
          <div className="text-2xl text-slate-600">🕸️</div>
          <div className="mt-2 text-sm text-slate-500">No graph data to show</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative overflow-hidden rounded-xl border border-slate-800 bg-ink-950" style={{ height }}>
      <svg
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block" }}
      >
        {edges.map((e) => {
          const s = layout[e.source];
          const t = layout[e.target];
          if (!s || !t) return null;
          const sx = s.x;
          const sy = s.y;
          const tx = t.x;
          const ty = t.y;
          return (
            <g key={e.id}>
              <line x1={sx} y1={sy} x2={tx} y2={ty} stroke="#334155" strokeWidth={1.5} />
              <g transform={`translate(${(sx + tx) / 2},${(sy + ty) / 2})`}>
                <rect x={-34} y={-9} width={68} height={18} rx={9} fill="#1e293b" opacity={0.92} />
                <text textAnchor="middle" y={3.5} fontSize={8.5} fill="#94a3b8" letterSpacing={0.5}>
                  {e.type}
                </text>
              </g>
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = layout[n.id];
          if (!p) return null;
          const selected = n.id === selectedId;
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect?.(n)} style={{ cursor: onSelect ? "pointer" : "default" }}>
              <circle r={selected ? 18 : 14} fill={colorFor(n.type)} fillOpacity={selected ? 1 : 0.85} stroke={selected ? "#fff" : "#0b1220"} strokeWidth={selected ? 2 : 1} />
              <text y={32} textAnchor="middle" fontSize={10.5} fill="#cbd5e1" fontWeight={selected ? 600 : 400}>
                {n.name.length > 22 ? n.name.slice(0, 20) + "…" : n.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
