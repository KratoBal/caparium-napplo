// Runs the journal job once a minute inside the server process (started from instrumentation.ts).
// Idempotent, so several instances or a restart in the middle of a run do no harm.
import { monthlyPackage } from "./exports/zims";
import { runJournalJob } from "./journal";
import { mailMonthlyPackage } from "./zims-mail";

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
        // the mail of that package (or the warning that there is none): its own try, so a failed sending never
        // costs the package, and the next hourly try sends it again
        try {
          const m = await mailMonthlyPackage(p);
          if (m.sent) console.log("journal job: the monthly ZIMS mail went out");
        } catch (e) {
          console.error("monthly ZIMS mail failed", e instanceof Error ? e.message : e);
        }
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
