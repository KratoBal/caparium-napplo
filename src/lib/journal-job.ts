// Runs the journal job once a minute inside the server process (started from instrumentation.ts).
// Idempotent, so several instances or a restart in the middle of a run do no harm.
import { monthlyPackage } from "./exports/zims";
import { runJournalJob } from "./journal";

const PACKAGE_EVERY_MS = 60 * 60_000; // VIZ-20: one try an hour, not every minute
let lastPackageTry = 0;

let started = false;
let running = false;

export function startJournalJob(intervalMs = 60_000): void {
  if (started) return;
  started = true;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runJournalJob();
      if (r.closed > 0) console.log(`journal job: closed ${r.closed} day(s)`);
      if (Date.now() - lastPackageTry >= PACKAGE_EVERY_MS) {
        lastPackageTry = Date.now();
        const p = await monthlyPackage();
        if (p.created) console.log(`journal job: the previous month's ZIMS package is ready (${p.runId})`);
      }
    } catch (e) {
      console.error("journal job failed", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs).unref();
}
