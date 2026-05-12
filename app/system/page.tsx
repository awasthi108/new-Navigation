"use client";

import { useMission } from "@/features/mission/mission-context";
import { cn } from "@/lib/cn";
import { useEffect, useMemo, useRef, useState } from "react";

// =============================================================================
// System — Live mission-control architecture visualization
// =============================================================================
//
// A single simulation loop drives:
//   - packets animating along the Frontend → API → FastAPI → ML → Response path
//   - node states (idle / processing / ok / warn)
//   - runtime log stream
//   - model status panel (Ridge, GRU, latency, forecast queue)
//   - sync strip that mirrors the packet phase into the UI surfaces it feeds
//
// The goal is to look like an operational AI control panel, not an illustration.
// =============================================================================

type NodeId = "ui" | "api" | "fastapi" | "ml" | "resp";
type LogLevel = "INFO" | "WARN" | "OK" | "DBG";
type LogEntry = { id: number; at: number; level: LogLevel; source: string; msg: string };
type Packet = {
  id: number;
  kind: "request" | "response";
  // segment index into the path list (0..PATH_COUNT-1)
  segment: number;
  // 0..1 progress within the segment
  t: number;
  speed: number; // 0..1 per second
};

type NodeState = "idle" | "processing" | "ok" | "warn";

type SystemState = {
  tick: number;
  nodes: Record<NodeId, NodeState>;
  packets: Packet[];
  logs: LogEntry[];
  logSeq: number;
  packetSeq: number;

  // model runtime
  ridge: { status: "Stable" | "Monitoring" | "Degraded"; load: number };
  gru: { status: "Stable" | "Monitoring" | "Degraded"; load: number };
  apiLatencyMs: number;
  forecastQueue: number;

  // cycle progress (for sync strip)
  cyclePhase: NodeId;

  // accents
  driftSpikePending: boolean;
  lastSpikeTick: number;
};

// Path/segment layout — five nodes strung horizontally with a resp loop at bottom.
const NODE_ORDER: NodeId[] = ["ui", "api", "fastapi", "ml", "resp"];
const PATH_COUNT = NODE_ORDER.length - 1; // 4 segments request + 1 loopback

const LOG_LIMIT = 80;

// =============================================================================
// Page
// =============================================================================

export default function SystemRoute() {
  const [state, setState] = useState<SystemState>(initialState);
  const mission = useMission();

  // When a mission anomaly arrives, stamp a WARN log and inject a burst packet
  // so the pipeline canvas visibly reacts.
  const lastMissionIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!mission.anomaly) return;
    if (lastMissionIdRef.current === mission.anomaly.id) return;
    lastMissionIdRef.current = mission.anomaly.id;
    const ev = mission.anomaly;
    setState((s) => {
      const logSeq = s.logSeq + 1;
      const logs = [
        ...s.logs,
        {
          id: logSeq,
          at: Date.now(),
          level: ev.severity === "WARNING" ? ("WARN" as const) : ("INFO" as const),
          source: "mission",
          msg: `${ev.channel} ${ev.note}`,
        },
      ].slice(-LOG_LIMIT);
      return {
        ...s,
        logs,
        logSeq,
        packets: [
          ...s.packets,
          {
            id: s.packetSeq + 500,
            kind: "response",
            segment: 0,
            t: 0,
            speed: 0.82,
          },
        ],
        forecastQueue: clamp(s.forecastQueue + 2, 0, 9),
      };
    });
  }, [mission.anomaly]);

  // 1 Hz "slow loop": emits packets, rotates cycle phase, mutates model runtime,
  // appends runtime logs.
  useEffect(() => {
    const id = window.setInterval(() => {
      setState((s) => stepSlow(s));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // 30 fps RAF loop: advances in-flight packets. State updates are scoped only
  // to the packets array to avoid unnecessary re-renders of panels.
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(performance.now());
  useEffect(() => {
    const tick = (now: number) => {
      const dt = Math.min(0.08, (now - lastRef.current) / 1000);
      lastRef.current = now;
      setState((s) => stepFast(s, dt));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="space-y-4">
      <PipelineCanvas state={state} />

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <RuntimeConsole logs={state.logs} />
        <ModelState state={state} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <EquationPanel />
        <SyncStrip state={state} />
      </section>
    </div>
  );
}

// =============================================================================
// Simulation
// =============================================================================

function initialState(): SystemState {
  return {
    tick: 0,
    nodes: { ui: "idle", api: "idle", fastapi: "idle", ml: "idle", resp: "idle" },
    packets: [],
    logs: [],
    logSeq: 0,
    packetSeq: 0,
    ridge: { status: "Stable", load: 0.22 },
    gru: { status: "Monitoring", load: 0.38 },
    apiLatencyMs: 42,
    forecastQueue: 0,
    cyclePhase: "ui",
    driftSpikePending: false,
    lastSpikeTick: -99,
  };
}

function stepSlow(s: SystemState): SystemState {
  const tick = s.tick + 1;
  const r = pseudo(tick * 9301 + 17);

  // Emit a new request packet every second, jittered.
  const nextPackets: Packet[] = s.packets.slice();
  if (r > 0.1) {
    nextPackets.push({
      id: s.packetSeq + 1,
      kind: "request",
      segment: 0,
      t: 0,
      speed: 0.55 + pseudo(tick * 131) * 0.12, // segments per second
    });
  }
  const packetSeq = s.packetSeq + 1;

  // Occasionally emit a second request to simulate burst traffic.
  if (pseudo(tick * 53) > 0.82) {
    nextPackets.push({
      id: packetSeq + 1,
      kind: "request",
      segment: 0,
      t: 0.18,
      speed: 0.5 + pseudo(tick * 211) * 0.1,
    });
  }

  // Model loads drift slowly.
  const ridgeLoad = clamp(
    s.ridge.load + (pseudo(tick * 71) - 0.5) * 0.04,
    0.08,
    0.78,
  );
  const gruLoad = clamp(s.gru.load + (pseudo(tick * 97) - 0.5) * 0.055, 0.15, 0.88);

  const ridgeStatus: SystemState["ridge"]["status"] =
    ridgeLoad > 0.7 ? "Monitoring" : "Stable";
  const gruStatus: SystemState["gru"]["status"] =
    gruLoad > 0.78 ? "Degraded" : gruLoad > 0.55 ? "Monitoring" : "Stable";

  const apiLatencyMs = clamp(
    s.apiLatencyMs * 0.9 + (32 + pseudo(tick * 29) * 28) * 0.1,
    28,
    120,
  );
  const forecastQueue = clamp(
    Math.round(s.forecastQueue + (pseudo(tick * 41) > 0.7 ? 1 : -0.4)),
    0,
    9,
  );

  // Rare spike event — triggers a WARN log and a later anomaly packet.
  const driftSpikePending = pseudo(tick ^ 0xa24baed4) > 0.985 || s.driftSpikePending;

  // Cycle phase rotation — used by the sync strip to highlight downstream UI.
  const cyclePhase = NODE_ORDER[tick % NODE_ORDER.length];

  // Append logs for this tick.
  let logs = s.logs;
  let logSeq = s.logSeq;
  const add = (level: LogLevel, source: string, msg: string) => {
    logSeq += 1;
    logs = [
      ...logs,
      { id: logSeq, at: Date.now(), level, source, msg },
    ].slice(-LOG_LIMIT);
  };

  add("INFO", "api", `residual packet received seq=${packetSeq}`);
  if (tick % 2 === 0) {
    add("DBG", "prep", `forecast horizon encoded H=${120 + ((tick * 7) % 5) * 30} min`);
  }
  if (tick % 3 === 0) {
    const rmse = (0.6 + pseudo(tick * 1009) * 0.2).toFixed(3);
    add("OK", "rt", `${pseudo(tick * 17) > 0.5 ? "ridge" : "gru"} inference completed t=${apiLatencyMs.toFixed(0)}ms`);
    add("INFO", "metrics", `rmse updated ${rmse} m`);
  }
  if (driftSpikePending && tick - s.lastSpikeTick > 4) {
    add("WARN", "detector", "GEO drift spike detected");
    // Inject a slightly faster response packet carrying the anomaly flag.
    nextPackets.push({
      id: packetSeq + 10,
      kind: "response",
      segment: PATH_COUNT - 1, // start in loopback segment
      t: 0,
      speed: 0.72,
    });
  }

  return {
    ...s,
    tick,
    packets: nextPackets,
    packetSeq: packetSeq + 1,
    logs,
    logSeq,
    ridge: { status: ridgeStatus, load: ridgeLoad },
    gru: { status: gruStatus, load: gruLoad },
    apiLatencyMs,
    forecastQueue,
    cyclePhase,
    driftSpikePending: driftSpikePending && tick - s.lastSpikeTick <= 4 ? driftSpikePending : false,
    lastSpikeTick: driftSpikePending && tick - s.lastSpikeTick > 4 ? tick : s.lastSpikeTick,
  };
}

function stepFast(s: SystemState, dt: number): SystemState {
  if (s.packets.length === 0) return s;

  const nodeTouch: Partial<Record<NodeId, NodeState>> = {};
  const remaining: Packet[] = [];

  for (const p of s.packets) {
    let seg = p.segment;
    let t = p.t + p.speed * dt;

    while (t >= 1 && seg < PATH_COUNT) {
      t -= 1;
      seg += 1;
      // Mark the node just reached as processing.
      const reached = NODE_ORDER[seg];
      if (reached) nodeTouch[reached] = "processing";

      // At FastAPI or ML, convert request to response on its way back.
      if (seg === PATH_COUNT && p.kind === "request") {
        // Loop back as response
        remaining.push({
          id: p.id + 100000,
          kind: "response",
          segment: PATH_COUNT - 1,
          t: 0,
          speed: p.speed * 1.05,
        });
        t = 0;
        seg = PATH_COUNT + 1; // mark done
        break;
      }
    }

    if (seg < PATH_COUNT) {
      remaining.push({ ...p, segment: seg, t });
    }
  }

  // Calm processing → ok fade: nodes that weren't touched this frame settle.
  const nodes: Record<NodeId, NodeState> = { ...s.nodes };
  for (const n of NODE_ORDER) {
    if (nodeTouch[n]) nodes[n] = nodeTouch[n]!;
    else if (nodes[n] === "processing") nodes[n] = "ok";
  }

  return { ...s, packets: remaining, nodes };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function pseudo(x: number) {
  let n = x | 0;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967296;
}

// =============================================================================
// Pipeline canvas (SVG)
// =============================================================================

// Canvas geometry — all coords live in a 1000×300 viewBox for clean scaling.
const VB = { w: 1000, h: 300 };
const NODES: Array<{ id: NodeId; label: string; sub: string; x: number; y: number }> = [
  { id: "ui", label: "Next.js UI", sub: "operator console", x: 92, y: 96 },
  { id: "api", label: "API Adapter", sub: "lib/api.ts", x: 298, y: 96 },
  { id: "fastapi", label: "FastAPI", sub: "/predict", x: 504, y: 96 },
  { id: "ml", label: "ML Runtime", sub: "Ridge · GRU", x: 710, y: 96 },
  { id: "resp", label: "Response", sub: "forecast, rmse, mae", x: 870, y: 220 },
];
const NODE_W = 140;
const NODE_H = 56;

// Build the segment paths once — request lane along the top, response lane back.
const SEGMENTS: Array<{ from: NodeId; to: NodeId; d: string; length: number }> = (() => {
  const out: Array<{ from: NodeId; to: NodeId; d: string; length: number }> = [];
  for (let i = 0; i < NODE_ORDER.length - 1; i++) {
    const from = NODE_ORDER[i];
    const to = NODE_ORDER[i + 1];
    const a = NODES.find((n) => n.id === from)!;
    const b = NODES.find((n) => n.id === to)!;
    const ax = a.x + NODE_W;
    const ay = a.y + NODE_H / 2;
    const bx = b.x;
    const by = b.y + NODE_H / 2;

    if (from === "ml" && to === "resp") {
      // Loop-back: ml bottom-center → response top-center via a gentle curve.
      const sx = a.x + NODE_W / 2;
      const sy = a.y + NODE_H;
      const tx = b.x + NODE_W / 2;
      const ty = b.y;
      const d = `M ${sx} ${sy} C ${sx} ${sy + 80} ${tx} ${ty - 80} ${tx} ${ty}`;
      out.push({ from, to, d, length: pathLen(d) });
    } else {
      const d = `M ${ax} ${ay} L ${bx} ${by}`;
      out.push({ from, to, d, length: pathLen(d) });
    }
  }
  return out;
})();

function pathLen(d: string): number {
  // Approximate length: for straight M..L take euclidean, for curves sample.
  const match = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (d.startsWith("M") && d.includes("L") && !d.includes("C")) {
    const [x1, y1, x2, y2] = match;
    return Math.hypot(x2 - x1, y2 - y1);
  }
  if (d.includes("C")) {
    const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = match;
    // Monte-sampled length across 16 segments
    let prevx = x1;
    let prevy = y1;
    let total = 0;
    for (let s = 1; s <= 16; s++) {
      const t = s / 16;
      const bx = bezier(x1, cx1, cx2, x2, t);
      const by = bezier(y1, cy1, cy2, y2, t);
      total += Math.hypot(bx - prevx, by - prevy);
      prevx = bx;
      prevy = by;
    }
    return total;
  }
  return 120;
}

function bezier(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function PipelineCanvas({ state }: { state: SystemState }) {
  return (
    <section className="rounded-[var(--radius-xl)] border border-slate-400/12 bg-slate-950/60">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-400/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <PulsingDot />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300/70">
              Pipeline
            </div>
            <div className="text-sm font-semibold text-slate-50">
              Frontend → API → FastAPI → ML Runtime → Response
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400/80">
          <span>in-flight <span className="text-cyan-300">{state.packets.length}</span></span>
          <span className="h-1 w-1 rounded-full bg-slate-500/70" />
          <span>cycle <span className="text-cyan-300">{NODE_ORDER.indexOf(state.cyclePhase) + 1}/5</span></span>
        </div>
      </header>

      <div className="px-3 pb-3 pt-2">
        <svg
          viewBox={`0 0 ${VB.w} ${VB.h}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-[320px] w-full"
          role="img"
          aria-label="GNSS prediction pipeline live visualization"
        >
          <defs>
            <filter id="packetTrail" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.2" />
            </filter>
            <radialGradient id="packetFill" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(186,230,253,1)" />
              <stop offset="60%" stopColor="rgba(34,211,238,0.95)" />
              <stop offset="100%" stopColor="rgba(34,211,238,0)" />
            </radialGradient>
            <marker id="sysArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.55)" />
            </marker>
          </defs>

          {/* grid backdrop */}
          <GridLines />

          {/* segment paths */}
          {SEGMENTS.map((seg, i) => (
            <path
              key={i}
              d={seg.d}
              fill="none"
              stroke="rgba(148,163,184,0.22)"
              strokeWidth={1}
              strokeDasharray="2 4"
              markerEnd="url(#sysArrow)"
            />
          ))}

          {/* packets on each segment */}
          {state.packets.map((p) => (
            <PacketDot key={`${p.id}-${p.kind}`} packet={p} />
          ))}

          {/* nodes */}
          {NODES.map((n) => (
            <PipelineNode
              key={n.id}
              node={n}
              status={state.nodes[n.id]}
              activePhase={state.cyclePhase === n.id}
            />
          ))}

          {/* cycle phase ribbon (top strip) */}
          <CyclePhaseRibbon phase={state.cyclePhase} />
        </svg>
      </div>
    </section>
  );
}

function GridLines() {
  const rows = 6;
  const cols = 20;
  const items: React.ReactElement[] = [];
  for (let r = 1; r < rows; r++) {
    const y = (r / rows) * VB.h;
    items.push(
      <line
        key={`gr-${r}`}
        x1={0}
        x2={VB.w}
        y1={y}
        y2={y}
        stroke="rgba(148,163,184,0.055)"
        strokeDasharray="1 4"
      />,
    );
  }
  for (let c = 1; c < cols; c++) {
    const x = (c / cols) * VB.w;
    items.push(
      <line
        key={`gc-${c}`}
        x1={x}
        x2={x}
        y1={0}
        y2={VB.h}
        stroke="rgba(148,163,184,0.04)"
      />,
    );
  }
  return <g>{items}</g>;
}

function CyclePhaseRibbon({ phase }: { phase: NodeId }) {
  const idx = NODE_ORDER.indexOf(phase);
  const segWidth = VB.w / NODE_ORDER.length;
  const x = idx * segWidth;
  return (
    <g>
      <rect x={0} y={0} width={VB.w} height={3} fill="rgba(148,163,184,0.08)" />
      <rect
        x={x}
        y={0}
        width={segWidth}
        height={3}
        fill="rgba(34,211,238,0.7)"
        style={{ transition: "x 600ms ease" }}
      />
    </g>
  );
}

function PipelineNode({
  node,
  status,
  activePhase,
}: {
  node: (typeof NODES)[number];
  status: NodeState;
  activePhase: boolean;
}) {
  const statusColor = {
    idle: "rgba(148,163,184,0.35)",
    processing: "rgba(34,211,238,0.9)",
    ok: "rgba(52,211,153,0.85)",
    warn: "rgba(251,146,60,0.9)",
  }[status];

  const borderColor = activePhase ? "rgba(34,211,238,0.55)" : "rgba(148,163,184,0.22)";

  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={NODE_W}
        height={NODE_H}
        rx={6}
        fill="rgba(2,6,23,0.85)"
        stroke={borderColor}
        strokeWidth={activePhase ? 1.25 : 1}
      />
      <text
        x={node.x + 12}
        y={node.y + 20}
        fill="rgba(248,250,252,0.95)"
        fontSize="12"
        fontWeight={600}
        fontFamily="var(--font-geist-sans), ui-sans-serif, system-ui"
      >
        {node.label}
      </text>
      <text
        x={node.x + 12}
        y={node.y + 38}
        fill="rgba(203,213,225,0.7)"
        fontSize="10"
        fontFamily="var(--font-geist-mono), ui-monospace, monospace"
      >
        {node.sub}
      </text>
      <circle cx={node.x + NODE_W - 12} cy={node.y + 14} r={3.5} fill={statusColor}>
        {status === "processing" ? (
          <animate attributeName="r" values="3;4.5;3" dur="0.9s" repeatCount="indefinite" />
        ) : null}
      </circle>
      <text
        x={node.x + NODE_W - 12}
        y={node.y + NODE_H - 8}
        textAnchor="end"
        fill="rgba(148,163,184,0.65)"
        fontSize="8"
        fontFamily="var(--font-geist-mono), ui-monospace, monospace"
        letterSpacing="0.1em"
      >
        {status.toUpperCase()}
      </text>
    </g>
  );
}

function PacketDot({ packet }: { packet: Packet }) {
  const seg = SEGMENTS[packet.segment];
  if (!seg) return null;
  const pt = pointOnPath(seg.d, packet.t);
  if (!pt) return null;

  const color = packet.kind === "request" ? "rgba(34,211,238,0.95)" : "rgba(129,140,248,0.95)";

  return (
    <g>
      {/* trail */}
      <circle cx={pt.x} cy={pt.y} r={6} fill={color} opacity={0.12} filter="url(#packetTrail)" />
      <circle cx={pt.x} cy={pt.y} r={3.4} fill="url(#packetFill)" />
      <circle cx={pt.x} cy={pt.y} r={1.4} fill={color} />
    </g>
  );
}

function pointOnPath(d: string, t: number): { x: number; y: number } | null {
  const match = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!match) return null;
  if (d.includes("C")) {
    const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = match;
    return {
      x: bezier(x1, cx1, cx2, x2, t),
      y: bezier(y1, cy1, cy2, y2, t),
    };
  }
  const [x1, y1, x2, y2] = match;
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
}

// =============================================================================
// Runtime console
// =============================================================================

function RuntimeConsole({ logs }: { logs: LogEntry[] }) {
  // Reverse-column trick: the scroll container lists logs newest-first inside
  // the DOM, but `flex-col-reverse` renders them bottom-up visually.
  // Browsers then keep the scrollbar anchored at the bottom by default, and
  // the user can scroll up freely to read older entries without any JS
  // fighting their scroll position.
  const ordered = useMemo(() => [...logs].reverse(), [logs]);

  return (
    <section className="flex h-full min-h-[320px] flex-col rounded-[var(--radius-xl)] border border-slate-400/12 bg-slate-950/60">
      <header className="flex items-center justify-between border-b border-slate-400/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <PulsingDot size={6} />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300/70">
              Runtime Console
            </div>
            <div className="text-sm font-semibold text-slate-50">stdout · /var/log/navai.log</div>
          </div>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400/75">
          <span>{logs.length}</span>
          <span className="h-1 w-1 rounded-full bg-slate-500/70" />
          <span>tail -f</span>
        </div>
      </header>

      <div className="relative h-[320px] overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-[linear-gradient(180deg,rgba(2,6,23,0.9),transparent)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-4 bg-[linear-gradient(0deg,rgba(2,6,23,0.9),transparent)]" />
        <div className="flex h-full flex-col-reverse overflow-y-auto overscroll-contain px-4 py-3 font-mono text-[11.5px] leading-relaxed">
          {ordered.map((log) => (
            <LogRow key={log.id} log={log} />
          ))}
        </div>
      </div>
    </section>
  );
}

function LogRow({ log }: { log: LogEntry }) {
  const color = {
    INFO: "text-slate-300/85",
    OK: "text-emerald-300/85",
    WARN: "text-amber-300",
    DBG: "text-slate-500/85",
  }[log.level];
  return (
    <div className="grid grid-cols-[88px_60px_64px_1fr] gap-2 whitespace-pre">
      <span className="text-slate-500/80">{formatTimeIst(log.at)}</span>
      <span className={cn("font-semibold tracking-[0.08em]", color)}>[{log.level}]</span>
      <span className="text-cyan-300/70">{log.source.padEnd(8, " ")}</span>
      <span className="text-slate-200/80">{log.msg}</span>
    </div>
  );
}

// =============================================================================
// Model state
// =============================================================================

function ModelState({ state }: { state: SystemState }) {
  return (
    <section className="rounded-[var(--radius-xl)] border border-slate-400/12 bg-slate-950/60 p-4">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300/70">
          Model Runtime
        </div>
        <div className="text-sm font-semibold text-slate-50">Inference &amp; transport state</div>
      </header>

      <div className="mt-3 grid gap-2">
        <ModelRow
          name="Ridge"
          status={state.ridge.status}
          load={state.ridge.load}
          foot="linear baseline · GEO drift"
        />
        <ModelRow
          name="GRU"
          status={state.gru.status}
          load={state.gru.load}
          foot="sequence · MEO short-window"
        />

        <KPIRow
          label="API Latency"
          value={`${state.apiLatencyMs.toFixed(0)} ms`}
          accent={state.apiLatencyMs > 90 ? "warn" : state.apiLatencyMs > 70 ? "watch" : "ok"}
          hint="p50 rolling 30s"
        />
        <KPIRow
          label="Forecast Queue"
          value={`${state.forecastQueue}`}
          accent={state.forecastQueue > 5 ? "warn" : state.forecastQueue > 2 ? "watch" : "ok"}
          hint={`${state.forecastQueue === 0 ? "drained" : "jobs pending"}`}
        />
      </div>
    </section>
  );
}

function ModelRow({
  name,
  status,
  load,
  foot,
}: {
  name: string;
  status: "Stable" | "Monitoring" | "Degraded";
  load: number;
  foot: string;
}) {
  const pill = {
    Stable: "border-emerald-400/25 bg-emerald-500/8 text-emerald-200",
    Monitoring: "border-amber-400/25 bg-amber-500/8 text-amber-200",
    Degraded: "border-rose-400/25 bg-rose-500/10 text-rose-200",
  }[status];

  const bar = {
    Stable: "bg-emerald-400/80",
    Monitoring: "bg-amber-400/80",
    Degraded: "bg-rose-400/80",
  }[status];

  return (
    <div className="rounded-md border border-slate-400/10 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-slate-50">{name}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400/70">
            {foot}
          </span>
        </div>
        <span
          className={cn(
            "inline-flex rounded-sm border px-1.5 py-[2px] font-mono text-[9px] font-semibold uppercase tracking-[0.2em]",
            pill,
          )}
        >
          {status}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 overflow-hidden rounded-full bg-slate-800/80 h-[3px]">
          <div
            className={cn("h-full rounded-full", bar)}
            style={{ width: `${Math.round(load * 100)}%`, transition: "width 600ms ease" }}
          />
        </div>
        <span className="font-mono text-[10px] tabular-nums text-slate-400/80">
          {Math.round(load * 100)}%
        </span>
      </div>
    </div>
  );
}

function KPIRow({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent: "ok" | "watch" | "warn";
  hint: string;
}) {
  const color = {
    ok: "text-emerald-300",
    watch: "text-amber-300",
    warn: "text-rose-300",
  }[accent];

  return (
    <div className="flex items-center justify-between rounded-md border border-slate-400/10 bg-slate-950/40 px-3 py-2.5">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400/75">
          {label}
        </div>
        <div className="text-[11px] text-slate-400/80">{hint}</div>
      </div>
      <div className={cn("font-mono text-lg font-semibold tabular-nums", color)}>{value}</div>
    </div>
  );
}

// =============================================================================
// Equations
// =============================================================================

function EquationPanel() {
  return (
    <section className="rounded-[var(--radius-xl)] border border-slate-400/12 bg-slate-950/60 p-4">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300/70">
          Model Math
        </div>
        <div className="text-sm font-semibold text-slate-50">Reference equations</div>
      </header>

      <div className="mt-3 grid gap-2">
        <EquationCard
          title="Ridge Objective"
          sub="argmin over β"
          svg={<RidgeEquation />}
        />
        <EquationCard title="RMSE" sub="root mean square error" svg={<RmseEquation />} />
        <EquationCard
          title="Sliding Window"
          sub={`x_{t-N+1..t}  →  \u0177_{t+1..t+H}`}
          svg={<WindowEquation />}
        />
      </div>
    </section>
  );
}

function EquationCard({
  title,
  sub,
  svg,
}: {
  title: string;
  sub: string;
  svg: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-slate-400/10 bg-slate-950/40 px-3 py-2.5">
      <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-slate-400/75">
        <span>{title}</span>
        <span className="text-slate-500/80">{sub}</span>
      </div>
      <div className="mt-2">{svg}</div>
    </div>
  );
}

// Minimal serif math rendered as SVG — keeps typography elegant without KaTeX.
function RidgeEquation() {
  return (
    <svg viewBox="0 0 360 38" className="h-10 w-full" role="img" aria-label="Ridge regression objective">
      <g
        fill="rgba(226,232,240,0.92)"
        fontFamily="'Cambria Math', 'STIX Two Math', 'Latin Modern Math', 'Times New Roman', serif"
        fontSize="18"
      >
        <text x="4" y="24" fontStyle="italic">β̂</text>
        <text x="30" y="24">=</text>
        <text x="48" y="24" fontStyle="italic">argmin</text>
        <text x="106" y="18" fontSize="10" fill="rgba(148,163,184,0.85)">β</text>
        <text x="118" y="24">‖</text>
        <text x="127" y="24" fontStyle="italic">y</text>
        <text x="140" y="24">−</text>
        <text x="155" y="24" fontStyle="italic">X</text>
        <text x="168" y="24" fontStyle="italic">β</text>
        <text x="180" y="24">‖</text>
        <text x="190" y="16" fontSize="11" fill="rgba(148,163,184,0.85)">2</text>
        <text x="202" y="16" fontSize="11" fill="rgba(148,163,184,0.85)">2</text>
        <text x="214" y="24">+</text>
        <text x="230" y="24" fontStyle="italic" fill="rgba(125,211,252,0.95)">λ</text>
        <text x="244" y="24">‖</text>
        <text x="254" y="24" fontStyle="italic">β</text>
        <text x="268" y="24">‖</text>
        <text x="278" y="16" fontSize="11" fill="rgba(148,163,184,0.85)">2</text>
        <text x="290" y="16" fontSize="11" fill="rgba(148,163,184,0.85)">2</text>
      </g>
    </svg>
  );
}

function RmseEquation() {
  return (
    <svg viewBox="0 0 360 44" className="h-11 w-full" role="img" aria-label="RMSE formula">
      <g
        fill="rgba(226,232,240,0.92)"
        fontFamily="'Cambria Math', 'STIX Two Math', 'Latin Modern Math', 'Times New Roman', serif"
        fontSize="18"
      >
        <text x="4" y="26" fontStyle="italic">RMSE</text>
        <text x="60" y="26">=</text>
        {/* radical */}
        <path
          d="M 78 18 L 84 30 L 92 10 L 345 10"
          stroke="rgba(226,232,240,0.92)"
          strokeWidth="1"
          fill="none"
          strokeLinejoin="round"
        />
        {/* 1/N */}
        <text x="96" y="22" fontSize="14">1/</text>
        <text x="116" y="22" fontSize="14" fontStyle="italic">N</text>
        {/* sum */}
        <text x="140" y="30" fontSize="22">Σ</text>
        <text x="160" y="26" fontStyle="italic">(y</text>
        <text x="182" y="18" fontSize="11" fontStyle="italic">i</text>
        <text x="192" y="26">−</text>
        <text x="210" y="26" fontStyle="italic">ŷ</text>
        <text x="224" y="18" fontSize="11" fontStyle="italic">i</text>
        <text x="232" y="26">)</text>
        <text x="242" y="18" fontSize="11">2</text>
      </g>
    </svg>
  );
}

function WindowEquation() {
  return (
    <svg viewBox="0 0 380 32" className="h-8 w-full" role="img" aria-label="Sliding window notation">
      <g
        fill="rgba(226,232,240,0.92)"
        fontFamily="'Cambria Math', 'STIX Two Math', 'Latin Modern Math', 'Times New Roman', serif"
        fontSize="16"
      >
        <text x="4" y="22" fontStyle="italic">x</text>
        <text x="14" y="14" fontSize="10" fill="rgba(148,163,184,0.85)">t−N+1 : t</text>
        <text x="94" y="22" fontFamily="var(--font-geist-mono), monospace" fill="rgba(125,211,252,0.9)">⟶</text>
        <text x="118" y="22" fontStyle="italic">f</text>
        <text x="126" y="14" fontSize="10" fill="rgba(148,163,184,0.85)">θ</text>
        <text x="138" y="22">(·)</text>
        <text x="170" y="22" fontFamily="var(--font-geist-mono), monospace" fill="rgba(125,211,252,0.9)">⟶</text>
        <text x="194" y="22" fontStyle="italic">ŷ</text>
        <text x="206" y="14" fontSize="10" fill="rgba(148,163,184,0.85)">t+1 : t+H</text>
      </g>
    </svg>
  );
}

// =============================================================================
// Sync strip
// =============================================================================

function SyncStrip({ state }: { state: SystemState }) {
  const phases: Array<{ id: NodeId; label: string; surface: string }> = [
    { id: "ui", label: "UI", surface: "operator controls sampled" },
    { id: "api", label: "API", surface: "lib/api.ts emits predict()" },
    { id: "fastapi", label: "FastAPI", surface: "backend forecast encoded" },
    { id: "ml", label: "ML", surface: "inference → predictions + rmse" },
    { id: "resp", label: "UI", surface: "chart + satellite + metrics updated" },
  ];
  const activeIdx = NODE_ORDER.indexOf(state.cyclePhase);

  return (
    <section className="rounded-[var(--radius-xl)] border border-slate-400/12 bg-slate-950/60 p-4">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300/70">
          Real-time Synchronization
        </div>
        <div className="text-sm font-semibold text-slate-50">
          Cycle phase propagates into chart, satellite, metrics
        </div>
      </header>

      <ol className="mt-3 grid gap-1.5">
        {phases.map((p, i) => {
          const active = i === activeIdx;
          const done = i < activeIdx;
          return (
            <li
              key={i}
              className={cn(
                "grid grid-cols-[28px_80px_1fr_auto] items-center gap-3 rounded-md border px-3 py-2 transition-[border-color,background] duration-300",
                active
                  ? "border-cyan-300/40 bg-cyan-500/5"
                  : done
                  ? "border-slate-400/15 bg-slate-950/45"
                  : "border-slate-400/10 bg-slate-950/30",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-sm font-mono text-[10px] font-semibold",
                  active ? "bg-cyan-500/10 text-cyan-200" : "bg-slate-800/60 text-slate-400/80",
                )}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-300/80">
                {p.label}
              </span>
              <span className="text-[13px] text-slate-200/90">{p.surface}</span>
              <span
                className={cn(
                  "font-mono text-[9px] uppercase tracking-[0.2em]",
                  active ? "text-cyan-300" : done ? "text-emerald-300/80" : "text-slate-500/80",
                )}
              >
                {active ? "syncing" : done ? "ack" : "—"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// =============================================================================
// Shared atoms
// =============================================================================

function PulsingDot({ size = 8 }: { size?: number }) {
  return (
    <span className="relative inline-flex" style={{ height: size, width: size }}>
      <span
        className="absolute inline-flex animate-ping rounded-full bg-cyan-400/55"
        style={{ height: size, width: size }}
      />
      <span
        className="relative inline-flex rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.55)]"
        style={{ height: size, width: size }}
      />
    </span>
  );
}

const IST_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatTimeIst(ms: number) {
  return IST_TIME.format(new Date(ms));
}
