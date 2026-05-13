"use client";

import { fetchTelemetry, type TelemetryResponse } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

// =============================================================================
// useTelemetry — 2 s polling hook for the /telemetry endpoint
// =============================================================================
//
// Exposes:
//   data        — latest successful response (null until first fetch)
//   status      — "connecting" | "active" | "error"
//   error       — last error message (null when healthy)
//   retryCount  — consecutive failures (resets on success)
//   history     — rolling window of the last N telemetry arrays (for chart)
//   cycleCount  — number of full replay cycles completed
//   cycleEvent  — increments each time a cycle restart is detected
//
// Behavior:
//   - Polls every POLL_MS while mounted.
//   - On failure, backs off linearly (2s → 4s → 6s, capped at 10s).
//   - Resets to 2s on success.
//   - Avoids overlapping requests (skips tick if previous fetch is in-flight).
//   - Detects when current_index drops (backend wrapped around) and treats it
//     as a seamless continuation — no hard visual reset, just increments
//     cycleCount and cycleEvent.
//   - Cleans up on unmount.
// =============================================================================

const POLL_MS = 2000;
const MAX_BACKOFF_MS = 10_000;
const COLD_START_THRESHOLD = 3; // after this many retries, assume cold-start
const HISTORY_LIMIT = 120; // keep last 120 snapshots (~4 min at 2s)

export type TelemetryStatus = "connecting" | "active" | "error" | "cold-start";

export type TelemetryState = {
  data: TelemetryResponse | null;
  status: TelemetryStatus;
  error: string | null;
  retryCount: number;
  history: number[][]; // rolling window of telemetry arrays
  predictions: number[]; // latest prediction value repeated for chart overlay
  lastFetchMs: number | null;
  cycleCount: number; // how many full replay cycles have completed
  cycleEvent: number; // increments on each cycle restart (for downstream effects)
};

export function useTelemetry() {
  const [state, setState] = useState<TelemetryState>({
    data: null,
    status: "connecting",
    error: null,
    retryCount: 0,
    history: [],
    predictions: [],
    lastFetchMs: null,
    cycleCount: 0,
    cycleEvent: 0,
  });

  const inFlightRef = useRef(false);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const prevIndexRef = useRef<number | null>(null);

  const poll = useCallback(async () => {
    if (inFlightRef.current || !mountedRef.current) return;
    inFlightRef.current = true;

    try {
      const res = await fetchTelemetry();
      if (!mountedRef.current) return;

      retryRef.current = 0;

      setState((prev) => {
        // Detect cycle restart: current_index dropped below previous value.
        // The backend wraps current_index back to WINDOW_SIZE when it reaches
        // the end of the dataset. We detect this as a seamless restart.
        const prevIdx = prevIndexRef.current;
        const cycleRestarted = prevIdx !== null && res.current_index < prevIdx;
        prevIndexRef.current = res.current_index;

        // Keep history continuous across cycle boundaries — just append.
        const history = [...prev.history, res.telemetry].slice(-HISTORY_LIMIT);

        return {
          data: res,
          status: "active",
          error: null,
          retryCount: 0,
          history,
          predictions: [res.prediction],
          lastFetchMs: Date.now(),
          cycleCount: prev.cycleCount + (cycleRestarted ? 1 : 0),
          cycleEvent: prev.cycleEvent + (cycleRestarted ? 1 : 0),
        };
      });
    } catch (err) {
      if (!mountedRef.current) return;
      retryRef.current += 1;

      setState((prev) => ({
        ...prev,
        status: prev.data
          ? "error"
          : retryRef.current >= COLD_START_THRESHOLD
          ? "cold-start"
          : "connecting",
        error: err instanceof Error ? err.message : "Connection failed",
        retryCount: retryRef.current,
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const schedule = () => {
      const backoff = Math.min(
        POLL_MS + retryRef.current * 2000,
        MAX_BACKOFF_MS,
      );
      timerRef.current = setTimeout(async () => {
        await poll();
        if (mountedRef.current) schedule();
      }, retryRef.current === 0 ? POLL_MS : backoff);
    };

    // Initial fetch immediately.
    poll().then(() => {
      if (mountedRef.current) schedule();
    });

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll]);

  return state;
}
