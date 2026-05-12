"use client";

import { cn } from "@/lib/cn";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardControls } from "@/features/dashboard/types";

type ErrorChartProps = {
  controls: DashboardControls;
  runNonce: number;
  className?: string;
};

type Phase = "history" | "forecast";

type Datum = {
  idx: number;
  timeMs: number;
  tsLabel: string;
  measured: number | null;
  forecast: number | null;
  ciHi: number | null;
  ciLo: number | null;
  confidence: number;
  anomaly: boolean;
  phase: Phase;
};

// Sliding-window telemetry: fresh sample every second, constant shape.
const HISTORY_POINTS = 180; // 3 minutes
const FORECAST_POINTS = 90; // 1.5 minutes
const TOTAL_POINTS = HISTORY_POINTS + FORECAST_POINTS;
const TICK_MS = 1000;
const ANOMALY_WINDOW = 30;

const IST_TIME_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// --- Chart component --------------------------------------------------------

export const ErrorChart = memo(function ErrorChart({ controls, runNonce, className }: ErrorChartProps) {
  const seed = useMemo(() => makeSeed(controls, runNonce), [controls, runNonce]);
  const cfg = useMemo(() => buildCfg(seed), [seed]);

  const [anchorMs, setAnchorMs] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // One-shot anchor + mount flag.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setAnchorMs(Date.now());
      setIsMounted(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // 1 Hz live updates — subtle sliding window, no large jumps.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Resize observer for ResponsiveContainer sizing.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setChartSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Forecast reveal animation — runs on each completed prediction.
  const [reveal, setReveal] = useState({ runNonce, count: 0 });
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const durationMs = 1100;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setReveal({ runNonce, count: Math.floor(eased * FORECAST_POINTS) });
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [runNonce]);

  const visibleForecast = reveal.runNonce === runNonce ? reveal.count : 0;

  const base = useMemo<Datum[]>(() => {
    if (anchorMs === null) return [];
    return buildSeries(cfg, tick, anchorMs);
  }, [cfg, tick, anchorMs]);

  const data = useMemo<Datum[]>(() => {
    const forecastCutoff = HISTORY_POINTS + visibleForecast;
    return base.map((d, i) => {
      if (d.phase === "forecast" && i > forecastCutoff) {
        return { ...d, forecast: null, ciHi: null, ciLo: null };
      }
      return d;
    });
  }, [base, visibleForecast]);

  const domain = useMemo(() => {
    const values: number[] = [];
    for (const d of base) {
      if (typeof d.measured === "number") values.push(d.measured);
      if (typeof d.forecast === "number") values.push(d.forecast);
      if (typeof d.ciHi === "number") values.push(d.ciHi);
      if (typeof d.ciLo === "number") values.push(d.ciLo);
    }
    if (values.length === 0) return [-1, 1] as const;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(0.04, (max - min) * 0.18);
    return [min - pad, max + pad] as const;
  }, [base]);

  // Anomaly detection within the last N live samples.
  const { anomalyActive, anomalyX1, anomalyX2 } = useMemo(() => {
    const start = Math.max(0, HISTORY_POINTS - ANOMALY_WINDOW);
    let hit = -1;
    for (let i = HISTORY_POINTS - 1; i >= start; i--) {
      if (base[i]?.anomaly) {
        hit = i;
        break;
      }
    }
    if (hit < 0) {
      return { anomalyActive: false, anomalyX1: undefined, anomalyX2: undefined };
    }
    const x1Index = Math.max(0, hit - 3);
    const x2Index = Math.min(HISTORY_POINTS - 1, hit + 3);
    return {
      anomalyActive: true,
      anomalyX1: base[x1Index]?.tsLabel,
      anomalyX2: base[x2Index]?.tsLabel,
    };
  }, [base]);

  const forecastStartLabel = base[HISTORY_POINTS]?.tsLabel;
  const tickColor = "rgba(203,213,225,0.55)";
  const chartReady = isMounted && chartSize.width > 1 && chartSize.height > 1;

  // Overlay coords for LIVE / FORECAST badges (plot area geometry).
  const axisLeft = 8 + 48; // margin.left + YAxis.width
  const axisRight = 14;
  const plotWidth = Math.max(1, chartSize.width - axisLeft - axisRight);
  const nowPx = axisLeft + plotWidth * (HISTORY_POINTS / TOTAL_POINTS);

  return (
    <div ref={containerRef} className={cn("relative h-[320px] w-full", className)}>
      {/* Soft ambient glow — muted, engineering-feel */}
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(700px_220px_at_35%_0%,rgba(34,211,238,0.08),transparent_60%)]" />

      {chartReady ? (
        <ResponsiveContainer width={chartSize.width} height={chartSize.height} minWidth={1} minHeight={320}>
          <LineChart data={data} margin={{ top: 22, right: axisRight, bottom: 6, left: 8 }}>
            <defs>
              <linearGradient id="navaiCiBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(59,130,246,0.28)" />
                <stop offset="100%" stopColor="rgba(59,130,246,0.02)" />
              </linearGradient>
              <filter id="navaiSoftGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="rgba(34,211,238,0.35)" />
              </filter>
            </defs>

            {/* Engineering grid: both axes, hairline dashed */}
            <CartesianGrid
              stroke="rgba(148,163,184,0.12)"
              strokeDasharray="1 4"
              vertical
              horizontal
            />

            {/* Forecast zone tint */}
            {forecastStartLabel && base[base.length - 1] ? (
              <ReferenceArea
                x1={forecastStartLabel}
                x2={base[base.length - 1].tsLabel}
                fill="rgba(59,130,246,0.05)"
                strokeOpacity={0}
                ifOverflow="visible"
              />
            ) : null}

            {/* Historical anomaly highlight */}
            {anomalyActive && anomalyX1 && anomalyX2 ? (
              <ReferenceArea
                x1={anomalyX1}
                x2={anomalyX2}
                fill="rgba(248,113,113,0.10)"
                stroke="rgba(248,113,113,0.40)"
                strokeDasharray="2 3"
                strokeWidth={1}
                ifOverflow="visible"
              />
            ) : null}

            {/* Zero reference line — standard in residual plots */}
            <ReferenceLine
              y={0}
              stroke="rgba(148,163,184,0.22)"
              strokeDasharray="2 4"
              ifOverflow="visible"
            />

            {/* Live / Forecast divider */}
            {forecastStartLabel ? (
              <ReferenceLine
                x={forecastStartLabel}
                stroke="rgba(125,211,252,0.55)"
                strokeDasharray="3 4"
                strokeWidth={1}
                ifOverflow="visible"
              />
            ) : null}

            <XAxis
              dataKey="tsLabel"
              tick={{ fill: tickColor, fontSize: 10, fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
              tickLine={false}
              axisLine={{ stroke: "rgba(148,163,184,0.16)" }}
              minTickGap={44}
              interval="preserveStartEnd"
            />

            <YAxis
              domain={domain}
              tick={{ fill: tickColor, fontSize: 10, fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
              tickLine={false}
              axisLine={{ stroke: "rgba(148,163,184,0.16)" }}
              width={48}
              tickFormatter={(v) => (typeof v === "number" ? `${v >= 0 ? " " : ""}${v.toFixed(2)}` : String(v))}
              label={{
                value: "Residual (m)",
                angle: -90,
                position: "insideLeft",
                offset: 16,
                style: {
                  fill: "rgba(203,213,225,0.55)",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                },
              }}
            />

            <Tooltip
              content={<TelemetryTooltip />}
              cursor={<TelemetryCrosshair />}
              isAnimationActive={false}
            />

            {/* Forecast confidence band (upper) */}
            <Line
              type="monotone"
              dataKey="ciHi"
              stroke="rgba(59,130,246,0.28)"
              strokeWidth={1}
              strokeDasharray="1 3"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
              activeDot={false}
            />

            {/* Forecast confidence band (lower) */}
            <Line
              type="monotone"
              dataKey="ciLo"
              stroke="rgba(59,130,246,0.28)"
              strokeWidth={1}
              strokeDasharray="1 3"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
              activeDot={false}
            />

            {/* Measured residual — thin, soft glow */}
            <Line
              type="monotone"
              dataKey="measured"
              stroke="rgba(34,211,238,0.95)"
              strokeWidth={1.6}
              dot={false}
              isAnimationActive={false}
              filter="url(#navaiSoftGlow)"
              connectNulls={false}
              activeDot={<HoverDot tone="measured" />}
            />

            {/* Forecast residual — dashed */}
            <Line
              type="monotone"
              dataKey="forecast"
              stroke="rgba(96,165,250,0.85)"
              strokeWidth={1.4}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
              activeDot={<HoverDot tone="forecast" />}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-full min-h-[320px]" />
      )}

      {/* LIVE / FORECAST zone badges */}
      {chartReady ? (
        <>
          <div
            className="pointer-events-none absolute flex items-center gap-1.5 rounded-sm border border-cyan-300/25 bg-slate-950/65 px-1.5 py-[3px] text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-100/90 shadow-[0_0_10px_rgba(34,211,238,0.12)]"
            style={{ left: axisLeft + 6, top: 8 }}
          >
            <LivePulse />
            Live
          </div>
          <div
            className="pointer-events-none absolute rounded-sm border border-blue-400/25 bg-slate-950/65 px-1.5 py-[3px] text-[9px] font-semibold uppercase tracking-[0.2em] text-blue-100/90 shadow-[0_0_10px_rgba(59,130,246,0.12)]"
            style={{ left: nowPx + 6, top: 8 }}
          >
            Forecast
          </div>
          <AnomalyBanner active={anomalyActive} />
        </>
      ) : null}

      {/* Legend — bottom, aerospace-style */}
      <div className="pointer-events-none absolute bottom-1 left-0 right-0 flex items-center justify-center gap-3 text-[9px] font-semibold tracking-[0.16em] uppercase text-slate-300/60">
        <LegendSwatch color="rgba(34,211,238,0.95)" label="Measured Residual" />
        <span className="text-slate-500/50">·</span>
        <LegendSwatch color="rgba(96,165,250,0.85)" label="Forecast Residual" dashed />
        <span className="text-slate-500/50">·</span>
        <LegendSwatch color="rgba(59,130,246,0.45)" label="95% CI" dashed />
      </div>
    </div>
  );
});

// --- Overlays ---------------------------------------------------------------

function LivePulse() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400/70" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.75)]" />
    </span>
  );
}

function LegendSwatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-[2px] w-5"
        style={{
          background: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 8px)`
            : color,
        }}
      />
      <span>{label}</span>
    </span>
  );
}

function AnomalyBanner({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute right-3 top-8 flex items-center gap-1.5 rounded-sm border border-red-400/35 bg-red-950/35 px-2 py-[3px] text-[9px] font-semibold uppercase tracking-[0.22em] text-red-200 shadow-[0_0_14px_rgba(248,113,113,0.18)] animate-pulse">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]" />
      Telemetry Alert
    </div>
  );
}

// --- Tooltip + crosshair ----------------------------------------------------

type TelemetryTooltipLikeProps = {
  active?: boolean;
  payload?: Array<{ dataKey?: unknown; value?: unknown; payload?: Partial<Datum> }>;
};

function TelemetryTooltip(props: unknown) {
  const { active, payload } = props as TelemetryTooltipLikeProps;
  if (!active || !payload || payload.length === 0) return null;

  const datum = payload.find((p) => p.payload)?.payload;
  if (!datum) return null;

  const isForecast = datum.phase === "forecast";
  const primary = isForecast ? datum.forecast : datum.measured;
  const timeLabel = typeof datum.timeMs === "number" ? formatIstTime(datum.timeMs) : datum.tsLabel ?? "—";
  const confidencePct = typeof datum.confidence === "number" ? (datum.confidence * 100).toFixed(1) : null;
  const residualLabel = typeof primary === "number" ? `${primary >= 0 ? "+" : ""}${primary.toFixed(3)} m` : "— m";

  return (
    <div className="min-w-[188px] rounded-sm border border-[rgba(148,163,184,0.22)] bg-[rgba(2,6,23,0.92)] px-2.5 py-2 font-mono text-[11px] text-slate-200 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_14px_40px_rgba(0,0,0,0.55)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 text-[9px] font-semibold uppercase tracking-[0.2em]">
        <span className={isForecast ? "text-blue-300/85" : "text-cyan-300/90"}>
          {isForecast ? "Forecast" : "Live"}
        </span>
        {datum.anomaly ? <span className="text-red-300/90">Spike</span> : null}
      </div>

      <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums">
        <span className="text-slate-400/80">Time</span>
        <span className="text-right text-slate-50">{timeLabel} IST</span>

        <span className="text-slate-400/80">Residual</span>
        <span className={cn("text-right font-semibold", isForecast ? "text-blue-200" : "text-cyan-200")}>
          {residualLabel}
        </span>

        <span className="text-slate-400/80">Confidence</span>
        <span className="text-right text-slate-50">
          {confidencePct !== null ? `${confidencePct}%` : "—"}
        </span>
      </div>

      {confidencePct !== null ? (
        <div className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-slate-800/80">
          <div
            className={cn("h-full", isForecast ? "bg-blue-400/80" : "bg-cyan-400/90")}
            style={{ width: `${confidencePct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

type TelemetryCrosshairProps = {
  coordinate?: { x?: number; y?: number };
  points?: Array<{ x?: number; y?: number }>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

function TelemetryCrosshair(props: unknown) {
  const { coordinate, points, x, y, width, height } = props as TelemetryCrosshairProps;
  const cx = coordinate?.x ?? points?.[0]?.x;
  const cy = coordinate?.y ?? points?.find((p) => typeof p?.y === "number")?.y;
  const chartX = typeof x === "number" ? x : 0;
  const chartY = typeof y === "number" ? y : 0;
  const chartWidth = typeof width === "number" ? width : 0;
  const chartHeight = typeof height === "number" ? height : 0;

  if (typeof cx !== "number") return null;

  return (
    <g className="recharts-tooltip-cursor" pointerEvents="none">
      <line
        x1={cx}
        x2={cx}
        y1={chartY}
        y2={chartY + chartHeight}
        stroke="rgba(125,211,252,0.55)"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      {typeof cy === "number" ? (
        <>
          <line
            x1={chartX}
            x2={chartX + chartWidth}
            y1={cy}
            y2={cy}
            stroke="rgba(148,163,184,0.28)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          <circle cx={cx} cy={cy} r={3} fill="rgba(2,6,23,0.9)" stroke="rgba(125,211,252,0.85)" />
        </>
      ) : null}
    </g>
  );
}

function HoverDot({ cx, cy, tone }: { cx?: number; cy?: number; tone: "measured" | "forecast" }) {
  if (typeof cx !== "number" || typeof cy !== "number") return null;
  const core = tone === "measured" ? "rgba(34,211,238,0.95)" : "rgba(96,165,250,0.9)";
  const halo = tone === "measured" ? "rgba(34,211,238,0.22)" : "rgba(59,130,246,0.18)";
  return (
    <g>
      <circle cx={cx} cy={cy} r={8} fill={halo} />
      <circle cx={cx} cy={cy} r={4} fill="rgba(2,6,23,0.9)" stroke={core} strokeWidth={1.4} />
      <circle cx={cx} cy={cy} r={1.6} fill={core} />
    </g>
  );
}

// --- Data model -------------------------------------------------------------

type SeriesCfg = {
  seed: number;
  ampLF: number; wLF: number; phLF: number;
  ampMF: number; wMF: number; phMF: number;
  ampW: number; wW1: number; phW1: number; wW2: number; phW2: number;
  ampN: number;
  bias: number;
  spikeThreshold: number;
  spikeAmp: number;
  anomalyThreshold: number;
  anomalyAmp: number;
};

function makeSeed(controls: DashboardControls, runNonce: number) {
  const s =
    controls.satellite.charCodeAt(0) * 17 +
    controls.errorType.charCodeAt(0) * 31 +
    controls.model.charCodeAt(0) * 43 +
    controls.horizonMinutes * 7 +
    runNonce * 101;
  return s >>> 0;
}

function buildCfg(seed: number): SeriesCfg {
  const r = mulberry32(seed);
  return {
    seed,
    ampLF: 0.28 + r() * 0.16,
    wLF: 0.018 + r() * 0.012,
    phLF: r() * Math.PI * 2,
    ampMF: 0.065 + r() * 0.04,
    wMF: 0.062 + r() * 0.03,
    phMF: r() * Math.PI * 2,
    ampW: 0.032 + r() * 0.022,
    wW1: 0.0034 + r() * 0.0018,
    phW1: r() * Math.PI * 2,
    wW2: 0.0018 + r() * 0.0012,
    phW2: r() * Math.PI * 2,
    ampN: 0.014 + r() * 0.008,
    bias: (r() - 0.5) * 0.02,
    spikeThreshold: 0.982,
    spikeAmp: 0.045 + r() * 0.025,
    anomalyThreshold: 0.9975,
    anomalyAmp: 0.16 + r() * 0.08,
  };
}

function buildSeries(cfg: SeriesCfg, tick: number, anchorMs: number): Datum[] {
  const series: Datum[] = [];
  const nowIdx = tick + HISTORY_POINTS - 1;

  for (let i = 0; i < TOTAL_POINTS; i++) {
    const abs = tick + i;
    const isHistory = i < HISTORY_POINTS;
    const phase: Phase = isHistory ? "history" : "forecast";
    const lead = isHistory ? 0 : i - HISTORY_POINTS + 1;
    const timeMs = anchorMs + (abs - nowIdx) * TICK_MS;

    const residual = residualAt(abs, cfg);
    const recent = hasAnomalyNear(abs, cfg);
    const confidence = confidenceFor(phase, lead, recent);

    let measured: number | null = null;
    let forecast: number | null = null;
    let ciHi: number | null = null;
    let ciLo: number | null = null;

    if (isHistory) {
      measured = quantize(residual.value, 0.001);
    } else {
      const forecastVal = forecastAt(abs, cfg, lead);
      forecast = quantize(forecastVal, 0.001);
      // 95% CI widens with lead time (roughly 1.96 · sigma(lead))
      const sigma = 0.012 + 0.035 * (1 - Math.exp(-lead / 28));
      const band = 1.96 * sigma;
      ciHi = quantize(forecastVal + band, 0.001);
      ciLo = quantize(forecastVal - band, 0.001);
    }

    series.push({
      idx: abs,
      timeMs,
      tsLabel: formatIstTime(timeMs),
      measured,
      forecast,
      ciHi,
      ciLo,
      confidence,
      anomaly: isHistory && residual.anomaly,
      phase,
    });
  }

  // Pin the last history sample so the forecast line visually continues
  // from the measured curve without a seam.
  const lastHist = series[HISTORY_POINTS - 1];
  if (lastHist && typeof lastHist.measured === "number") {
    series[HISTORY_POINTS - 1] = {
      ...lastHist,
      forecast: lastHist.measured,
      ciHi: lastHist.measured,
      ciLo: lastHist.measured,
    };
  }

  return series;
}

function residualAt(idx: number, cfg: SeriesCfg) {
  const lf = cfg.ampLF * Math.sin(idx * cfg.wLF + cfg.phLF);
  const mf = cfg.ampMF * Math.sin(idx * cfg.wMF + cfg.phMF);
  const wander =
    cfg.ampW *
    (Math.sin(idx * cfg.wW1 + cfg.phW1) + 0.55 * Math.sin(idx * cfg.wW2 + cfg.phW2));
  const n = cfg.ampN * smoothNoise(idx, cfg.seed);
  const sp = spikeAt(idx, cfg);
  const an = anomalyAt(idx, cfg);
  return {
    value: cfg.bias + lf + mf + wander + n + sp + an.amp,
    anomaly: an.active,
  };
}

function forecastAt(idx: number, cfg: SeriesCfg, lead: number) {
  // Forecast uses only smooth underlying components (slow drift + wander)
  // with a tiny lead-dependent uncertainty perturbation.
  const lf = cfg.ampLF * Math.sin(idx * cfg.wLF + cfg.phLF);
  const mf = cfg.ampMF * Math.sin(idx * cfg.wMF + cfg.phMF);
  const wander =
    cfg.ampW *
    (Math.sin(idx * cfg.wW1 + cfg.phW1) + 0.55 * Math.sin(idx * cfg.wW2 + cfg.phW2));
  const uncertainty =
    smoothNoise(idx * 7 + 131, cfg.seed) * cfg.ampN * 0.35 * Math.min(1, lead / 45);
  return cfg.bias + lf + mf + wander + uncertainty;
}

function smoothNoise(idx: number, seed: number) {
  // Triangular smoothing of a deterministic hash → value in roughly [-1, 1].
  const a = hash01(idx + seed) * 2 - 1;
  const b = hash01(idx + 1 + seed) * 2 - 1;
  const c = hash01(idx - 1 + seed) * 2 - 1;
  return (2 * a + b + c) / 4;
}

function spikeAt(idx: number, cfg: SeriesCfg) {
  // Small, rare, short-lived impulses — blurred across 3 samples.
  let total = 0;
  for (let k = 0; k <= 2; k++) {
    const h = hash01((idx - k) ^ Math.imul(cfg.seed, 0x5bd1e995));
    if (h > cfg.spikeThreshold) {
      const dir = hash01((idx - k) ^ Math.imul(cfg.seed, 0x9e3779b1)) - 0.5;
      const weight = k === 0 ? 1 : k === 1 ? 0.5 : 0.22;
      total += dir * 2 * cfg.spikeAmp * weight;
    }
  }
  return total;
}

function anomalyAt(idx: number, cfg: SeriesCfg) {
  const h = hash01(idx ^ Math.imul(cfg.seed, 0x9e3779b9));
  if (h < cfg.anomalyThreshold) return { amp: 0, active: false };
  const dir = hash01(idx ^ Math.imul(cfg.seed, 0xa24baed4)) > 0.5 ? 1 : -1;
  const mag = (h - cfg.anomalyThreshold) / (1 - cfg.anomalyThreshold);
  return { amp: dir * cfg.anomalyAmp * (0.45 + mag * 0.55), active: true };
}

function hasAnomalyNear(idx: number, cfg: SeriesCfg) {
  for (let k = 0; k < 6; k++) {
    if (anomalyAt(idx - k, cfg).active) return true;
  }
  return false;
}

function confidenceFor(phase: Phase, lead: number, recentAnomaly: boolean) {
  if (phase === "history") return recentAnomaly ? 0.902 : 0.992;
  const decay = Math.exp(-lead / 55);
  const base = 0.8 + 0.18 * decay; // ~0.80 → 0.98
  return recentAnomaly ? Math.max(0.7, base - 0.08) : base;
}

// --- Utils ------------------------------------------------------------------

function formatIstTime(timeMs: number) {
  return IST_TIME_FORMATTER.format(new Date(timeMs));
}

function quantize(value: number, step: number) {
  return Math.round(value / step) * step;
}

function hash01(x: number) {
  let n = x | 0;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967296;
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
