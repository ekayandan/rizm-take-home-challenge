/** Light timing logs. Off by default; the server entry point turns them on, so tests stay quiet. */
let enabled = false;

export function enablePerfLog(): void {
  enabled = true;
}

export function perfLog(label: string, ms: number): void {
  if (enabled) console.log(`[perf] ${label}: ${ms.toFixed(1)} ms`);
}

export function timed<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const out = fn();
  perfLog(label, performance.now() - start);
  return out;
}
