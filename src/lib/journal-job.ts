// Runs the journal job once a minute inside the server process (started from instrumentation.ts).
// Idempotent, so several instances or a restart in the middle of a run do no harm.
import { runJournalJob } from "./journal";

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
    } catch (e) {
      console.error("journal job failed", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs).unref();
}
