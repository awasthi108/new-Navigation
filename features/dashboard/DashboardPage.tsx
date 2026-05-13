"use client";

import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { ControlPanel } from "@/features/dashboard/ControlPanel";
import { DashboardProvider, useDashboard } from "@/features/dashboard/dashboard-context";
import { MetricsRow } from "@/features/dashboard/MetricsRow";
import { VisualizationGrid } from "@/features/dashboard/VisualizationGrid";
import { useMission } from "@/features/mission/mission-context";
import { useTelemetry, type TelemetryStatus } from "@/hooks/useTelemetry";
import { useNow } from "@/hooks/useNow";
import { cn } from "@/lib/cn";
import { useMemo } from "react";

export function DashboardPage() {
  return (
    <DashboardProvider>
      <DashboardPageInner />
    </DashboardProvider>
  );
}

function DashboardPageInner() {
  const { controls, isLoading, isPredicting, runCompletedId } = useDashboard();
  const { formatted } = useNow();
  const mission = useMission();
  const telemetry = useTelemetry();

  // Derive metrics from live telemetry when available, else fall back to
  // the existing local computation.
  const metrics = useMemo(() => {
    if (telemetry.data) {
      const rmse = telemetry.data.rmse.toFixed(3);
      const mae = telemetry.data.mae.toFixed(3);
      const progress = telemetry.data.total_points > 0
        ? Math.round((telemetry.data.current_index / telemetry.data.total_points) * 100)
        : 0;
      const stability = `${Math.max(0, 100 - Math.round(telemetry.data.rmse * 28))}%`;
      return { rmse, mae, stability, progress };
    }

    // Fallback: local computation from controls (original behavior).
    const base = controls.model === "GRU" ? 0.62 : 0.78;
    const sat = controls.satellite === "GEO" ? -0.03 : 0.02;
    const axis = controls.errorType === "Clock" ? 0.08 : controls.errorType === "Z" ? 0.05 : 0.02;
    const horizon = Math.min(0.18, (controls.horizonMinutes / (24 * 60)) * 0.22);
    const rmse = (base + sat + axis + horizon + (runCompletedId % 3) * 0.01).toFixed(3);
    const mae = (base - 0.13 + sat + axis * 0.7 + horizon * 0.6 + (runCompletedId % 2) * 0.008).toFixed(3);
    const stability = `${Math.max(84, 97 - Math.round(horizon * 100) - (controls.model === "GRU" ? 2 : 0))}%`;
    return { rmse, mae, stability, progress: 0 };
  }, [telemetry.data, controls, runCompletedId]);

  const anomalyDetected = useMemo(() => {
    // Live telemetry anomaly takes priority.
    if (telemetry.data?.anomaly) return true;
    if (mission.anomaly) return true;
    if (runCompletedId === 0) return false;
    const rmse = Number(metrics.rmse);
    const stability = Number(metrics.stability.replace("%", ""));
    return rmse >= 0.84 || stability <= 88;
  }, [telemetry.data, mission.anomaly, metrics.rmse, metrics.stability, runCompletedId]);

  return (
    <>
      <LoadingOverlay show={isLoading} />
      <div className="space-y-4">
        <TelemetryStatusStrip
          status={telemetry.status}
          error={telemetry.error}
          retryCount={telemetry.retryCount}
          anomaly={anomalyDetected}
          progress={metrics.progress}
          forecasting={isPredicting || Boolean(telemetry.data?.prediction)}
          cycleCount={telemetry.cycleCount}
        />
        <ControlPanel />
        <VisualizationGrid
          controls={controls}
          runNonce={runCompletedId + (mission.anomaly?.id ?? 0)}
          isRunning={isLoading || isPredicting || mission.active || telemetry.status === "active"}
          anomalyDetected={anomalyDetected}
        />
        <MetricsRow
          rmse={metrics.rmse}
          mae={metrics.mae}
          stability={metrics.stability}
          lastUpdated={formatted}
        />
      </div>
    </>
  );
}

// =============================================================================
// Telemetry status strip — compact, professional
// =============================================================================

function TelemetryStatusStrip({
  status,
  error,
  retryCount,
  anomaly,
  progress,
  forecasting,
  cycleCount,
}: {
  status: TelemetryStatus;
  error: string | null;
  retryCount: number;
  anomaly: boolean;
  progress: number;
  forecasting: boolean;
  cycleCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-400/12 bg-slate-950/55 px-3 py-2">
      <StatusChip
        label={statusLabel(status)}
        accent={statusAccent(status)}
        pulse={status === "active"}
      />

      {forecasting ? (
        <StatusChip label="Forecasting" accent="cyan" pulse />
      ) : null}

      {anomaly ? (
        <StatusChip label="Anomaly Detected" accent="warn" pulse />
      ) : null}

      {progress > 0 ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400/80">
          progress <span className="text-slate-200/90 tabular-nums">{progress}%</span>
        </span>
      ) : null}

      {cycleCount > 0 ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400/80">
          cycle <span className="text-cyan-200/90 tabular-nums">{cycleCount}</span>
        </span>
      ) : null}

      {status === "error" ? (
        <span className="ml-auto font-mono text-[10px] text-rose-300/80">
          {error ?? "connection lost"} · retry {retryCount}
        </span>
      ) : null}

      {status === "connecting" ? (
        <span className="ml-auto font-mono text-[10px] text-amber-300/80">
          connecting to telemetry runtime…
        </span>
      ) : null}

      {status === "cold-start" ? (
        <span className="ml-auto font-mono text-[10px] text-amber-300/80">
          backend cold-starting… please wait ({retryCount})
        </span>
      ) : null}
    </div>
  );
}

function StatusChip({
  label,
  accent,
  pulse,
}: {
  label: string;
  accent: "ok" | "warn" | "error" | "cyan" | "neutral";
  pulse?: boolean;
}) {
  const border = {
    ok: "border-emerald-400/25",
    warn: "border-rose-400/25",
    error: "border-rose-400/30",
    cyan: "border-cyan-400/25",
    neutral: "border-slate-400/18",
  }[accent];
  const bg = {
    ok: "bg-emerald-500/8",
    warn: "bg-rose-500/8",
    error: "bg-rose-500/10",
    cyan: "bg-cyan-500/8",
    neutral: "bg-slate-800/40",
  }[accent];
  const text = {
    ok: "text-emerald-200",
    warn: "text-rose-200",
    error: "text-rose-200",
    cyan: "text-cyan-200",
    neutral: "text-slate-300",
  }[accent];
  const dot = {
    ok: "bg-emerald-400",
    warn: "bg-rose-400",
    error: "bg-rose-400",
    cyan: "bg-cyan-400",
    neutral: "bg-slate-500",
  }[accent];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-[3px] font-mono text-[9px] font-semibold uppercase tracking-[0.2em]",
        border,
        bg,
        text,
      )}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        {pulse ? (
          <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", dot)} />
        ) : null}
        <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", dot)} />
      </span>
      {label}
    </span>
  );
}

function statusLabel(s: TelemetryStatus) {
  switch (s) {
    case "active":
      return "Telemetry Stream Active";
    case "connecting":
      return "Connecting";
    case "cold-start":
      return "Reconnecting";
    case "error":
      return "Connection Lost";
  }
}

function statusAccent(s: TelemetryStatus): "ok" | "warn" | "error" | "neutral" {
  switch (s) {
    case "active":
      return "ok";
    case "connecting":
      return "neutral";
    case "cold-start":
      return "warn";
    case "error":
      return "error";
  }
}
