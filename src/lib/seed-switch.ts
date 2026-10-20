// The synthetic test master data (feeds, chemicals, species, animals) goes in only where it is
// asked for (review note on #15, before go-live): CAPARIUM_SEED_SZINTETIKUS=1 (the stage), or on the
// CI runner (GitHub sets CI=true) unless the switch says 0. A live database never gets it.
export function syntheticWanted(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.CAPARIUM_SEED_SZINTETIKUS?.trim();
  if (v === "1") return true;
  if (v === "0") return false;
  return env.CI === "true";
}

// The description's starting ANIMALS (src/lib/initial-data.ts, caparium-hibak-1) go in only on the test system
// (acrobot's decision 2026-10-20, msg 33316): a live system's admin records them with their real arrival, and a
// made-up 2026-01-01 arrival would be false first data there. No new variable: the test system's existing mark,
// CAPARIUM_SEED_SZINTETIKUS=1, set explicitly (docker-compose.yml: "1 on the stage only, never on a live
// system"). Not the CI=true fallback of syntheticWanted, and anything else (missing, 0, unclear) means no.
// The starting FEEDS have no date and load everywhere. The stage has no such variable: there the test system's
// mark in its data decides (src/lib/initial-data.ts hasTestSystemData).
export function initialAnimalsWanted(env: Record<string, string | undefined> = process.env): boolean {
  return env.CAPARIUM_SEED_SZINTETIKUS?.trim() === "1";
}
