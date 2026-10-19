import { MeasurementPage, type MeasurementSearch } from "@/components/MeasurementPage";

export const dynamic = "force-dynamic";

// VIZ-05, VIZ-06: weekly titration and Hanna checker measurement, the same grid with dilution and RO/SW
export default async function WeeklyMeasurementPage({ searchParams }: { searchParams: Promise<MeasurementSearch> }) {
  return MeasurementPage({ sp: await searchParams, frequency: "WEEKLY", basePath: "/heti", title: "Heti vízmérések", active: "weekly" });
}
