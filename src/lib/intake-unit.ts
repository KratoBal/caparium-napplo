/**
 * Lili 2026-10-30 11:25 UTC (Takarmányhűtő): at intake the kilogram is the easier unit, so the intake form's unit list
 * starts on "kg"; the withdrawal form keeps the grams. A dimension with no kg (pieces) starts on its first unit, as before.
 * Pure, so a unit test holds it.
 */
export const intakeDefaultUnit = (units: { id: string; symbol: string }[]): string | undefined => (units.find((u) => u.symbol === "kg") ?? units[0])?.id;
