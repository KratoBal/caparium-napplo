import { FridgePage } from "@/components/MeasurementPage";

export const dynamic = "force-dynamic";

export default async function FridgesPage({ searchParams }: { searchParams: Promise<{ nap?: string }> }) {
  return FridgePage({ sp: await searchParams });
}
