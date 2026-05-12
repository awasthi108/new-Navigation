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

type Datum = {
  t: number;
  timeMs: number;
  tsLabel: string;
  actual: number | null;
  predicted: number | null;
  phase: "history" | "future";
};

const HISTORY_POINTS = 120; // 2 minutes at 1 Hz
const FUTURE_POINTS = 90; // predicted extension
const IST_TIME_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export const ErrorChart = memo(function ErrorChart({ controls, runNonce, className }: ErrorChartProps) {
  const seed = useMemo(() => makeSeed(controls, runNonce), [controls, runNonce]);
  const [anchorMs, setAnchorMs] = useState<number | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnchorMs(Date.now()));
    return () => cancelAnimationFrame(frame);
  }, [seed]);

  const base = useMemo(() => {
    if (anchorMs === null) return [];

    return generateSeries({
      seed,
      historyPoints: HISTORY_POINTS,
      futurePoints: FUTURE_POINTS,
      anchorMs,
    });
  }, [anchorMs, seed]);

  const [futureReveal, setFutureReveal] = useState({ runNonce, value: 0 });
  const [isMounted, setIsMounted] = useState(false);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setChartSize((current) => {
        if (current.width === width && current.height === height) return current;
        return { width, height };
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const durationMs = 1100;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic.
      const eased = 1 - Math.pow(1 - t, 3);
      setFutureReveal({ runNonce, value: Math.floor(eased * FUTURE_POINTS) });
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [runNonce]);

  const visibleFuturePoints = futureReveal.runNonce === runNonce ? futureReveal.value : 0;

  const data = useMemo(() => {
    const visibleFutureEnd = HISTORY_POINTS + visibleFuturePoints;
    // Keep array stable length; null out predicted beyond reveal for smooth “extension”.
    return base.map((d, idx) => {
      if (idx > visibleFutureEnd && d.phase === "future") return { ...d, predicted: null };
      return d;
    });
  }, [base, visibleFuturePoints]);

  const domain = useMemo(() => {
    const values: number[] = [];
    for (const d of base) {
      if (typeof d.actual === "number") values.push(d.actual);
      if (typeof d.predicted === "number") values.push(d.predicted);
    }
    if (values.length === 0) return [-1, 1] as const;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(0.02, (max - min) * 0.18);
    return [min - pad, max + pad] as const;
  }, [base]);

  const futureStartLabel = base[HISTORY_POINTS]?.tsLabel;
  const futureEndLabel = base[base.length - 1]?.tsLabel;
  const tickColor = "rgba(226,232,240,0.55)";
  const chartReady = isMounted && chartSize.width > 1 && chartSize.height > 1;

  return (
    <div ref={containerRef} className={cn("relative h-[320px] w-full", className)}>
      <div className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(900px_280px_at_40%_0%,rgba(34,211,238,0.18),transparent_55%)]" />

      {chartReady ? (
        <ResponsiveContainer width={chartSize.width} height={chartSize.height} minWidth={1} minHeight={320}>
          <LineChart
            data={data}
            margin={{ top: 18, right: 14, bottom: 6, left: 8 }}
          >
          <defs>
            <linearGradient id="navaiLineActual" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(34,211,238,0.95)" />
              <stop offset="55%" stopColor="rgba(34,211,238,0.62)" />
              <stop offset="100%" stopColor="rgba(59,130,246,0.60)" />
            </linearGradient>
            <linearGradient id="navaiLinePred" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(59,130,246,0.78)" />
              <stop offset="55%" stopColor="rgba(34,211,238,0.62)" />
              <stop offset="100%" stopColor="rgba(34,211,238,0.92)" />
            </linearGradient>

            <filter id="navaiGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="3.2" floodColor="rgba(34,211,238,0.45)" />
              <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="rgba(59,130,246,0.18)" />
            </filter>
          </defs>

          <CartesianGrid
            stroke="rgba(148,163,184,0.10)"
            strokeDasharray="3 7"
            vertical={false}
          />

          {futureStartLabel && futureEndLabel ? (
            <ReferenceArea
              x1={futureStartLabel}
              x2={futureEndLabel}
              fill="rgba(59,130,246,0.08)"
              strokeOpacity={0}
              ifOverflow="visible"
            />
          ) : null}

          {futureStartLabel ? (
            <ReferenceLine
              x={futureStartLabel}
              stroke="rgba(125,211,252,0.32)"
              strokeDasharray="4 7"
              ifOverflow="visible"
            />
          ) : null}

          <XAxis
            dataKey="tsLabel"
            tick={{ fill: tickColor, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "rgba(148,163,184,0.14)" }}
            minTickGap={22}
          />

          <YAxis
            domain={domain}
            tick={{ fill: tickColor, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "rgba(148,163,184,0.14)" }}
            width={44}
            tickFormatter={(v) => (typeof v === "number" ? v.toFixed(2) : String(v))}
          />

          <Tooltip
            content={<TelemetryTooltip />}
            cursor={<TelemetryCrosshair />}
            isAnimationActive={false}
          />

          <Line
            type="linear"
            dataKey="actual"
            stroke="url(#navaiLineActual)"
            strokeWidth={2.4}
            dot={false}
            isAnimationActive={false}
            filter="url(#navaiGlow)"
            activeDot={<HoverDot tone="actual" />}
            connectNulls
          />

          <Line
            type="linear"
            dataKey="predicted"
            stroke="url(#navaiLinePred)"
            strokeWidth={2.2}
            dot={false}
            isAnimationActive={false}
            strokeDasharray="6 8"
            filter="url(#navaiGlow)"
            activeDot={<HoverDot tone="pred" />}
            connectNulls
          />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-full min-h-[320px]" />
      )}

      <div className="pointer-events-none absolute left-3 top-2 flex items-center gap-2 text-[11px] text-slate-200/70">
        <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.45)]" />
        <span className="font-semibold tracking-[0.16em] uppercase">Actual Error</span>
        <span className="mx-1 text-slate-200/25">|</span>
        <span className="h-2 w-2 rounded-full bg-blue-400/80 shadow-[0_0_16px_rgba(59,130,246,0.35)]" />
        <span className="font-semibold tracking-[0.16em] uppercase">Predicted</span>
      </div>
    </div>
  );
});

function TelemetryTooltip(props: unknown) {
  const { active, payload } = props as TelemetryTooltipLikeProps;
  if (!active || !payload || payload.length === 0) return null;

  const actual = payload.find((p) => p.dataKey === "actual")?.value;
  const predicted = payload.find((p) => p.dataKey === "predicted")?.value;
  const datum = payload.find((p) => p.payload)?.payload;
  const phase = datum?.phase === "future" ? "Forecast" : "Telemetry";
  const timeLabel = typeof datum?.timeMs === "number" ? formatTooltipTime(datum.timeMs) : datum?.tsLabel;
  const primaryValue = typeof actual === "number" ? actual : predicted;
  const valueLabel = typeof primaryValue === "number" ? `${primaryValue.toFixed(3)} m` : "No sample";

  return (
    <div className="rounded-lg border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.82)] px-3 py-2 shadow-[0_0_0_1px_rgba(34,211,238,0.10),0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-5 text-[11px] font-semibold tracking-[0.12em] uppercase text-slate-200/75">
        <span>{phase}</span>
        <span className="tabular-nums text-cyan-100/85">{timeLabel}</span>
      </div>
      <div className="mt-1 text-lg font-semibold leading-none text-slate-50 tabular-nums">
        {valueLabel}
      </div>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-6">
          <span className="text-slate-200/70">Time</span>
          <span className="font-semibold text-slate-50 tabular-nums">{timeLabel ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-slate-200/70">Value</span>
          <span className="font-semibold text-slate-50 tabular-nums">{valueLabel}</span>
        </div>
        <div className="h-px w-full bg-[rgba(148,163,184,0.14)]" />
        <div className="flex items-center justify-between gap-6">
          <span className="text-slate-200/70">Actual</span>
          <span className="font-semibold text-cyan-200/95 tabular-nums">
            {typeof actual === "number" ? actual.toFixed(3) : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-slate-200/70">Predicted</span>
          <span className="font-semibold text-blue-200/95 tabular-nums">
            {typeof predicted === "number" ? predicted.toFixed(3) : "—"}
          </span>
        </div>
        <div className="h-px w-full bg-[rgba(148,163,184,0.14)]" />
        <div className="flex items-center justify-between gap-6">
          <span className="text-slate-200/70">Delta</span>
          <span className="font-semibold text-slate-50 tabular-nums">
            {typeof actual === "number" && typeof predicted === "number"
              ? (predicted - actual).toFixed(3)
              : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

type TelemetryTooltipLikeProps = {
  active?: boolean;
  payload?: Array<{ dataKey?: unknown; value?: unknown; payload?: Partial<Datum> }>;
};

function TelemetryCrosshair(props: unknown) {
  const { coordinate, points, x, y, width, height } = props as TelemetryCrosshairProps;
  const cx = coordinate?.x ?? points?.[0]?.x;
  const cy = coordinate?.y ?? points?.find((point) => typeof point?.y === "number")?.y;
  const chartX = typeof x === "number" ? x : 0;
  const chartY = typeof y === "number" ? y : 0;
  const chartWidth = typeof width === "number" ? width : 0;
  const chartHeight = typeof height === "number" ? height : 0;

  if (typeof cx !== "number") return null;

  return (
    <g className="recharts-tooltip-cursor" pointerEvents="none">
      <rect
        x={cx - 12}
        y={chartY}
        width={24}
        height={chartHeight}
        fill="rgba(59,130,246,0.045)"
      />
      <line
        x1={cx}
        x2={cx}
        y1={chartY}
        y2={chartY + chartHeight}
        stroke="rgba(125,211,252,0.42)"
        strokeWidth={1}
        strokeDasharray="4 5"
      />
      {typeof cy === "number" ? (
        <>
          <line
            x1={chartX}
            x2={chartX + chartWidth}
            y1={cy}
            y2={cy}
            stroke="rgba(148,163,184,0.20)"
            strokeWidth={1}
            strokeDasharray="4 5"
          />
          <circle cx={cx} cy={cy} r={3.5} fill="rgba(2,6,23,0.9)" stroke="rgba(125,211,252,0.78)" />
        </>
      ) : null}
    </g>
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

function HoverDot({ cx, cy, tone }: { cx?: number; cy?: number; tone: "actual" | "pred" }) {
  if (typeof cx !== "number" || typeof cy !== "number") return null;
  const core = tone === "actual" ? "rgba(34,211,238,0.95)" : "rgba(59,130,246,0.9)";
  const halo = tone === "actual" ? "rgba(34,211,238,0.26)" : "rgba(59,130,246,0.20)";

  return (
    <g>
      <circle cx={cx} cy={cy} r={11} fill={halo} />
      <circle cx={cx} cy={cy} r={6} fill="rgba(2,6,23,0.85)" stroke={core} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={2.6} fill={core} />
    </g>
  );
}

function makeSeed(controls: DashboardControls, runNonce: number) {
  const s =
    controls.satellite.charCodeAt(0) * 17 +
    controls.errorType.charCodeAt(0) * 31 +
    controls.model.charCodeAt(0) * 43 +
    controls.horizonMinutes * 7 +
    runNonce * 101;
  return s >>> 0;
}

function generateSeries({
  seed,
  historyPoints,
  futurePoints,
  anchorMs,
}: {
  seed: number;
  historyPoints: number;
  futurePoints: number;
  anchorMs: number;
}): Datum[] {
  const rng = mulberry32(seed);

  const baseAmp = 0.34 + rng() * 0.22;
  const noiseAmp = 0.012 + rng() * 0.018;
  const microNoiseAmp = 0.003 + rng() * 0.005;
  const driftRate = (rng() - 0.5) * 0.0018;
  const driftCurve = (rng() - 0.5) * 0.000018;
  const wanderStrength = 0.00055 + rng() * 0.00045;
  const meanReversion = 0.985 + rng() * 0.01;
  const regimePeriod = 34 + Math.floor(rng() * 30);
  const regimeAmplitude = 0.01 + rng() * 0.01;
  const bias = (rng() - 0.5) * 0.028;
  const phase = rng() * Math.PI * 2;
  const freq = 0.085 + rng() * 0.03;

  const start = anchorMs - historyPoints * 1000;
  const total = historyPoints + futurePoints;

  const series: Datum[] = [];
  let coloredNoise = (rng() - 0.5) * noiseAmp;
  let modelNoise = (rng() - 0.5) * noiseAmp;
  let randomWalk = 0;

  for (let i = 0; i <= total; i++) {
    const t = i;
    const isFuture = i > historyPoints;
    const x = t * freq + phase;
    const regimeIndex = Math.floor(i / regimePeriod);
    const regimeBias = Math.sin(regimeIndex * 0.8 + phase * 0.5) * regimeAmplitude;

    coloredNoise = coloredNoise * 0.72 + (rng() - 0.5) * 2 * noiseAmp;
    modelNoise = modelNoise * 0.84 + (rng() - 0.5) * 2 * (noiseAmp * 0.55);
    randomWalk = randomWalk * meanReversion + (rng() - 0.5) * 2 * wanderStrength;

    const lowFrequency = baseAmp * Math.sin(x);
    const secondary = baseAmp * 0.28 * Math.sin(x * 0.41 + 1.2);
    const ripple = 0.018 * Math.sin(t * 0.64 + phase * 0.5);
    const microNoise = (rng() - 0.5) * 2 * microNoiseAmp;
    const drift = driftRate * t + driftCurve * t * t + randomWalk + regimeBias;
    const driftKick = i > 0 && i % 43 === 0 ? (rng() - 0.5) * 0.01 : 0;
    const spike = rng() > 0.972 ? (rng() - 0.5) * 0.055 : 0;

    const actual = quantize(
      lowFrequency + secondary + ripple + drift + coloredNoise + microNoise + driftKick + spike,
      0.001,
    );

    const aheadT = t + (isFuture ? 2.4 : 1.25);
    const aheadX = aheadT * freq + phase;
    const modelBase =
      baseAmp * Math.sin(aheadX) +
      baseAmp * 0.28 * Math.sin(aheadX * 0.41 + 1.2) +
      0.014 * Math.sin(aheadT * 0.64 + phase * 0.5);
    const predictionDrift =
      driftRate * aheadT + driftCurve * aheadT * aheadT + randomWalk * 0.8 + regimeBias * 0.72;
    const horizonBlend = isFuture ? Math.min(1, (i - historyPoints) / Math.max(futurePoints, 1)) : 0;
    const horizonUncertainty =
      (rng() - 0.5) * 2 * horizonBlend * horizonBlend * (0.018 + rng() * 0.012);
    const predicted = quantize(
      modelBase + predictionDrift + bias + modelNoise + horizonUncertainty,
      0.001,
    );
    const predictedVisible = i < historyPoints - 16 ? null : predicted;

    const timeMs = start + i * 1000;
    const tsLabel = formatIstTime(timeMs);

    series.push({
      t,
      timeMs,
      tsLabel,
      actual: isFuture ? null : actual,
      predicted: predictedVisible,
      phase: isFuture ? "future" : "history",
    });
  }

  return series;
}

function formatTooltipTime(timeMs: number) {
  return `${formatIstTime(timeMs)} IST`;
}

function formatIstTime(timeMs: number) {
  return IST_TIME_FORMATTER.format(new Date(timeMs));
}

function quantize(value: number, step: number) {
  return Math.round(value / step) * step;
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
