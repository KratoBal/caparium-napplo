// The synthetic test master data (feeds, chemicals, species, animals) goes in only where it is
// asked for (review note on #15, before go-live): CAPARIUM_SEED_SZINTETIKUS=1 (the stage), or on the
// CI runner (GitHub sets CI=true) unless the switch says 0. A live database never gets it.
export function syntheticWanted(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.CAPARIUM_SEED_SZINTETIKUS?.trim();
  if (v === "1") return true;
  if (v === "0") return false;
  return env.CI === "true";
}
