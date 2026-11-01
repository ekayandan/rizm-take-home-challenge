/** Light timing logs for the browser console, dev builds only. Filter the console by "[perf]". */
const enabled = import.meta.env.DEV;

export function perfLog(label: string, ms: number, detail = ""): void {
  if (enabled) console.info(`[perf] ${label}: ${ms.toFixed(1)} ms${detail && ` (${detail})`}`);
}

export function timed<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const out = fn();
  perfLog(label, performance.now() - start);
  return out;
}

/** Logs every main-thread block over 50 ms: the freezes, whatever caused them. */
export function watchLongTasks(): void {
  if (!enabled || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) perfLog("long task", e.duration);
  }).observe({ type: "longtask" });
}
