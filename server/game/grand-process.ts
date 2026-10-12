import { appendFileSync, mkdirSync } from "node:fs";
import { freemem, loadavg, uptime } from "node:os";
import path from "node:path";

/** Independent of compressed game logs, so recorder failures remain visible. */
export function monitorGrandProcess(output: string, requestStop: (reason: string) => void) {
  mkdirSync(output, { recursive: true });
  let context = { phase: "startup", tick: 0, day: 0 }, finished = false;
  function record(event: string, detail: object = {}) {
    try { appendFileSync(path.join(output, "process.jsonl"), JSON.stringify({ atUTC: new Date().toISOString(), event,
      pid: process.pid, ppid: process.ppid, uptimeSeconds: process.uptime(), ...context,
      memory: process.memoryUsage(), cpu: process.cpuUsage(), resources: process.resourceUsage(),
      systemFreeMemoryBytes: freemem(), load: loadavg(), systemUptimeSeconds: uptime(), ...detail }) + "\n"); }
    catch (error) { console.error("Process diagnostic write failed:", error); }
  }
  const priorReport = process.report ? { directory: process.report.directory, excludeEnv: process.report.excludeEnv,
    reportOnFatalError: process.report.reportOnFatalError, reportOnUncaughtException: process.report.reportOnUncaughtException } : undefined;
  if (process.report) {
    process.report.directory = output;
    process.report.excludeEnv = true;
    process.report.reportOnFatalError = true;
    process.report.reportOnUncaughtException = true;
  }
  const fatal = (error: Error, origin: string) => record("uncaught-exception", { origin, stack: error.stack });
  const warning = (error: Error) => record("warning", { stack: error.stack });
  const beforeExit = (code: number) => {
    if (!finished) { process.exitCode = 1; record("unexpected-event-loop-exit", { code }); }
  };
  const exit = (code: number) => record("exit", { code, finished });
  const signals = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map(signal => {
    const handler = () => { record("signal", { signal }); requestStop(signal === "SIGHUP" ? "hangup" : "interrupted"); };
    process.on(signal, handler); return { signal, handler };
  });
  process.on("uncaughtExceptionMonitor", fatal); process.on("warning", warning);
  process.on("beforeExit", beforeExit); process.on("exit", exit);
  const timer = setInterval(() => record("heartbeat"), 15_000); timer.unref();
  record("start", { node: process.version, argv: process.argv });
  return {
    status: (value: typeof context) => { context = value; },
    record,
    finish: (error?: unknown) => { finished = true; clearInterval(timer); record(error ? "failure" : "finished", { error: error instanceof Error ? error.stack : error === undefined ? undefined : String(error) }); },
    dispose: () => {
      clearInterval(timer);
      if (process.report && priorReport) Object.assign(process.report, priorReport);
      for (const { signal, handler } of signals) process.removeListener(signal, handler);
      process.removeListener("uncaughtExceptionMonitor", fatal); process.removeListener("warning", warning);
      process.removeListener("beforeExit", beforeExit); process.removeListener("exit", exit);
    },
  };
}
