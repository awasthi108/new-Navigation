"use client";

import { Select } from "@/components/ui/Select";
import { useMission } from "@/features/mission/mission-context";
import { useTelemetry } from "@/hooks/useTelemetry";
import { cn } from "@/lib/cn";
import { useEffect, useMemo, useRef, useState } from "react";

// =============================================================================
// AI-assisted GNSS diagnostics — live view
// =============================================================================
//
// A single simulation state ("SimState") evolves every second and drives every
// panel on the page, so the Assessment strip, Insights feed, Forecast Analysis
// charts, and Alerts all move coherently.
//
// Nothing here is static — cards react to drift, variance, confidence, and
// anomaly events; the insights feed phrases observations from those same
// state transitions.
//
// =============================================================================

type Regime = "STABLE" | "WATCH" | "WARNING";
type ModelId = "GRU" | "Ridge";
type Axis = "X" | "Y" | "Z" | "Clock";
type SatClass = "GEO" | "MEO";

type SimState = {
  tick: number;
  // operational context
  satellite: SatClass;
  axis: Axis;
  horizonMin: number;
  // dynamics
  driftRate: number; // m / min — low-frequency drift in residual mean
  variance: number; // m^2   — short-term residual variance
  clockBias: number; // m    — running clock bias estimate
  divergence: number; // m   — forecast vs measured spread
  confidence: number; // 0..1 — forecast confidence (model-reported)
  // events
  anomalyActive: boolean;
  anomalyAmp: number; // m
  anomalyAgeSec: number; // since last spike
  anomalyCount: number;
  // derivatives
  regime: Regime;
  recommendedModel: ModelId;
  // history (for mini-charts & trend phrasing)
  driftSeries: number[]; // last N drift samples
  divergenceSeries: number[];
  histogram: number[]; // 9 bins
};

type InsightSeverity = "INFO" | "NOTE" | "WATCH" | "WARN";
type InsightKind =
  | "variance"
  | "confidence"
  | "bias"
  | "recovery"
  | "recommend"
  | "anomaly"
  | "horizon"
  | "drift";

type Insight = {
  id: number;
  at: number; // epoch ms
  severity: InsightSeverity;
  kind: InsightKind;
  tag: string;
  message: string;
};

const SERIES_LEN = 56;
const HIST_BINS = 9;
const FEED_LIMIT = 9;

// =============================================================================
// Page component
// =============================================================================

export default function InsightsRoute() {
  const [sim, setSim] = useState<SimState>(initialState);
  const [feed, setFeed] = useState<Insight[]>([]);
  const [lastAssessed, setLastAssessed] = useState<number | null>(null);
  const idRef = useRef(0);
  const mission = useMission();
  const telemetry = useTelemetry();

  // Mission anomaly injection: bump variance/divergence and drop a WARN into
  // the feed the moment a new mission-level anomaly event arrives.
  const lastMissionAnomalyRef = useRef<number | null>(null);
  useEffect(() => {
    if (!mission.anomaly) return;
    if (lastMissionAnomalyRef.current === mission.anomaly.id) return;
    lastMissionAnomalyRef.current = mission.anomaly.id;

    const ev = mission.anomaly;
    setSim((prev) => ({
      ...prev,
      variance: clamp(prev.variance + 0.08, 0.008, 0.38),
      divergence: clamp(prev.divergence + 0.22, 0.05, 1.6),
      anomalyActive: true,
      anomalyAmp: 0.18,
      anomalyAgeSec: 0,
      anomalyCount: prev.anomalyCount + 1,
    }));

    idRef.current += 1;
    setFeed((cur) =>
      [
        {
          id: idRef.current,
          at: Date.now(),
          severity: ev.severity === "WARNING" ? ("WARN" as const) : ("WATCH" as const),
          kind: "anomaly" as const,
          tag: "MISSION",
          message: `${ev.channel}: ${ev.note}; residual stream deviating.`,
        },
        ...cur,
      ].slice(0, FEED_LIMIT),
    );
  }, [mission.anomaly]);

  // When the telemetry replay cycle restarts, emit a feed observation so the
  // insights page reflects the seamless wrap-around.
  const prevCycleRef = useRef(telemetry.cycleEvent);
  useEffect(() => {
    if (telemetry.cycleEvent === prevCycleRef.current) return;
    prevCycleRef.current = telemetry.cycleEvent;
    idRef.current += 1;
    setFeed((cur) =>
      [
        {
          id: idRef.current,
          at: Date.now(),
          severity: "INFO" as const,
          kind: "recovery" as const,
          tag: "STREAM",
          message: `Telemetry replay cycle restarted (cycle ${telemetry.cycleCount}); stream continuous.`,
        },
        ...cur,
      ].slice(0, FEED_LIMIT),
    );
  }, [telemetry.cycleEvent, telemetry.cycleCount]);

  // 1 Hz simulator — evolves state deterministically with slow drift,
  // occasional regime shifts, and rare anomalies.
  useEffect(() => {
    const id = window.setInterval(() => {
      setSim((prev) => advance(prev));
      setLastAssessed(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Operator context changes (satellite / axis / horizon) flow directly into
  // the simulator and nudge the dynamics so downstream insights react.
  const setContext = (patch: Partial<Pick<SimState, "satellite" | "axis" | "horizonMin">>) => {
    setSim((prev) => {
      const next: SimState = { ...prev, ...patch };
      // Gentle nudges so the feed reflects a context change without a jump.
      if (patch.satellite && patch.satellite !== prev.satellite) {
        next.driftRate = prev.driftRate * (patch.satellite === "GEO" ? 1.45 : 0.7);
        next.variance = prev.variance * (patch.satellite === "GEO" ? 0.8 : 1.25);
      }
      if (patch.axis && patch.axis !== prev.axis) {
        next.variance = prev.variance * (patch.axis === "Clock" ? 1.3 : patch.axis === "Z" ? 1.1 : 0.95);
      }
      if (patch.horizonMin && patch.horizonMin !== prev.horizonMin) {
        const delta = patch.horizonMin - prev.horizonMin;
        next.divergence = clamp(prev.divergence + delta * 0.0012, 0.05, 1.6);
      }
      return next;
    });
  };

  // Insight generator — emits observations on state transitions and
  // periodically on steady-state so the feed keeps moving.
  const prevSimRef = useRef<SimState | null>(null);
  const lastEmitRef = useRef<number>(0);
  useEffect(() => {
    const now = Date.now();
    const prev = prevSimRef.current;
    const newInsights: Insight[] = [];

    const emit = (ins: Omit<Insight, "id" | "at">) => {
      newInsights.push({ ...ins, id: ++idRef.current, at: now });
    };

    // Transition-based observations
    if (prev) {
      if (prev.satellite !== sim.satellite || prev.axis !== sim.axis) {
        emit({
          severity: "NOTE",
          kind: "recommend",
          tag: "CONTEXT",
          message: `Operator focus moved to ${sim.satellite} ${sim.axis}; re-baselining residual stream.`,
        });
      }
      if (prev.horizonMin !== sim.horizonMin) {
        emit({
          severity: "NOTE",
          kind: "horizon",
          tag: "HORIZON",
          message: `Horizon set to ${formatHorizon(sim.horizonMin)}; uncertainty envelope rescaled.`,
        });
      }

      if (prev.regime !== sim.regime) {
        if (sim.regime === "STABLE") {
          emit({
            severity: "INFO",
            kind: "recovery",
            tag: "STABILITY",
            message: `Short-term forecast stability recovered; divergence ${sim.divergence.toFixed(
              2,
            )} m within band.`,
          });
        } else if (sim.regime === "WATCH") {
          emit({
            severity: "WATCH",
            kind: "drift",
            tag: "DRIFT",
            message: `Residual variance increasing on ${sim.satellite} ${sim.axis} channel (σ²=${sim.variance.toFixed(
              3,
            )}).`,
          });
        } else {
          emit({
            severity: "WARN",
            kind: "drift",
            tag: "DIVERGENCE",
            message: `Forecast divergence exceeded warn band at ${formatHorizon(sim.horizonMin)} horizon (Δ=${sim.divergence.toFixed(
              2,
            )} m).`,
          });
        }
      }

      if (!prev.anomalyActive && sim.anomalyActive) {
        emit({
          severity: "WARN",
          kind: "anomaly",
          tag: "SPIKE",
          message: `Spike detected on ${sim.satellite} ${sim.axis}, amplitude ${sim.anomalyAmp.toFixed(
            2,
          )} m, logged.`,
        });
      }

      if (prev.recommendedModel !== sim.recommendedModel) {
        const reason =
          sim.recommendedModel === "GRU"
            ? `short-window dynamics dominant (σ²=${sim.variance.toFixed(3)})`
            : `long-horizon drift dominant (${(sim.driftRate * 60).toFixed(3)} m/min)`;
        emit({
          severity: "NOTE",
          kind: "recommend",
          tag: "MODEL",
          message: `Recommended model switched to ${sim.recommendedModel}; ${reason}.`,
        });
      }

      if (Math.abs(prev.confidence - sim.confidence) > 0.04) {
        if (sim.confidence < prev.confidence) {
          emit({
            severity: "WATCH",
            kind: "confidence",
            tag: "CONFIDENCE",
            message: `${sim.recommendedModel} confidence reduced to ${(sim.confidence * 100).toFixed(
              1,
            )}% at ${formatHorizon(sim.horizonMin)} horizon.`,
          });
        } else {
          emit({
            severity: "INFO",
            kind: "confidence",
            tag: "CONFIDENCE",
            message: `Forecast confidence recovered to ${(sim.confidence * 100).toFixed(
              1,
            )}% on ${sim.satellite} channel.`,
          });
        }
      }
    }

    // Steady-state periodic observations (every 4–6s) so the feed keeps moving.
    if (now - lastEmitRef.current > 4500 && newInsights.length === 0) {
      lastEmitRef.current = now;
      newInsights.push(periodicObservation(sim, ++idRef.current, now));
    } else if (newInsights.length > 0) {
      lastEmitRef.current = now;
    }

    if (newInsights.length > 0) {
      setFeed((cur) => [...newInsights, ...cur].slice(0, FEED_LIMIT));
    }

    prevSimRef.current = sim;
  }, [sim]);

  // Seed the feed with a single boot observation so it isn't empty.
  useEffect(() => {
    const boot: Insight = {
      id: ++idRef.current,
      at: Date.now(),
      severity: "INFO",
      kind: "recovery",
      tag: "BOOT",
      message: "AI diagnostics online; monitoring residual streams at 1 Hz.",
    };
    setFeed([boot]);
  }, []);

  return (
    <div className="space-y-4">
      <AssessmentPanel sim={sim} lastAssessed={lastAssessed} onContextChange={setContext} />

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <InsightsFeed items={feed} />
        <ForecastAnalysis sim={sim} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        <ModelReasoning sim={sim} />
        <AlertPanel sim={sim} />
      </section>
    </div>
  );
}

// =============================================================================
// Simulation
// =============================================================================

function initialState(): SimState {
  const zeros = (n: number) => new Array(n).fill(0);
  return {
    tick: 0,
    satellite: "GEO",
    axis: "Clock",
    horizonMin: 120,
    driftRate: 0.0008,
    variance: 0.04,
    clockBias: 0.012,
    divergence: 0.18,
    confidence: 0.94,
    anomalyActive: false,
    anomalyAmp: 0,
    anomalyAgeSec: 999,
    anomalyCount: 0,
    regime: "STABLE",
    recommendedModel: "GRU",
    driftSeries: zeros(SERIES_LEN),
    divergenceSeries: Array.from({ length: SERIES_LEN }, () => 0.18),
    histogram: Array.from({ length: HIST_BINS }, (_, i) => gaussianBin(i, HIST_BINS)),
  };
}

function advance(s: SimState): SimState {
  const tick = s.tick + 1;
  const r = pseudo(tick * 9301 + s.tick * 49297);

  // Slow drift of the drift rate itself (low-frequency meander).
  const driftNoise = (pseudo(tick * 131 + 17) - 0.5) * 0.00012;
  const driftMean = 0.0006 * Math.sin(tick * 0.012) + 0.0004 * Math.cos(tick * 0.0037);
  const driftRate = clamp(s.driftRate * 0.985 + driftMean * 0.015 + driftNoise, -0.004, 0.004);

  // Variance mean-reverts toward a slow target modulated by drift magnitude.
  const varTarget = 0.025 + Math.abs(driftRate) * 18 + 0.012 * Math.sin(tick * 0.018);
  const variance = clamp(
    s.variance * 0.88 + varTarget * 0.12 + (pseudo(tick * 71) - 0.5) * 0.004,
    0.008,
    0.38,
  );

  // Clock bias wanders slowly within ±0.05 m band.
  const clockBias = clamp(
    s.clockBias * 0.995 + (pseudo(tick * 53) - 0.5) * 0.0018 + driftRate * 0.3,
    -0.12,
    0.12,
  );

  // Forecast divergence grows with variance and drift, eases on recovery.
  const divTarget = 0.12 + variance * 2.2 + Math.abs(driftRate) * 30;
  const divergence = clamp(s.divergence * 0.86 + divTarget * 0.14, 0.05, 1.6);

  // Anomaly events — rare (~1/90s expected) with brief tail.
  let anomalyActive = s.anomalyActive;
  let anomalyAmp = s.anomalyAmp;
  let anomalyAgeSec = s.anomalyAgeSec + 1;
  let anomalyCount = s.anomalyCount;
  if (anomalyAgeSec > 18 && r > 0.988) {
    anomalyActive = true;
    anomalyAmp = 0.12 + pseudo(tick * 11) * 0.26;
    anomalyAgeSec = 0;
    anomalyCount += 1;
  } else if (anomalyAgeSec > 6) {
    anomalyActive = false;
    anomalyAmp = 0;
  }

  // Confidence — derived from variance, divergence, anomaly proximity.
  const anomalyPenalty = anomalyAgeSec < 12 ? (12 - anomalyAgeSec) * 0.01 : 0;
  const rawConf = 1 - clamp(variance * 0.9 + divergence * 0.18 + anomalyPenalty, 0, 0.45);
  const confidence = clamp(s.confidence * 0.82 + rawConf * 0.18, 0.55, 0.995);

  // Regime from variance + divergence + confidence.
  const regime: Regime =
    divergence > 0.75 || confidence < 0.72 || anomalyActive
      ? "WARNING"
      : divergence > 0.42 || variance > 0.11 || confidence < 0.86
      ? "WATCH"
      : "STABLE";

  // Recommended model — GRU for short-window / high-variance,
  // Ridge for long-horizon / low-variance drift-dominant regimes.
  const driftDominant = Math.abs(driftRate) * 40 > variance;
  const recommendedModel: ModelId = driftDominant && s.horizonMin >= 90 ? "Ridge" : "GRU";

  // Histories
  const driftSeries = pushClamped(s.driftSeries, driftRate, SERIES_LEN);
  const divergenceSeries = pushClamped(s.divergenceSeries, divergence, SERIES_LEN);

  // Histogram — slowly shifts mass based on sign of drift and anomaly presence.
  const histogram = advanceHistogram(s.histogram, driftRate, variance, anomalyActive);

  return {
    ...s,
    tick,
    driftRate,
    variance,
    clockBias,
    divergence,
    confidence,
    anomalyActive,
    anomalyAmp,
    anomalyAgeSec,
    anomalyCount,
    regime,
    recommendedModel,
    driftSeries,
    divergenceSeries,
    histogram,
  };
}

function advanceHistogram(cur: number[], drift: number, variance: number, anomaly: boolean) {
  // Target distribution: slightly shifted Gaussian with drift-dependent skew.
  const shift = Math.round(drift * 800); // bins of influence
  const skew = anomaly ? 0.9 : 0;
  const target = cur.map((_, i) => {
    const ideal = gaussianBin(i - shift, HIST_BINS, 1 + variance * 8);
    const tailBoost = i >= HIST_BINS - 2 ? skew * 0.22 : 0;
    return ideal + tailBoost;
  });
  const sum = target.reduce((a, b) => a + b, 0) || 1;
  const norm = target.map((v) => v / sum);
  return cur.map((v, i) => v * 0.85 + norm[i] * 0.15);
}

function gaussianBin(i: number, bins: number, sigmaScale = 1) {
  const center = (bins - 1) / 2;
  const sigma = (bins / 3) * sigmaScale;
  return Math.exp(-((i - center) ** 2) / (2 * sigma * sigma));
}

function pushClamped(arr: number[], v: number, len: number) {
  const next = arr.length >= len ? arr.slice(1) : arr.slice();
  next.push(v);
  return next;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// Deterministic 0..1 hash — keeps the page reproducible per tick.
function pseudo(x: number) {
  let n = x | 0;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967296;
}

// =============================================================================
// Insight phrasing
// =============================================================================

function periodicObservation(s: SimState, id: number, at: number): Insight {
  const pool: Array<Omit<Insight, "id" | "at">> = [];

  if (s.regime === "STABLE") {
    pool.push({
      severity: "INFO",
      kind: "bias",
      tag: "CLOCK",
      message: `Clock bias drift remains within nominal threshold (${s.clockBias.toFixed(3)} m).`,
    });
    pool.push({
      severity: "INFO",
      kind: "variance",
      tag: "RESIDUAL",
      message: `${s.satellite} ${s.axis} residual variance stable at σ²=${s.variance.toFixed(
        3,
      )} m².`,
    });
    pool.push({
      severity: "INFO",
      kind: "horizon",
      tag: "HORIZON",
      message: `${formatHorizon(s.horizonMin)} forecast envelope holding <${(s.divergence + 0.05).toFixed(
        2,
      )} m.`,
    });
  }

  if (s.regime === "WATCH") {
    pool.push({
      severity: "WATCH",
      kind: "variance",
      tag: "RESIDUAL",
      message: `Residual variance elevated on ${s.satellite} ${s.axis}; monitoring next 3 min.`,
    });
    pool.push({
      severity: "WATCH",
      kind: "confidence",
      tag: "CONFIDENCE",
      message: `${s.recommendedModel} confidence trending toward ${(s.confidence * 100).toFixed(
        0,
      )}% at current horizon.`,
    });
  }

  if (s.regime === "WARNING") {
    pool.push({
      severity: "WARN",
      kind: "drift",
      tag: "DIVERGENCE",
      message: `Forecast divergence ${s.divergence.toFixed(
        2,
      )} m outside warn band; consider shorter horizon.`,
    });
    pool.push({
      severity: "WARN",
      kind: "variance",
      tag: "RESIDUAL",
      message: `High-variance regime on ${s.satellite} ${s.axis}; GRU preferred for next window.`,
    });
  }

  const pick = pool[Math.floor(pseudo(s.tick * 31) * pool.length)] ?? pool[0];
  return { ...pick, id, at };
}

// =============================================================================
// Panels
// =============================================================================

function AssessmentPanel({
  sim,
  lastAssessed,
  onContextChange,
}: {
  sim: SimState;
  lastAssessed: number | null;
  onContextChange: (patch: Partial<Pick<SimState, "satellite" | "axis" | "horizonMin">>) => void;
}) {
  return (
    <section className="rounded-[var(--radius-xl)] border border-slate-400/12 bg-slate-950/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ThinkingDot />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300/70">
              AI Operational Assessment
            </div>
            <div className="text-sm font-semibold tracking-tight text-slate-50">
              Continuous reasoning over GNSS residual stream
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
          <span className="h-1 w-1 rounded-full bg-cyan-300/80" />
          Last assessed {lastAssessed ? relativeTime(lastAssessed) : "—"}
        </div>
      </header>

      <ContextStrip sim={sim} onChange={onContextChange} />

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AssessmentStat
          label="Risk Level"
          value={sim.regime}
          accent={regimeAccent(sim.regime)}
          hint={regimeHint(sim.regime)}
          sparkline={<RegimeBar regime={sim.regime} />}
        />
        <AssessmentStat
          label="Forecast Confidence"
          value={`${(sim.confidence * 100).toFixed(1)}%`}
          accent={sim.confidence >= 0.88 ? "stable" : sim.confidence >= 0.78 ? "watch" : "warn"}
          hint={`${formatHorizon(sim.horizonMin)} horizon · ${sim.recommendedModel}`}
          sparkline={<ConfidenceMeter value={sim.confidence} />}
        />
        <AssessmentStat
          label="Recommended Model"
          value={sim.recommendedModel}
          accent="neutral"
          hint={
            sim.recommendedModel === "GRU"
              ? "Short-window temporal dynamics"
              : "Long-horizon drift stability"
          }
          sparkline={<ModelSwatch model={sim.recommendedModel} />}
        />
        <AssessmentStat
          label="Anomaly Status"
          value={sim.anomalyActive ? "ACTIVE" : sim.anomalyAgeSec < 30 ? "RECENT" : "CLEAR"}
          accent={sim.anomalyActive ? "warn" : sim.anomalyAgeSec < 30 ? "watch" : "stable"}
          hint={`${sim.anomalyCount} logged · last ${formatAge(sim.anomalyAgeSec)}`}
          sparkline={<AnomalyPulse active={sim.anomalyActive} />}
        />
      </div>
    </section>
  );
}

function AssessmentStat({
  label,
  value,
  accent,
  hint,
  sparkline,
}: {
  label: string;
  value: string;
  accent: "stable" | "watch" | "warn" | "neutral";
  hint: string;
  sparkline?: React.ReactNode;
}) {
  const accentText = {
    stable: "text-emerald-300",
    watch: "text-amber-300",
    warn: "text-rose-300",
    neutral: "text-cyan-200",
  }[accent];
  const accentBorder = {
    stable: "border-emerald-400/20",
    watch: "border-amber-400/20",
    warn: "border-rose-400/25",
    neutral: "border-cyan-300/15",
  }[accent];

  return (
    <div
      className={cn(
        "rounded-lg border bg-slate-950/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
        accentBorder,
      )}
    >
      <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400/80">
        <span>{label}</span>
        {sparkline}
      </div>
      <div className={cn("mt-2 font-mono text-xl font-semibold tabular-nums", accentText)}>
        {value}
      </div>
      <div className="mt-1 text-[11px] text-slate-400/80">{hint}</div>
    </div>
  );
}

function InsightsFeed({ items }: { items: Insight[] }) {
  return (
    <section className="flex h-full min-h-[360px] flex-col rounded-[var(--radius-xl)] border border-slate-400/12 bg-slate-950/60">
      <header className="flex items-center justify-between border-b border-slate-400/10 px-4 py-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300/70">
            Live Insights Feed
          </div>
          <div className="text-sm font-semibold text-slate-50">Operational observations</div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400/80">
          <ThinkingDot size={6} />
          streaming
        </div>
      </header>

      <ul className="relative divide-y divide-slate-400/8 overflow-hidden">
        {items.map((ins, index) => (
          <FeedRow key={ins.id} insight={ins} index={index} />
        ))}
      </ul>
    </section>
  );
}

function FeedRow({ insight, index }: { insight: Insight; index: number }) {
  const opacity = Math.max(0.45, 1 - index * 0.07);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <li
      className={cn(
        "grid grid-cols-[84px_78px_1fr] items-start gap-3 px-4 py-2.5 transition-[opacity,transform] duration-300",
        entered ? "translate-y-0" : "-translate-y-1",
      )}
      style={{ opacity: entered ? opacity : 0 }}
    >
      <span className="font-mono text-[11px] tabular-nums text-slate-400/85">
        {formatTimeIst(insight.at)}
      </span>
      <span
        className={cn(
          "inline-flex justify-center self-start rounded-sm border px-1.5 py-[2px] font-mono text-[9px] font-semibold uppercase tracking-[0.16em]",
          severityClasses(insight.severity),
        )}
      >
        {insight.severity}
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-400/70">
            {insight.tag}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-slate-200/90">{insight.message}</p>
      </div>
    </li>
  );
}

function ForecastAnalysis({ sim }: { sim: SimState }) {
  return (
    <section className="rounded-[var(--radius-xl)] border border-slate-400/12 bg-slate-950/60 p-4">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300/70">
            Forecast Analysis
          </div>
          <div className="text-sm font-semibold text-slate-50">Drift, divergence & residual shape</div>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400/80">
          1 Hz
        </div>
      </header>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <MiniPanel
          title="Drift Trend"
          value={`${(sim.driftRate * 60).toFixed(3)} m/min`}
          hint={sim.driftRate > 0 ? "positive slope" : "negative slope"}
        >
          <Sparkline values={sim.driftSeries} color="rgba(34,211,238,0.9)" centerZero />
        </MiniPanel>
        <MiniPanel
          title="Forecast Divergence"
          value={`${sim.divergence.toFixed(2)} m`}
          hint={divergenceLabel(sim.divergence)}
          accent={sim.divergence > 0.75 ? "warn" : sim.divergence > 0.42 ? "watch" : "stable"}
        >
          <Sparkline values={sim.divergenceSeries} color="rgba(251,191,36,0.9)" fill />
        </MiniPanel>
        <MiniPanel
          title="Residual Distribution"
          value={`σ²=${sim.variance.toFixed(3)}`}
          hint={sim.anomalyActive ? "tail mass rising" : "near-Gaussian"}
        >
          <Histogram values={sim.histogram} highlightTail={sim.anomalyActive} />
        </MiniPanel>
      </div>
    </section>
  );
}

function MiniPanel({
  title,
  value,
  hint,
  accent = "neutral",
  children,
}: {
  title: string;
  value: string;
  hint: string;
  accent?: "neutral" | "stable" | "watch" | "warn";
  children: React.ReactNode;
}) {
  const color = {
    neutral: "text-cyan-200",
    stable: "text-emerald-300",
    watch: "text-amber-300",
    warn: "text-rose-300",
  }[accent];
  return (
    <div className="rounded-lg border border-slate-400/12 bg-slate-950/55 p-3">
      <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400/80">
        <span>{title}</span>
        <span className="text-slate-500/70">{hint}</span>
      </div>
      <div className={cn("mt-1 font-mono text-base font-semibold tabular-nums", color)}>
        {value}
      </div>
      <div className="mt-2 h-[58px]">{children}</div>
    </div>
  );
}

function ModelReasoning({ sim }: { sim: SimState }) {
  const reasons =
    sim.recommendedModel === "GRU"
      ? [
          ["Dynamics", `σ²=${sim.variance.toFixed(3)} favors short-window learner`],
          ["Horizon", `${formatHorizon(sim.horizonMin)} within GRU stability band`],
          ["Anomaly", sim.anomalyActive ? "active — GRU absorbs short spikes" : "clear — no impact"],
        ]
      : [
          ["Dynamics", `drift-dominant (${(sim.driftRate * 60).toFixed(3)} m/min)`],
          ["Horizon", `${formatHorizon(sim.horizonMin)} → Ridge variance bound tighter`],
          ["Anomaly", sim.anomalyActive ? "Ridge less reactive to transients" : "stable channel"],
        ];

  return (
    <section className="rounded-[var(--radius-xl)] border border-slate-400/12 bg-slate-950/60 p-4">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300/70">
          Model Reasoning
        </div>
        <div className="text-sm font-semibold text-slate-50">
          Why{" "}
          <span className="font-mono text-cyan-200">{sim.recommendedModel}</span> for this regime
        </div>
      </header>

      <ul className="mt-3 divide-y divide-slate-400/8 rounded-md border border-slate-400/10 bg-slate-950/40">
        {reasons.map(([k, v]) => (
          <li key={k} className="grid grid-cols-[96px_1fr] gap-3 px-3 py-2 text-[13px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400/75">
              {k}
            </span>
            <span className="text-slate-200/90">{v}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AlertPanel({ sim }: { sim: SimState }) {
  const alerts = deriveAlerts(sim);
  return (
    <section className="rounded-[var(--radius-xl)] border border-slate-400/12 bg-slate-950/60 p-4">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300/70">
            Operational Alerts
          </div>
          <div className="text-sm font-semibold text-slate-50">
            {sim.regime === "STABLE"
              ? "All channels within nominal band"
              : sim.regime === "WATCH"
              ? "Monitoring degraded channel"
              : "Action recommended"}
          </div>
        </div>
        <RegimeBadge regime={sim.regime} />
      </header>

      <ul className="mt-3 grid gap-2">
        {alerts.map((a) => (
          <li
            key={a.id}
            className={cn(
              "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
              severityBorder(a.severity),
              "bg-slate-950/45",
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "inline-flex rounded-sm border px-1.5 py-[2px] font-mono text-[9px] font-semibold uppercase tracking-[0.18em]",
                  severityClasses(a.severity),
                )}
              >
                {a.severity}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400/80">
                {a.tag}
              </span>
              <span className="truncate text-[13px] text-slate-200/90">{a.message}</span>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-slate-400/80">
              {a.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// =============================================================================
// Small visuals
// =============================================================================

function Sparkline({
  values,
  color,
  fill,
  centerZero,
}: {
  values: number[];
  color: string;
  fill?: boolean;
  centerZero?: boolean;
}) {
  const w = 220;
  const h = 58;
  const pad = 3;
  if (values.length === 0) return <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" />;

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (centerZero) {
    const a = Math.max(Math.abs(min), Math.abs(max), 0.0005);
    min = -a;
    max = a;
  }
  if (max - min < 1e-9) {
    min -= 0.001;
    max += 0.001;
  }

  const x = (i: number) => pad + (i / (values.length - 1 || 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (h - pad * 2);

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
  const area =
    fill && values.length > 1
      ? `${line} L ${x(values.length - 1).toFixed(2)} ${h - pad} L ${x(0).toFixed(2)} ${h - pad} Z`
      : "";

  const zeroY = centerZero ? y(0) : null;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={pad}
          x2={w - pad}
          y1={pad + f * (h - pad * 2)}
          y2={pad + f * (h - pad * 2)}
          stroke="rgba(148,163,184,0.08)"
          strokeDasharray="1 3"
        />
      ))}
      {zeroY !== null ? (
        <line
          x1={pad}
          x2={w - pad}
          y1={zeroY}
          y2={zeroY}
          stroke="rgba(148,163,184,0.28)"
          strokeDasharray="2 3"
        />
      ) : null}
      {area ? <path d={area} fill={color.replace(/0?\.\d+\)/, "0.12)")} /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Histogram({ values, highlightTail }: { values: number[]; highlightTail?: boolean }) {
  const w = 220;
  const h = 58;
  const pad = 3;
  const max = Math.max(...values, 1e-6);
  const bw = (w - pad * 2) / values.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
      {[0.5].map((f) => (
        <line
          key={f}
          x1={pad}
          x2={w - pad}
          y1={pad + f * (h - pad * 2)}
          y2={pad + f * (h - pad * 2)}
          stroke="rgba(148,163,184,0.08)"
          strokeDasharray="1 3"
        />
      ))}
      {values.map((v, i) => {
        const height = (v / max) * (h - pad * 2);
        const x = pad + i * bw;
        const y = h - pad - height;
        const isTail = i >= values.length - 2;
        const color = highlightTail && isTail ? "rgba(248,113,113,0.78)" : "rgba(34,211,238,0.68)";
        return (
          <rect
            key={i}
            x={x + 0.8}
            y={y}
            width={bw - 1.6}
            height={height}
            fill={color}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  return (
    <span className="flex h-[4px] w-[60px] overflow-hidden rounded-full bg-slate-800/80">
      <span
        className={cn(
          "h-full rounded-full",
          value >= 0.88 ? "bg-emerald-400/85" : value >= 0.78 ? "bg-amber-400/85" : "bg-rose-400/85",
        )}
        style={{ width: `${value * 100}%` }}
      />
    </span>
  );
}

function RegimeBar({ regime }: { regime: Regime }) {
  const slots: Array<"off" | "on" | "emph"> =
    regime === "STABLE"
      ? ["on", "off", "off"]
      : regime === "WATCH"
      ? ["on", "on", "off"]
      : ["on", "on", "emph"];
  return (
    <span className="flex gap-[3px]">
      {slots.map((s, i) => (
        <span
          key={i}
          className={cn(
            "h-[5px] w-[6px] rounded-[1px]",
            s === "off" && "bg-slate-700/70",
            s === "on" && "bg-slate-300/60",
            s === "emph" && "bg-rose-400/90",
          )}
        />
      ))}
    </span>
  );
}

function ModelSwatch({ model }: { model: ModelId }) {
  return (
    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-300/70">
      {model === "GRU" ? "seq" : "lin"}
    </span>
  );
}

function AnomalyPulse({ active }: { active: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {active ? (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400/70" />
      ) : null}
      <span
        className={cn(
          "relative inline-flex h-2 w-2 rounded-full",
          active ? "bg-rose-400" : "bg-emerald-400/80",
        )}
      />
    </span>
  );
}

function ContextStrip({
  sim,
  onChange,
}: {
  sim: SimState;
  onChange: (patch: Partial<Pick<SimState, "satellite" | "axis" | "horizonMin">>) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-slate-400/10 bg-slate-950/40 px-3 py-2">
      <div className="flex-1 shrink-0 basis-[140px]">
        <Label>Satellite</Label>
        <Select<SatClass>
          value={sim.satellite}
          onChange={(v) => onChange({ satellite: v })}
          options={[
            { value: "GEO", label: "GEO" },
            { value: "MEO", label: "MEO" },
          ]}
          className="mt-1"
        />
      </div>
      <div className="flex-1 shrink-0 basis-[140px]">
        <Label>Error Axis</Label>
        <Select<Axis>
          value={sim.axis}
          onChange={(v) => onChange({ axis: v })}
          options={[
            { value: "X", label: "X" },
            { value: "Y", label: "Y" },
            { value: "Z", label: "Z" },
            { value: "Clock", label: "Clock" },
          ]}
          className="mt-1"
        />
      </div>
      <div className="flex-1 shrink-0 basis-[180px]">
        <Label>Horizon</Label>
        <Select<string>
          value={String(sim.horizonMin)}
          onChange={(v) => onChange({ horizonMin: Number(v) })}
          options={[
            { value: "15", label: "15 min" },
            { value: "60", label: "60 min" },
            { value: "120", label: "120 min" },
            { value: "360", label: "6 hr" },
            { value: "1440", label: "24 hr" },
          ]}
          className="mt-1"
        />
      </div>
      <div className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400/70">
        context → sim
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-slate-400/70">
      {children}
    </div>
  );
}

function ThinkingDot({ size = 8 }: { size?: number }) {
  return (
    <span className="relative inline-flex" style={{ height: size, width: size }}>
      <span
        className="absolute inline-flex animate-ping rounded-full bg-cyan-400/55"
        style={{ height: size, width: size }}
      />
      <span
        className="relative inline-flex rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.6)]"
        style={{ height: size, width: size }}
      />
    </span>
  );
}

function RegimeBadge({ regime }: { regime: Regime }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.2em]",
        regime === "STABLE" && "border-emerald-400/25 bg-emerald-500/8 text-emerald-200",
        regime === "WATCH" && "border-amber-400/25 bg-amber-500/8 text-amber-200",
        regime === "WARNING" && "border-rose-400/30 bg-rose-500/10 text-rose-200",
      )}
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          regime === "STABLE" && "bg-emerald-400",
          regime === "WATCH" && "bg-amber-400",
          regime === "WARNING" && "bg-rose-400",
        )}
      />
      {regime}
    </span>
  );
}

// =============================================================================
// Derivations & formatting
// =============================================================================

type Alert = {
  id: string;
  severity: InsightSeverity;
  tag: string;
  message: string;
  value: string;
};

function deriveAlerts(sim: SimState): Alert[] {
  const out: Alert[] = [];

  out.push({
    id: "variance",
    severity: sim.variance > 0.18 ? "WARN" : sim.variance > 0.09 ? "WATCH" : "INFO",
    tag: "VARIANCE",
    message: `${sim.satellite} ${sim.axis} residual variance`,
    value: `σ²=${sim.variance.toFixed(3)} m²`,
  });

  out.push({
    id: "divergence",
    severity: sim.divergence > 0.75 ? "WARN" : sim.divergence > 0.42 ? "WATCH" : "INFO",
    tag: "DIVERGENCE",
    message: `${formatHorizon(sim.horizonMin)} forecast vs measured spread`,
    value: `${sim.divergence.toFixed(2)} m`,
  });

  out.push({
    id: "confidence",
    severity: sim.confidence < 0.78 ? "WARN" : sim.confidence < 0.88 ? "WATCH" : "INFO",
    tag: "CONFIDENCE",
    message: `${sim.recommendedModel} reported confidence`,
    value: `${(sim.confidence * 100).toFixed(1)}%`,
  });

  out.push({
    id: "anomaly",
    severity: sim.anomalyActive ? "WARN" : sim.anomalyAgeSec < 30 ? "WATCH" : "INFO",
    tag: "ANOMALY",
    message: sim.anomalyActive
      ? "Active spike in residual stream"
      : `No active spike (${sim.anomalyCount} total logged)`,
    value: sim.anomalyActive ? `${sim.anomalyAmp.toFixed(2)} m` : formatAge(sim.anomalyAgeSec),
  });

  return out;
}

function regimeAccent(r: Regime): "stable" | "watch" | "warn" {
  return r === "STABLE" ? "stable" : r === "WATCH" ? "watch" : "warn";
}

function regimeHint(r: Regime) {
  return r === "STABLE"
    ? "All channels nominal"
    : r === "WATCH"
    ? "Degradation detected"
    : "Exceeds warn band";
}

function divergenceLabel(d: number) {
  if (d > 0.75) return "exceeds band";
  if (d > 0.42) return "elevated";
  return "within band";
}

function severityClasses(s: InsightSeverity) {
  switch (s) {
    case "WARN":
      return "border-rose-400/30 bg-rose-500/10 text-rose-200";
    case "WATCH":
      return "border-amber-400/25 bg-amber-500/10 text-amber-200";
    case "NOTE":
      return "border-cyan-400/25 bg-cyan-500/8 text-cyan-200";
    case "INFO":
    default:
      return "border-slate-400/18 bg-slate-800/40 text-slate-300";
  }
}

function severityBorder(s: InsightSeverity) {
  switch (s) {
    case "WARN":
      return "border-rose-400/25";
    case "WATCH":
      return "border-amber-400/20";
    case "NOTE":
      return "border-cyan-400/18";
    case "INFO":
    default:
      return "border-slate-400/12";
  }
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

function relativeTime(ms: number) {
  const delta = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (delta < 2) return "just now";
  if (delta < 60) return `${delta}s ago`;
  return `${Math.round(delta / 60)}m ago`;
}

function formatAge(sec: number) {
  if (sec >= 999) return "never";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

function formatHorizon(min: number) {
  if (min >= 1440) return `${Math.round(min / 1440)} day`;
  if (min >= 60) return `${Math.round(min / 60)} hr`;
  return `${min} min`;
}
