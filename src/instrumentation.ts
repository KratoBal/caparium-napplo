// Next.js server start hook: the journal job runs in the Node.js server only (not at build time,
// not in the edge runtime). JOURNAL_JOB=off turns it off, e.g. for a second replica.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.JOURNAL_JOB !== "off") {
    const { startJournalJob } = await import("./lib/journal-job");
    startJournalJob();
  }
}
