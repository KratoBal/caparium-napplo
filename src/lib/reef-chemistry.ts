// Taken over unchanged from KratoBal/acropora-os packages/aquarium-calc/src/reef-chemistry.ts (commit f713c386, #1171;
// the same on main 09d742df), task caparium-hibak-3, Balazs 2026-10-20 08:41 UTC (msg 1562022816465817651): "atvetel, nem
// ujrairas". The two repos live apart, so it is a copy with its source named, not a shared package. A change goes to
// both, the OS first.

/**
 * VÍZKEZELÉSI ADAGOLÁS-SZÁMÍTÁS, TISZTA VEGYSZEREKRE.
 *
 * Balázs döntése (2026-09-25, Partner Portál "Kalkulátorok"): csak a
 * TISZTA, egyetlen vegyületből álló vegyszerek számolása kerül ide --
 * kalcium-klorid-dihidrát, magnézium-klorid-hexahidrát, magnézium-
 * szulfát-heptahidrát, nátrium-hidrogén-karbonát. Ezeknél a kiadandó
 * mennyiség a KÉMIAI KÉPLETBŐL következik, nem egy gyártó saját, nem
 * publikus koncentrációjából. A márkás termékek (Kalkwasser, B-Ionic,
 * Seachem stb.) EZÉRT NEM kerülnek ide -- a döntés végleges, nem "egyelőre
 * kimaradt": az állatkert tiszta vegyszert használ, tehát a márkás ág nem
 * egy később bővítendő hiány, hanem soha nem lesz ide való adat.
 *
 * === MIÉRT GRAMM, NEM MILLILITER ===
 *
 * A Figma terv (`PartnerKalkulator`) a Kalcium kártyán "ml" mértékegységet
 * mutat -- ez feltehetően egy előre elkészített törzsoldat (pl. "1 liter
 * vízben X gramm CaCl2·2H2O") adagolását tételezi fel. Egy ilyen törzsoldat
 * koncentrációja SEHOL nincs megadva, és Balázs kifejezetten kérte, hogy ne
 * találjunk ki gyártói/saját adagolási szabványt. A SZILÁRD VEGYSZER TÖMEGE
 * viszont a képletből egyértelműen következik -- ezért minden kalkulátor
 * grammban ad eredményt, a Kalcium kártya is, a terv "ml" jelölésétől
 * eltérve.
 *
 * === A MOLTÖMEGEK FORRÁSA ===
 *
 * IUPAC szabványos atomtömegek (2021-es táblázat, 3 tizedesjegyre kerekítve,
 * ahogy a vízkezelési szakirodalom is szokta):
 *   H = 1.008, C = 12.011, O = 15.999, Na = 22.990, Mg = 24.305,
 *   S = 32.06, Cl = 35.453, Ca = 40.078 (g/mol)
 *
 * === A dKH -> meq/L ÁTVÁLTÁS FORRÁSA ===
 *
 * 1 °dKH = 1/2.8 meq/L (azaz 1 meq/L = 2,8 °dKH) -- ez a tengeri
 * akvarisztikai szakirodalomban általánosan használt átváltás (Randy
 * Holmes-Farley: "Chemistry and the Aquarium" cikksorozat, Reefkeeping/
 * Advanced Aquarist, a hobbi egyik legszélesebb körben idézett vízkémiai
 * forrása). A nátrium-hidrogén-karbonát (NaHCO3, szódabikarbóna) ebben az
 * összefüggésben EGY egyenérték lúgosságot ad molonként (a HCO3- egyetlen
 * proton felvételére képes ebben a tartományban), tehát az egyenérték-
 * tömege megegyezik a moltömegével.
 */

/** g/mol, ld. a fájl fejlécét a forrásért. */
const ATOMIC_WEIGHT = {
  H: 1.008,
  C: 12.011,
  O: 15.999,
  Na: 22.99,
  Mg: 24.305,
  S: 32.06,
  Cl: 35.453,
  Ca: 40.078,
} as const;

/**
 * KALCIUM-KLORID-DIHIDRÁT (CaCl2 · 2H2O).
 * Moltömeg = Ca + 2Cl + 2(2H+O) = 40.078 + 70.906 + 36.030 = 147.014 g/mol.
 * A Ca tömegaránya benne: 40.078 / 147.014.
 */
const CACL2_DIHYDRATE_MOLAR_MASS =
  ATOMIC_WEIGHT.Ca +
  2 * ATOMIC_WEIGHT.Cl +
  2 * (2 * ATOMIC_WEIGHT.H + ATOMIC_WEIGHT.O);
const CACL2_DIHYDRATE_CA_FRACTION =
  ATOMIC_WEIGHT.Ca / CACL2_DIHYDRATE_MOLAR_MASS;

/**
 * MAGNÉZIUM-KLORID-HEXAHIDRÁT (MgCl2 · 6H2O).
 * Moltömeg = Mg + 2Cl + 6(2H+O) = 24.305 + 70.906 + 108.090 = 203.301 g/mol.
 */
const MGCL2_HEXAHYDRATE_MOLAR_MASS =
  ATOMIC_WEIGHT.Mg +
  2 * ATOMIC_WEIGHT.Cl +
  6 * (2 * ATOMIC_WEIGHT.H + ATOMIC_WEIGHT.O);
const MGCL2_HEXAHYDRATE_MG_FRACTION =
  ATOMIC_WEIGHT.Mg / MGCL2_HEXAHYDRATE_MOLAR_MASS;

/**
 * MAGNÉZIUM-SZULFÁT-HEPTAHIDRÁT (MgSO4 · 7H2O, "keserűsó").
 * Moltömeg = Mg + S + 4O + 7(2H+O) = 24.305+32.06+63.996+126.105
 *          = 246.466 g/mol.
 */
const MGSO4_HEPTAHYDRATE_MOLAR_MASS =
  ATOMIC_WEIGHT.Mg +
  ATOMIC_WEIGHT.S +
  4 * ATOMIC_WEIGHT.O +
  7 * (2 * ATOMIC_WEIGHT.H + ATOMIC_WEIGHT.O);
const MGSO4_HEPTAHYDRATE_MG_FRACTION =
  ATOMIC_WEIGHT.Mg / MGSO4_HEPTAHYDRATE_MOLAR_MASS;

/**
 * NÁTRIUM-HIDROGÉN-KARBONÁT (NaHCO3, szódabikarbóna).
 * Moltömeg = Na + H + C + 3O = 22.990+1.008+12.011+47.997 = 84.006 g/mol.
 */
const NAHCO3_MOLAR_MASS =
  ATOMIC_WEIGHT.Na + ATOMIC_WEIGHT.H + ATOMIC_WEIGHT.C + 3 * ATOMIC_WEIGHT.O;

/** 1 °dKH ennyi milliegyenérték lúgosságot jelent literenként. Forrás a fájl fejlécében. */
const MEQ_PER_DKH = 1 / 2.8;

export type ReefChemistryElevationResult =
  { kind: "dose"; grams: number } | { kind: "no-dosing-needed" };

export interface ConcentrationElevationInput {
  volumeLiters: number;
  currentMgL: number;
  targetMgL: number;
}

export interface AlkalinityElevationInput {
  volumeLiters: number;
  currentDkh: number;
  targetDkh: number;
}

export type MagnesiumSalt = "MGCL2_HEXAHYDRATE" | "MGSO4_HEPTAHYDRATE";

/**
 * A KÖZÖS "NINCS SZÜKSÉG ADAGOLÁSRA" SZABÁLY.
 *
 * Balázs kérése, szó szerint: "Negatív vagy nulla emelés (cél <= jelenlegi)
 * ne adjon számot, hanem mondja ki." Ez a három kalkulátor MINDEGYIKÉRE
 * egyformán vonatkozik, ezért egy közös segédfüggvény dönti el.
 */
function elevationOrNull(
  volumeLiters: number,
  current: number,
  target: number,
): number | null {
  const delta = target - current;
  if (delta <= 0) return null;
  return delta * volumeLiters;
}

/**
 * KALCIUM EMELÉSE KALCIUM-KLORID-DIHIDRÁTTAL.
 *
 * A szükséges Ca tömeg (mg) = (cél - jelenlegi)(mg/l) × térfogat (l). Ebből
 * a CaCl2·2H2O tömege a Ca-tömegarányon (`CACL2_DIHYDRATE_CA_FRACTION`)
 * keresztül adódik, majd mg -> g átváltás.
 */
export function calciumElevation(
  input: ConcentrationElevationInput,
): ReefChemistryElevationResult {
  const neededCaMg = elevationOrNull(
    input.volumeLiters,
    input.currentMgL,
    input.targetMgL,
  );
  if (neededCaMg === null) return { kind: "no-dosing-needed" };
  const grams = neededCaMg / CACL2_DIHYDRATE_CA_FRACTION / 1000;
  return { kind: "dose", grams };
}

const MAGNESIUM_SALT_FRACTION: Record<MagnesiumSalt, number> = {
  MGCL2_HEXAHYDRATE: MGCL2_HEXAHYDRATE_MG_FRACTION,
  MGSO4_HEPTAHYDRATE: MGSO4_HEPTAHYDRATE_MG_FRACTION,
};

/**
 * MAGNÉZIUM EMELÉSE, A VÁLASZTOTT TISZTA SÓVAL.
 *
 * Ugyanaz a logika, mint a kalciumnál, csak a választott só Mg-
 * tömegarányával -- a két só NEM keverve adagolódik, a hívó EGYET választ
 * (`salt`), és a számítás kizárólag arra a sóra vonatkozik.
 */
export function magnesiumElevation(
  input: ConcentrationElevationInput & { salt: MagnesiumSalt },
): ReefChemistryElevationResult {
  const neededMgMg = elevationOrNull(
    input.volumeLiters,
    input.currentMgL,
    input.targetMgL,
  );
  if (neededMgMg === null) return { kind: "no-dosing-needed" };
  const fraction = MAGNESIUM_SALT_FRACTION[input.salt];
  const grams = neededMgMg / fraction / 1000;
  return { kind: "dose", grams };
}

/**
 * KH (KARBONÁT-KEMÉNYSÉG / LÚGOSSÁG) EMELÉSE NÁTRIUM-HIDROGÉN-KARBONÁTTAL.
 *
 * A szükséges lúgosság-emelés milliegyenértékben: (cél - jelenlegi)(°dKH) ×
 * `MEQ_PER_DKH` × térfogat(l). A NaHCO3 egyenérték-tömege megegyezik a
 * moltömegével (ld. a fájl fejlécét), tehát a tömeg (mg) = milliegyenérték ×
 * moltömeg, majd mg -> g átváltás.
 */
export function alkalinityElevation(
  input: AlkalinityElevationInput,
): ReefChemistryElevationResult {
  const neededDkh = elevationOrNull(
    input.volumeLiters,
    input.currentDkh,
    input.targetDkh,
  );
  if (neededDkh === null) return { kind: "no-dosing-needed" };
  // `neededDkh` itt `deltaDkh * volumeLiters` -- még nem méregmentes
  // egység, ezért a `MEQ_PER_DKH`-t itt, nem az `elevationOrNull`-ban
  // szorozzuk be.
  const neededMeq = neededDkh * MEQ_PER_DKH;
  const grams = (neededMeq * NAHCO3_MOLAR_MASS) / 1000;
  return { kind: "dose", grams };
}
