"use client";

import { cn } from "@/lib/cn";
import { formatElapsed, useMission } from "@/features/mission/mission-context";
import { AnimatePresence, motion } from "framer-motion";

export function MissionStatusBar() {
  const mission = useMission();
  const { active, elapsedSec, anomaly, anomalyCount, toggle } = mission;

  return (
    <div
      className={cn(
        "sticky top-16 z-20 w-full border-b backdrop-blur-md transition-colors",
        active
          ? "border-emerald-400/20 bg-emerald-500/[0.04]"
          : "border-slate-400/10 bg-slate-950/60",
      )}
    >
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2 lg:px-6">
        <StatusPill active={active} />

        <div className="flex min-w-0 items-center gap-4 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-300/80">
          <span className="truncate">
            <span className="text-slate-500/85">elapsed</span>{" "}
            <span className={cn("tabular-nums", active ? "text-emerald-200" : "text-slate-400/85")}>
              {active ? formatElapsed(elapsedSec) : "00:00:00"}
            </span>
          </span>
          <span className="hidden sm:inline h-1 w-1 rounded-full bg-slate-500/70" />
          <span className="hidden sm:inline">
            <span className="text-slate-500/85">anomalies</span>{" "}
            <span className="tabular-nums text-slate-200/85">{anomalyCount}</span>
          </span>
          <span className="hidden md:inline h-1 w-1 rounded-full bg-slate-500/70" />
          <span className="hidden md:inline truncate">
            <span className="text-slate-500/85">mode</span>{" "}
            <span className={cn(active ? "text-cyan-200" : "text-slate-400/85")}>
              {active ? "LIVE STREAM" : "STANDBY"}
            </span>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <AnimatePresence>
            {anomaly ? (
              <motion.div
                key={anomaly.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.18 }}
                className={cn(
                  "hidden md:flex items-center gap-2 rounded-sm border px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.18em]",
                  anomaly.severity === "WARNING"
                    ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
                    : "border-amber-400/30 bg-amber-500/10 text-amber-200",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    anomaly.severity === "WARNING" ? "bg-rose-400" : "bg-amber-400",
                  )}
                />
                {anomaly.severity} · {anomaly.channel} · {anomaly.note}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <button
            type="button"
            onClick={toggle}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors",
              active
                ? "border-rose-400/35 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15"
                : "border-cyan-400/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15",
            )}
          >
            {active ? (
              <>
                <StopIcon />
                End Simulation
              </>
            ) : (
              <>
                <PlayIcon />
                Start Mission Simulation
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-sm border px-2.5 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.2em]",
        active
          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
          : "border-slate-400/20 bg-slate-800/40 text-slate-300/80",
      )}
    >
      <span className="relative inline-flex h-2 w-2">
        {active ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            active ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-slate-500/80",
          )}
        />
      </span>
      Mission Status: {active ? "Active" : "Standby"}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7L8 5Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}
