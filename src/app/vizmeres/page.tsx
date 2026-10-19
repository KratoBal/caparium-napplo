import { MeasurementPage, type MeasurementSearch } from "@/components/MeasurementPage";

export const dynamic = "force-dynamic";

export default async function DailyMeasurementPage({ searchParams }: { searchParams: Promise<MeasurementSearch> }) {
  return MeasurementPage({ sp: await searchParams, frequency: "DAILY", basePath: "/vizmeres", title: "Napi vízmérések", active: "daily" });
}
