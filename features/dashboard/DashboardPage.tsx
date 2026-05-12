"use client";

import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { ControlPanel } from "@/features/dashboard/ControlPanel";
import { DashboardProvider, useDashboard } from "@/features/dashboard/dashboard-context";
import { MetricsRow } from "@/features/dashboard/MetricsRow";
import { VisualizationGrid } from "@/features/dashboard/VisualizationGrid";
import { useMission } from "@/features/mission/mission-context";
import { useNow } from "@/hooks/useNow";
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

  const metrics = useMemo(() => {
    // Update metrics only when a run completes (keeps everything feeling synchronized).
    const base = controls.model === "GRU" ? 0.62 : 0.78;
    const sat = controls.satellite === "GEO" ? -0.03 : 0.02;
    const axis = controls.errorType === "Clock" ? 0.08 : controls.errorType === "Z" ? 0.05 : 0.02;
    const horizon = Math.min(0.18, (controls.horizonMinutes / (24 * 60)) * 0.22);

    const rmse = (base + sat + axis + horizon + (runCompletedId % 3) * 0.01).toFixed(3);
    const mae = (base - 0.13 + sat + axis * 0.7 + horizon * 0.6 + (runCompletedId % 2) * 0.008).toFixed(3);
    const stability = `${Math.max(84, 97 - Math.round(horizon * 100) - (controls.model === "GRU" ? 2 : 0))}%`;

    return { rmse, mae, stability };
  }, [controls.errorType, controls.horizonMinutes, controls.model, controls.satellite, runCompletedId]);

  const anomalyDetected = useMemo(() => {
    if (runCompletedId === 0) return false;

    const rmse = Number(metrics.rmse);
    const stability = Number(metrics.stability.replace("%", ""));

    return rmse >= 0.84 || stability <= 88;
  }, [metrics.rmse, metrics.stability, runCompletedId]);

  return (
    <>
      <LoadingOverlay show={isLoading} />
      <div className="space-y-4">
        <ControlPanel />
        <VisualizationGrid
          controls={controls}
          runNonce={runCompletedId + (mission.anomaly?.id ?? 0)}
          isRunning={isLoading || isPredicting || mission.active}
          anomalyDetected={anomalyDetected || Boolean(mission.anomaly)}
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
