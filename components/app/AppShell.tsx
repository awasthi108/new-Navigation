"use client";

import { Sidebar, type NavItemKey } from "@/components/app/Sidebar";
import { TopHeader } from "@/components/app/TopHeader";
import { MissionProvider } from "@/features/mission/mission-context";
import { MissionStatusBar } from "@/features/mission/MissionStatusBar";
import { cn } from "@/lib/cn";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { PropsWithChildren } from "react";
import { useMemo, useState } from "react";

type AppShellProps = PropsWithChildren<{
  className?: string;
}>;

export function AppShell({ className, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  const sidebarWidth = collapsed ? 72 : "clamp(72px, 22vw, 280px)";
  const contentPaddingLeft = sidebarWidth;

  const active = useMemo<NavItemKey>(() => {
    if (pathname.startsWith("/insights")) {
      return "insights";
    }

    if (pathname.startsWith("/system")) {
      return "system";
    }

    return "dashboard";
  }, [pathname]);

  const activeTitle = useMemo(() => {
    switch (active) {
      case "dashboard":
        return "Dashboard";
      case "insights":
        return "Insights";
      case "system":
        return "System";
      default:
        return "Dashboard";
    }
  }, [active]);

  return (
    <MissionProvider>
      <div className={cn("min-h-dvh", className)}>
        <Sidebar
          collapsed={collapsed}
          active={active}
          onToggle={() => setCollapsed((v) => !v)}
        />

        <div style={{ paddingLeft: contentPaddingLeft }} className="transition-[padding] duration-200">
          <TopHeader />
          <MissionStatusBar />

          <div className="relative">
            <div className="pointer-events-none absolute inset-0 navai-grid opacity-[0.32]" />
            <div className="mx-auto max-w-[1400px] px-4 py-6 lg:px-6">
              <div className="mb-5 flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-slate-200/70">
                    Mission Console
                  </div>
                  <div className="truncate text-xl font-semibold tracking-tight text-slate-50">
                    {activeTitle}
                  </div>
                </div>
                <div className="hidden md:block text-xs text-muted">
                  Secure telemetry • Predictive integrity • GNSS anomaly forecasting
                </div>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </MissionProvider>
  );
}
