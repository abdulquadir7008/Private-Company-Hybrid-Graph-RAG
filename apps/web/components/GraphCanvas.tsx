"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

export const TYPE_COLORS: Record<string, string> = {
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

export const LEGEND_TYPES = [
  "Company",
  "Department",
  "Person",
  "Employee",
  "User",
  "Role",
  "Document",
  "Chunk",
  "Policy",
  "Procedure",
  "Requirement",
  "Product",
  "Project",
  "Technology",
  "Organization",
  "Location",
  "Event",
  "Topic"
];

export function colorFor(type: string): string {
  return TYPE_COLORS[type] ?? "#94a3b8";
}

interface Point {
  x: number;
  y: number;
}

/** Ideal spacing between neighbouring node centers so labels stay readable. */
const NODE_RADIUS = 18;
const NODE_SEP = 118;

/**
 * Deterministic radial (concentric ring) layout rooted at the selected node.
 * Used for entity "neighbourhood" mode so the selected node is always central
 * and hop levels form clean, evenly spaced rings.
 */
function radialLayout(nodes: CanvasNode[], edges: CanvasEdge[], selectedId: string | null): Record<string, Point> {
  const positions: Record<string, Point> = {};
  if (nodes.length === 0) return positions;

  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

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
  const unreachable = nodes.filter((n) => !level.has(n.id)).map((n) => n.id);
  if (unreachable.length > 0) {
    const maxLv = byLevel.size;
    (byLevel.get(maxLv) ?? (byLevel.set(maxLv, []), byLevel.get(maxLv)!)).push(...unreachable);
    for (const id of unreachable) level.set(id, maxLv);
  }

  const maxLevel = byLevel.size > 0 ? Math.max(...Array.from(byLevel.keys())) : 0;
  positions[rootId] = { x: 0, y: 0 };

  for (let lv = 1; lv <= maxLevel; lv++) {
    const members = byLevel.get(lv) ?? [];
    if (members.length === 0) continue;
    const radius = Math.max(170, (members.length * NODE_SEP) / (2 * Math.PI)) + lv * 150;
    const stagger = (lv % 2) * (Math.PI / Math.max(members.length, 1));
    members.forEach((id, i) => {
      const angle = stagger + (i / members.length) * Math.PI * 2;
      positions[id] = {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle)
      };
    });
  }

  return positions;
}

/** Deterministic pseudo-random generator (mulberry32). */
function makeRand(seedIn: number): () => number {
  let seed = seedIn | 0;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Force-directed layout with collision avoidance + central gravity,
 * used for the full authorized graph so nodes spread across the canvas.
 * Deterministic (seeded) so re-renders don't jitter.
 */
function forceLayout(nodes: CanvasNode[], edges: CanvasEdge[]): Record<string, Point> {
  const positions: Record<string, Point> = {};
  if (nodes.length === 0) return positions;

  const n = nodes.length;
  const rand = makeRand(42);
  const adj = new Map<string, Set<string>>();
  for (const nd of nodes) adj.set(nd.id, new Set());
  for (const e of edges) {
    if (adj.has(e.source)) adj.get(e.source)!.add(e.target);
    if (adj.has(e.target)) adj.get(e.target)!.add(e.source);
  }

  const cols = Math.ceil(Math.sqrt(n));
  nodes.forEach((nd, i) => {
    const cx = (i % cols) * NODE_SEP * 1.35;
    const cy = Math.floor(i / cols) * NODE_SEP * 1.35;
    positions[nd.id] = { x: cx + (rand() - 0.5) * 40, y: cy + (rand() - 0.5) * 40 };
  });

  const repulsion = 5200;
  const attraction = 0.08;
  const iterations = 260;

  for (let it = 0; it < iterations; it++) {
    const forces: Record<string, Point> = {};
    for (const nd of nodes) forces[nd.id] = { x: 0, y: 0 };

    for (let i = 0; i < n; i++) {
      const a = positions[nodes[i].id];
      for (let j = i + 1; j < n; j++) {
        const b = positions[nodes[j].id];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) {
          dx = rand() - 0.5;
          dy = rand() - 0.5;
          dist = 1;
        }
        const force = repulsion / (dist * dist);
        const fx = (force / dist) * dx;
        const fy = (force / dist) * dy;
        forces[nodes[i].id].x += fx;
        forces[nodes[i].id].y += fy;
        forces[nodes[j].id].x -= fx;
        forces[nodes[j].id].y -= fy;
      }
    }

    for (const e of edges) {
      const a = positions[e.source];
      const b = positions[e.target];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const desired = NODE_SEP * 1.4;
      const f = (dist - desired) * attraction;
      const fx = (f / dist) * dx;
      const fy = (f / dist) * dy;
      if (forces[e.source]) {
        forces[e.source].x += fx;
        forces[e.source].y += fy;
      }
      if (forces[e.target]) {
        forces[e.target].x -= fx;
        forces[e.target].y -= fy;
      }
    }

    for (const nd of nodes) {
      const p = positions[nd.id];
      const d = Math.sqrt(p.x * p.x + p.y * p.y) || 1;
      const g = 0.02;
      const deg = (adj.get(nd.id)?.size ?? 0) + 1;
      forces[nd.id].x -= (p.x / d) * (deg * g);
      forces[nd.id].y -= (p.y / d) * (deg * g);
    }

    const cooling = Math.max(0.15, 1 - it / iterations);
    for (const nd of nodes) {
      positions[nd.id].x += forces[nd.id].x * 0.032 * cooling;
      positions[nd.id].y += forces[nd.id].y * 0.032 * cooling;
    }
  }

  // Re-centre content at the origin and roughly cap its spread so the
  // auto-fit viewBox is stable.
  const cx = nodes.reduce((s, nd) => s + positions[nd.id].x, 0) / n;
  const cy = nodes.reduce((s, nd) => s + positions[nd.id].y, 0) / n;
  let maxR = 1;
  for (const nd of nodes) {
    positions[nd.id] = { x: positions[nd.id].x - cx, y: positions[nd.id].y - cy };
    const r2 = Math.sqrt(positions[nd.id].x ** 2 + positions[nd.id].y ** 2);
    if (r2 > maxR) maxR = r2;
  }
  const targetR = Math.max(180, NODE_SEP * 1.15 * Math.sqrt(n));
  if (maxR > 0) {
    const s = targetR / maxR;
    for (const nd of nodes) {
      positions[nd.id] = { x: positions[nd.id].x * s, y: positions[nd.id].y * s };
    }
  }

  return positions;
}

function computeLayout(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  selectedId: string | null,
  displayMode: "radial" | "force"
): Record<string, Point> {
  if (displayMode === "radial") return radialLayout(nodes, edges, selectedId);
  return forceLayout(nodes, edges);
}

interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function computeBounds(positions: Record<string, Point>, ids: string[]): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const p = positions[id];
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return { minX: -400, minY: -300, maxX: 400, maxY: 300 };
  return { minX, minY, maxX, maxY };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function GraphModeHeader({
  mode,
  title,
  nodeCount,
  edgeCount,
  theme = "dark"
}: {
  mode: "entity" | "full" | "path";
  title?: string | null;
  nodeCount: number;
  edgeCount: number;
  theme?: "dark" | "blossom";
}) {
  const blossom = theme === "blossom";
  const isEntity = mode === "entity";
  const isPath = mode === "path";
  const label = isPath ? "Explained Path" : isEntity ? "Neighborhood" : "Authorized Graph";
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[75%]">
      <div className={`pointer-events-auto inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 shadow-lg backdrop-blur-md ${blossom ? "border-rose-100 bg-white/90" : "border-white/10 bg-base-900/85"}`}>
        <span
          className={`h-2 w-2 rounded-full ${isPath ? "bg-rose-500 shadow-[0_0_8px_#f43f5e]" : isEntity ? "bg-indigo-400 shadow-[0_0_8px_#818cf8]" : "bg-violet-400 shadow-[0_0_8px_#a78bfa]"}`}
        />
        <span className={`text-xs font-semibold ${blossom ? "text-slate-800" : "text-slate-100"}`}>{label}</span>
        {isEntity && title && <span className={`max-w-[220px] truncate text-xs ${blossom ? "text-rose-500" : "text-indigo-300"}`}>of {title}</span>}
        {isPath && <span className={`max-w-[220px] truncate text-xs ${blossom ? "text-rose-500" : "text-rose-300"}`}>(highlighted)</span>}
      </div>
      <div className={`mt-1.5 inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium backdrop-blur-md ${blossom ? "bg-white/85 text-slate-500" : "bg-base-900/80 text-slate-400"}`}>
        {nodeCount} nodes · {edgeCount} relationships
      </div>
    </div>
  );
}

/** Compact legend for entity types. */
export function GraphLegend({ types = LEGEND_TYPES, theme = "dark" }: { types?: string[]; theme?: "dark" | "blossom" }) {
  const blossom = theme === "blossom";
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 w-44">
      <div className={`pointer-events-auto max-h-40 overflow-hidden rounded-lg border p-2.5 shadow-lg backdrop-blur-md ${blossom ? "border-rose-100 bg-white/90" : "border-white/10 bg-base-900/90"}`}>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Legend</div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-1">
          {types.map((t) => (
          <span key={t} className={`inline-flex items-center gap-1 text-[10px] ${blossom ? "text-slate-600" : "text-slate-400"}`}>
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: colorFor(t), boxShadow: `0 0 6px ${colorFor(t)}66` }}
              />
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  children,
  theme = "dark"
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  theme?: "dark" | "blossom";
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`group flex h-8 w-8 items-center justify-center rounded-md border shadow-lg backdrop-blur-md transition focus:outline-none focus:ring-1 ${theme === "blossom" ? "border-rose-100 bg-white/90 text-slate-600 hover:border-rose-300 hover:text-rose-600 focus:ring-rose-300" : "border-white/10 bg-base-900/90 text-slate-300 hover:border-indigo-500 hover:text-white focus:ring-indigo-400"}`}
    >
      {children}
    </button>
  );
}

export default function GraphCanvas({
  nodes,
  edges,
  onSelect,
  selectedId,
  mode = "auto",
  height = 620,
  theme = "dark",
  highlightNodeIds,
  highlightEdgeIds
}: {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  onSelect?: (node: CanvasNode) => void;
  selectedId?: string | null;
  mode?: "auto" | "entity" | "full" | "path";
  height?: number;
  theme?: "dark" | "blossom";
  highlightNodeIds?: Set<string> | null;
  highlightEdgeIds?: Set<string> | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [dim, setDim] = useState({ w: 900, h: 620 });
  const dimRef = useRef({ w: 900, h: 620 });
  const movedRef = useRef(0);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const resolvedMode: "entity" | "full" | "path" =
    mode === "path"
      ? "path"
      : mode === "auto"
        ? selectedId
          ? "entity"
          : "full"
        : mode === "entity"
          ? "entity"
          : "full";

  // Defensive clean-up: skip edges whose endpoints are missing/unknown.
  const { validNodes, validEdges } = useMemo(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edgesOk = edges.filter((e) => e && e.source && e.target && nodeIds.has(e.source) && nodeIds.has(e.target));
    return { validNodes: nodes, validEdges: edgesOk };
  }, [nodes, edges]);

  const selectedNeighbors = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const set = new Set<string>();
    for (const e of validEdges) {
      if (e.source === selectedId) set.add(e.target);
      if (e.target === selectedId) set.add(e.source);
    }
    return set;
  }, [selectedId, validEdges]);

  // Path mode: which nodes/edges are "on" the currently highlighted path.
  const isPathMode = resolvedMode === "path";
  const pathNodeSet = highlightNodeIds ?? null;
  const pathEdgeSet = highlightEdgeIds ?? null;

  const layout = useMemo(
    () => computeLayout(validNodes, validEdges, selectedId ?? null, resolvedMode === "entity" || resolvedMode === "path" ? "radial" : "force"),
    [validNodes, validEdges, selectedId, resolvedMode]
  );

  const nodeIdsInLayout = useMemo(() => validNodes.filter((n) => layout[n.id]).map((n) => n.id), [validNodes, layout]);

  const degreeMap = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of validEdges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [validEdges]);

  // Measure container size (responsive).
  useEffect(() => {
    if (!wrapRef.current) return;
    const measure = () => {
      if (wrapRef.current) {
        const w = wrapRef.current.clientWidth;
        const h = Math.max(height, 320);
        dimRef.current = { w, h };
        setDim({ w, h });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [height]);

  // Compute a view transform that fits all visible nodes with padding.
  const fitTransform = useCallback(() => {
    if (nodeIdsInLayout.length === 0) return { x: 0, y: 0, k: 1 };
    const bounds = computeBounds(layout, nodeIdsInLayout);
    const { w, h } = dimRef.current;
    const pad = 80;
    const availW = w - pad * 2;
    const availH = h - pad * 2;
    if (availW <= 0 || availH <= 0) return { x: 0, y: 0, k: 1 };
    const contentW = bounds.maxX - bounds.minX || 1;
    const contentH = bounds.maxY - bounds.minY || 1;
    const k = Math.min(availW / contentW, availH / contentH, 1.4);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    return { x: w / 2 - cx * k, y: h / 2 - cy * k, k };
  }, [nodeIdsInLayout, layout]);

  // A stable signature that changes ONLY when a genuinely new graph dataset is
  // supplied (nodes/edges/mode/selected root). Used to decide when to auto-fit.
  const dataKey = useMemo(() => {
    const nodeSig = validNodes.map((n) => `${n.type}:${n.id}`).sort().join("|");
    const edgeSig = validEdges.map((e) => e.id).sort().join("|");
    const hlN = highlightNodeIds ? Array.from(highlightNodeIds).sort().join(",") : "";
    const hlE = highlightEdgeIds ? Array.from(highlightEdgeIds).sort().join(",") : "";
    return `${resolvedMode}|${selectedId ?? ""}|${nodeSig}|e:${edgeSig}|hn:${hlN}|he:${hlE}`;
  }, [validNodes, validEdges, resolvedMode, selectedId, highlightNodeIds, highlightEdgeIds]);

  const fittedKeyRef = useRef<string>("");
  const fittedWidthRef = useRef(0);
  const maybeFit = useCallback(() => {
    if (nodeIdsInLayout.length === 0) return;
    setView(fitTransform());
  }, [nodeIdsInLayout, fitTransform]);

  // Auto-fit on a NEW graph dataset (dataKey change) once the container has
  // been measured. Viewport-only changes (zoom/pan) do NOT trigger a refit, so
  // the user keeps control of the view after the initial fit. A refit also runs
  // the first time real measured dimensions arrive (the mount default is
  // 900x620, which may differ from the actual panel width).
  useEffect(() => {
    if (nodeIdsInLayout.length === 0) return;
    if (dim.w <= 0 || dim.h <= 0) return;
    const isNewKey = fittedKeyRef.current !== dataKey;
    const isFirstRealMeasure = fittedWidthRef.current === 0 && dim.w !== 900;
    if (!isNewKey && !isFirstRealMeasure) return;
    fittedKeyRef.current = dataKey;
    fittedWidthRef.current = dim.w;
    const raf = requestAnimationFrame(maybeFit);
    return () => cancelAnimationFrame(raf);
  }, [dataKey, nodeIdsInLayout, dim, maybeFit]);

  const fitViewExplicit = useCallback(() => {
    if (nodeIdsInLayout.length === 0) return;
    setView(fitTransform());
  }, [nodeIdsInLayout, fitTransform]);

  const resetView = useCallback(() => {
    setView({ x: 0, y: 0, k: 1 });
  }, []);

  const centerView = useCallback(() => {
    if (nodeIdsInLayout.length === 0) return;
    const { w, h } = dimRef.current;
    const bounds = computeBounds(layout, nodeIdsInLayout);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    setView((v) => ({ ...v, x: w / 2 - cx * v.k, y: h / 2 - cy * v.k }));
  }, [nodeIdsInLayout, layout]);

  const zoomBy = useCallback(
    (factor: number, px?: number, py?: number) => {
      const { w, h } = dimRef.current;
      setView((v) => {
        const fx = px ?? w / 2;
        const fy = py ?? h / 2;
        const nk = Math.min(4, Math.max(0.2, v.k * factor));
        const kf = nk / v.k;
        return { k: nk, x: fx - (fx - v.x) * kf, y: fy - (fy - v.y) * kf };
      });
    },
    []
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const rect = svgRef.current?.getBoundingClientRect();
      const px = e.clientX - (rect?.left ?? 0);
      const py = e.clientY - (rect?.top ?? 0);
      zoomBy(e.deltaY < 0 ? 1.12 : 0.89, px, py);
    },
    [zoomBy]
  );

  const handlePanStart = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      movedRef.current = 0;
      setDragging(true);
      setDrag({ sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [view]
  );

  const handlePanMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      movedRef.current = Math.max(movedRef.current, Math.sqrt(dx * dx + dy * dy));
      setView((v) => ({ ...v, x: drag.vx + dx, y: drag.vy + dy }));
    },
    [drag]
  );

  const handlePanEnd = useCallback(() => {
    setDragging(false);
    setDrag(null);
  }, []);

  const hoverNode = useMemo(
    () => (hoverId ? validNodes.find((n) => n.id === hoverId) ?? null : null),
    [hoverId, validNodes]
  );

  if (validNodes.length === 0) {
    return (
      <div
        ref={wrapRef}
        className="flex items-center justify-center rounded-2xl border border-dashed border-white/10 bg-base-900/50"
        style={{ height }}
      >
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 text-xl ring-1 ring-inset ring-white/10">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
              <circle cx="6" cy="6" r="2.4" />
              <circle cx="18" cy="6" r="2.4" />
              <circle cx="12" cy="18" r="2.4" />
              <path d="M8.2 6.9l5.6 8.2M15.8 6.9l-5.6 8.2" />
            </svg>
          </div>
          <div className="mt-3 text-sm font-medium text-slate-400">No graph data to show</div>
        </div>
      </div>
    );
  }

  const selectedName = selectedId ? validNodes.find((n) => n.id === selectedId)?.name ?? null : null;
  const blossom = theme === "blossom";

  return (
    <div
      ref={wrapRef}
      className={`relative overflow-hidden rounded-2xl border ${blossom ? "border-rose-100 bg-[#fffefd] shadow-[0_16px_44px_rgba(190,24,93,0.08)]" : "border-white/10 bg-base-900"}`}
      style={{
        height,
        backgroundImage:
          blossom
            ? "radial-gradient(circle at 50% 50%, rgba(244,63,94,0.10), transparent 57%), repeating-linear-gradient(0deg, rgba(244,63,94,0.075) 0 1px, transparent 1px 22px), repeating-linear-gradient(90deg, rgba(244,63,94,0.075) 0 1px, transparent 1px 22px)"
            : "radial-gradient(circle at 50% 50%, rgba(99,102,241,0.07), transparent 60%), repeating-linear-gradient(0deg, rgba(148,163,184,0.045) 0 1px, transparent 1px 44px), repeating-linear-gradient(90deg, rgba(148,163,184,0.045) 0 1px, transparent 1px 44px)"
      }}
      onMouseLeave={handlePanEnd}
    >
      <GraphModeHeader mode={resolvedMode} title={selectedName} nodeCount={validNodes.length} edgeCount={validEdges.length} theme={theme} />

      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <ControlButton label="Zoom in" onClick={() => zoomBy(1.25)} theme={theme}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </ControlButton>
        <ControlButton label="Zoom out" onClick={() => zoomBy(0.8)} theme={theme}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </ControlButton>
        <ControlButton label="Fit view" onClick={fitViewExplicit} theme={theme}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
          </svg>
        </ControlButton>
        <ControlButton label="Center graph" onClick={centerView} theme={theme}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </ControlButton>
        <ControlButton label="Reset view" onClick={resetView} theme={theme}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </ControlButton>
      </div>

      <GraphLegend theme={theme} />

      {/*
       * Keep the SVG viewport in screen coordinates and apply the calculated
       * graph transform to its contents. A viewBox cannot represent this
       * pan/zoom model: its width and height determine scale, so the earlier
       * viewBox approach ignored `view.k` and used the wrong pan space.
       */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${dim.w} ${dim.h}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}
        onWheel={handleWheel}
        onPointerDown={handlePanStart}
        onPointerMove={handlePanMove}
        onPointerUp={handlePanEnd}
        onPointerCancel={handlePanEnd}
        onMouseLeave={handlePanEnd}
      >
        <defs>
          <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {validEdges.map((e) => {
          const s = layout[e.source];
          const t = layout[e.target];
          if (!s || !t) return null;
          const isSelectedEdge = !!selectedId && (e.source === selectedId || e.target === selectedId);
          const isHoverEdge = !!hoverId && (e.source === hoverId || e.target === hoverId);
          const onPath = isPathMode && pathEdgeSet ? pathEdgeSet.has(e.id) : false;
          const isDimmed = isPathMode
            ? pathEdgeSet != null && !onPath
            : selectedNeighbors.size > 0 && !isSelectedEdge;
          const active = isSelectedEdge || isHoverEdge || (isPathMode && onPath);
          const strokeColor = active ? (blossom ? "#f43f5e" : "#818cf8") : blossom ? "#cbd5e1" : "#334155";
          const width = active ? 2.6 : 1.3;
          const mx = (s.x + t.x) / 2;
          const my = (s.y + t.y) / 2;

          return (
            <g key={e.id} opacity={isDimmed ? 0.22 : 1}>
              <line
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={strokeColor}
                strokeWidth={width}
                opacity={active ? 0.95 : 0.55}
                style={{ transition: "opacity 0.15s" }}
              />
              {active && (
                <g transform={`translate(${mx},${my})`}>
                  <rect x={-e.type.length * 2.6 - 8} y={-9} width={e.type.length * 5.2 + 16} height={18} rx={9} fill={blossom ? "#fff" : "#111827"} stroke={blossom ? "#fda4af" : "#818cf8"} strokeOpacity={0.55} opacity={0.98} />
                  <text textAnchor="middle" y={3.5} fontSize={8.5} fill={blossom ? "#e11d48" : "#c7d2fe"} fontWeight={600} letterSpacing={0.4}>
                    {e.type}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {validNodes.map((n) => {
          const p = layout[n.id];
          if (!p) return null;
          const isSelected = n.id === selectedId;
          const isNeighbor = selectedNeighbors.has(n.id);
          const onPath = isPathMode && pathNodeSet ? pathNodeSet.has(n.id) : false;
          const isDimmed = isPathMode
            ? pathNodeSet != null && !onPath
            : !!selectedId && !isSelected && !isNeighbor && selectedNeighbors.size > 0;
          const isHovered = n.id === hoverId;
          const r = isSelected ? NODE_RADIUS + 6 : isHovered ? NODE_RADIUS + 3 : isPathMode && onPath ? NODE_RADIUS + 3 : NODE_RADIUS;
          const color = colorFor(n.type);
          const isPathHighlight = isPathMode && onPath;

          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              onClick={(e) => {
                e.stopPropagation();
                // A drag that pans the canvas should not accidentally select a node.
                if (movedRef.current > 5) return;
                onSelect?.(n);
              }}
              onPointerEnter={() => setHoverId(n.id)}
              onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
              style={{
                cursor: onSelect ? "pointer" : "default",
                opacity: isDimmed ? 0.35 : 1,
                transition: "opacity 0.15s"
              }}
            >
              {isSelected && (
                <circle r={r + 5} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="3 3" style={{ transformOrigin: `${p.x}px ${p.y}px`, animation: "spin 12s linear infinite" }} />
              )}
              {isPathHighlight && !isSelected && (
                <circle r={r + 5} fill="none" stroke={blossom ? "#f43f5e" : "#f97316"} strokeOpacity={0.75} strokeWidth={1.8} />
              )}
              <circle r={r} fill="url(#nodeGlow)" opacity={isSelected ? 0.35 : 0} style={{ transition: "opacity 0.15s" }} />
              <circle
                r={r}
                fill={color}
                fillOpacity={isSelected ? 1 : isDimmed ? 0.5 : 0.85}
                stroke={isSelected ? "#fff" : blossom ? "#fff" : "#0b1220"}
                strokeWidth={isSelected ? 2 : 1.2}
                style={{
                  filter: isSelected ? `drop-shadow(0 0 8px ${color})` : "none",
                  transition: "filter 0.15s"
                }}
              />
              <text
                textAnchor="middle"
                y={r * 0.34}
                fontSize={r * 0.62}
                fontWeight={700}
                fill="#fff"
                style={{ pointerEvents: "none" }}
              >
                {(n.name[0] ?? "?").toUpperCase()}
              </text>
              <text
                y={r + 15}
                textAnchor="middle"
                fontSize={isSelected ? 12 : 10.5}
                fontWeight={isSelected ? 600 : 500}
                fill={isSelected ? (blossom ? "#111827" : "#e2e8f0") : isDimmed ? "#94a3b8" : blossom ? "#1e293b" : "#cbd5e1"}
                style={{ pointerEvents: "none" }}
              >
                {truncate(n.name, isSelected ? 26 : 22)}
              </text>
            </g>
          );
        })}
        </g>
      </svg>

      {hoverNode && (
        <div
          className="pointer-events-none absolute z-20 max-w-[240px] rounded-lg border border-white/10 bg-base-900/95 px-3 py-2 shadow-xl backdrop-blur-md"
          style={{ right: 12, top: 56 }}
        >
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFor(hoverNode.type) }} />
            <span className="truncate text-xs font-semibold text-slate-100">{hoverNode.name}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {hoverNode.type} · {degreeMap.get(hoverNode.id) ?? 0} relationships
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
