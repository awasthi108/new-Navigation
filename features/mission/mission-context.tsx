"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// =============================================================================
// Mission Simulation Mode — global runtime
// =============================================================================
//
// A single provider at the app shell level. When active:
//   - a 1 Hz ticker advances elapsed time
//   - an anomaly scheduler fires rare (≈ once every 35–75s) events that other
//     parts of the app can read via `useMissionAnomaly()`
//   - an ambient intensity (0..1) is exposed so surfaces can dial motion/glow
//     without doing their own timing
//
// Scope is intentionally narrow — this is a UI-level simulation switch, not
// something wired into app state or network calls.
// =============================================================================

export type MissionAnomaly = {
  id: number;
  startedAt: number;
  severity: "WATCH" | "WARNING";
  channel: string;
  note: string;
};

type MissionState = {
  active: boolean;
  startedAt: number | null;
  elapsedSec: number;
  intensity: number; // 0..1 ambient "mission energy" — small oscillation
  anomaly: MissionAnomaly | null;
  anomalyCount: number;
};

type MissionApi = MissionState & {
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

const MissionContext = createContext<MissionApi | null>(null);

const ANOMALY_COOLDOWN_MIN_SEC = 32;
const ANOMALY_COOLDOWN_MAX_SEC = 70;
const ANOMALY_DURATION_SEC = 8;

const CHANNELS = ["GEO-1", "MEO-2", "MEO-3", "IGSO-4", "MEO-5", "GEO-6"];
const NOTES = [
  "transient drift spike",
  "orbit deviation flagged",
  "clock bias excursion",
  "residual variance elevated",
  "forecast envelope breached",
];

export function MissionProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [intensity, setIntensity] = useState(0);
  const [anomaly, setAnomaly] = useState<MissionAnomaly | null>(null);
  const [anomalyCount, setAnomalyCount] = useState(0);

  const nextAnomalyAtRef = useRef<number>(Number.POSITIVE_INFINITY);
  const anomalyIdRef = useRef(0);

  const scheduleNextAnomaly = useCallback((now: number) => {
    const delta =
      ANOMALY_COOLDOWN_MIN_SEC +
      Math.random() * (ANOMALY_COOLDOWN_MAX_SEC - ANOMALY_COOLDOWN_MIN_SEC);
    nextAnomalyAtRef.current = now + delta * 1000;
  }, []);

  const start = useCallback(() => {
    const now = Date.now();
    setActive(true);
    setStartedAt(now);
    setElapsedSec(0);
    setAnomalyCount(0);
    setAnomaly(null);
    scheduleNextAnomaly(now + 18_000); // first anomaly window ~18s+ after start
  }, [scheduleNextAnomaly]);

  const stop = useCallback(() => {
    setActive(false);
    setStartedAt(null);
    setElapsedSec(0);
    setIntensity(0);
    setAnomaly(null);
    nextAnomalyAtRef.current = Number.POSITIVE_INFINITY;
  }, []);

  const toggle = useCallback(() => {
    if (active) stop();
    else start();
  }, [active, start, stop]);

  // 1 Hz ticker while active.
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setElapsedSec(startedAt ? Math.round((now - startedAt) / 1000) : 0);
      setIntensity((v) => 0.55 + 0.25 * Math.sin(now / 2400) + (Math.random() - 0.5) * 0.04);

      // Anomaly lifecycle
      setAnomaly((current) => {
        if (current && now - current.startedAt > ANOMALY_DURATION_SEC * 1000) {
          return null;
        }
        return current;
      });

      if (now >= nextAnomalyAtRef.current) {
        anomalyIdRef.current += 1;
        const channel = CHANNELS[Math.floor(Math.random() * CHANNELS.length)];
        const note = NOTES[Math.floor(Math.random() * NOTES.length)];
        const severity: MissionAnomaly["severity"] = Math.random() > 0.55 ? "WARNING" : "WATCH";
        setAnomaly({
          id: anomalyIdRef.current,
          startedAt: now,
          severity,
          channel,
          note,
        });
        setAnomalyCount((c) => c + 1);
        scheduleNextAnomaly(now);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [active, startedAt, scheduleNextAnomaly]);

  const value = useMemo<MissionApi>(
    () => ({
      active,
      startedAt,
      elapsedSec,
      intensity: active ? intensity : 0,
      anomaly,
      anomalyCount,
      start,
      stop,
      toggle,
    }),
    [active, startedAt, elapsedSec, intensity, anomaly, anomalyCount, start, stop, toggle],
  );

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}

export function useMission() {
  const ctx = useContext(MissionContext);
  if (!ctx) {
    // Safe default so non-provider callers (e.g. SSR fallback) don't crash.
    return {
      active: false,
      startedAt: null,
      elapsedSec: 0,
      intensity: 0,
      anomaly: null,
      anomalyCount: 0,
      start: () => {},
      stop: () => {},
      toggle: () => {},
    } satisfies MissionApi;
  }
  return ctx;
}

export function formatElapsed(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
