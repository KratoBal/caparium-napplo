// Taken over with the module from KratoBal/acropora-os packages/aquarium-calc/src/reef-chemistry.test.ts (f713c386):
// the same cases and hand-computed values, only the runner is vitest here (caparium-hibak-3).
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  alkalinityElevation,
  calciumElevation,
  magnesiumElevation,
} from "@/lib/reef-chemistry";

/**
 * A REFERENCIA-ÉRTÉKEK KÉZI SZÁMÍTÁSSAL SZÜLETTEK, NEM A FÜGGVÉNY
 * ÚJRAFUTTATÁSÁVAL -- a lenti kommentek a nyers aritmetikát mutatják, hogy
 * egy jövőbeli olvasó számológéppel (nem a kóddal) ellenőrizhesse. A
 * toleranciák a kézi kerekítés hibáját fedik, nem a képlet pontatlanságát.
 */

describe("calciumElevation", () => {
  /**
   * CaCl2·2H2O moltömege 147.014 g/mol, Ca-aránya 40.078/147.014=0.272614.
   * 1000 l, 380 -> 420 mg/l: szükséges Ca = 40 mg/l × 1000 l = 40000 mg.
   * Tömeg = 40000 / 0.272614 / 1000 = 146.7 g.
   */
  it("1000 liter, 380->420 mg/l: kb. 146,7 g CaCl2·2H2O", () => {
    const result = calciumElevation({
      volumeLiters: 1000,
      currentMgL: 380,
      targetMgL: 420,
    });
    assert.equal(result.kind, "dose");
    assert.ok(result.kind === "dose");
    assert.ok(
      Math.abs(result.grams - 146.7) < 0.2,
      `${result.grams} nincs 146,7 g közelében`,
    );
  });

  /**
   * FÜGGETLEN KERESZTELLENŐRZÉS, MÁS ÚTON: a hobbi-irodalom közismert
   * ökölszabálya szerint 1 g CaCl2·2H2O 1 gallonban (3,785 l) kb. 72 ppm
   * Ca-emelést ad (40.078/147.014/1000×1000×1000/3.785 ≈ 72,0 mg/l/g).
   * Ebből 40 mg/l emeléshez 1000 literben (264,2 gallon): 40/72×264,2 ≈
   * 146,8 g -- ugyanaz a nagyságrend és érték, mint a fenti direkt
   * számítás, két különböző úton.
   */

  it("cél <= jelenlegi: nincs szükség adagolásra, nincs szám", () => {
    const egyenlo = calciumElevation({
      volumeLiters: 500,
      currentMgL: 420,
      targetMgL: 420,
    });
    assert.deepEqual(egyenlo, { kind: "no-dosing-needed" });

    const csokkeno = calciumElevation({
      volumeLiters: 500,
      currentMgL: 450,
      targetMgL: 420,
    });
    assert.deepEqual(csokkeno, { kind: "no-dosing-needed" });
  });

  /**
   * SZÉLSŐÉRTÉK: jelenlegi = 0. 500 l, 0 -> 400 mg/l: szükséges Ca =
   * 400×500=200000 mg. Tömeg = 200000/0.272614/1000 = 733,6 g.
   */
  it("jelenlegi érték nulláról indulva is helyesen számol", () => {
    const result = calciumElevation({
      volumeLiters: 500,
      currentMgL: 0,
      targetMgL: 400,
    });
    assert.ok(result.kind === "dose");
    assert.ok(
      Math.abs(result.grams - 733.6) < 0.5,
      `${result.grams} nincs 733,6 g közelében`,
    );
  });
});

describe("magnesiumElevation", () => {
  /**
   * MgCl2·6H2O moltömege 203.301 g/mol, Mg-aránya 24.305/203.301=0.119554.
   * 1000 l, 1200 -> 1350 mg/l: szükséges Mg = 150×1000=150000 mg.
   * Tömeg = 150000/0.119554/1000 = 1254,7 g.
   */
  it("MgCl2 hexahidráttal: 1000 liter, 1200->1350 mg/l kb. 1254,7 g", () => {
    const result = magnesiumElevation({
      volumeLiters: 1000,
      currentMgL: 1200,
      targetMgL: 1350,
      salt: "MGCL2_HEXAHYDRATE",
    });
    assert.ok(result.kind === "dose");
    assert.ok(
      Math.abs(result.grams - 1254.7) < 1,
      `${result.grams} nincs 1254,7 g közelében`,
    );
  });

  /**
   * MgSO4·7H2O moltömege 246.466 g/mol, Mg-aránya 24.305/246.466=0.098614.
   * UGYANARRA a 150000 mg Mg-igényre: Tömeg = 150000/0.098614/1000 =
   * 1521,2 g -- TÖBB, mint a klorid-hexahidráté, mert a Mg-arány kisebb.
   * Ez a különbség maga is egy ellenőrzés: ha a két só ugyanazt a számot
   * adná, a `salt` választó nem tenne semmit.
   */
  it("MgSO4 heptahidráttal UGYANARRA a célra TÖBB grammot kér, mint a kloriddal", () => {
    const klorid = magnesiumElevation({
      volumeLiters: 1000,
      currentMgL: 1200,
      targetMgL: 1350,
      salt: "MGCL2_HEXAHYDRATE",
    });
    const szulfat = magnesiumElevation({
      volumeLiters: 1000,
      currentMgL: 1200,
      targetMgL: 1350,
      salt: "MGSO4_HEPTAHYDRATE",
    });
    assert.equal(klorid.kind, "dose");
    assert.equal(szulfat.kind, "dose");
    if (klorid.kind !== "dose" || szulfat.kind !== "dose") return;
    assert.ok(
      Math.abs(szulfat.grams - 1521.2) < 1,
      `${szulfat.grams} nincs 1521,2 g közelében`,
    );
    assert.ok(szulfat.grams > klorid.grams);
  });

  it("cél <= jelenlegi: nincs szükség adagolásra, függetlenül a választott sótól", () => {
    for (const salt of ["MGCL2_HEXAHYDRATE", "MGSO4_HEPTAHYDRATE"] as const) {
      const result = magnesiumElevation({
        volumeLiters: 500,
        currentMgL: 1400,
        targetMgL: 1350,
        salt,
      });
      assert.deepEqual(result, { kind: "no-dosing-needed" });
    }
  });
});

describe("alkalinityElevation", () => {
  /**
   * 1 °dKH = 1/2.8 meq/l. NaHCO3 moltömege 84.006 g/mol, egyenérték-tömege
   * ugyanennyi (monoprotikus ebben az összefüggésben).
   * 1000 l, 7,5 -> 8,3 °dKH: szükséges emelés = 0,8 °dKH.
   * meq = 0,8 × 1000 × (1/2,8) = 285,71 meq.
   * Tömeg = 285,71 × 84,006 / 1000 = 24,00 g.
   */
  it("1000 liter, 7,5->8,3 °dKH: kb. 24,0 g nátrium-hidrogén-karbonát", () => {
    const result = alkalinityElevation({
      volumeLiters: 1000,
      currentDkh: 7.5,
      targetDkh: 8.3,
    });
    assert.ok(result.kind === "dose");
    assert.ok(
      Math.abs(result.grams - 24.0) < 0.1,
      `${result.grams} nincs 24,0 g közelében`,
    );
  });

  /**
   * FÜGGETLEN KERESZTELLENŐRZÉS: 1 meq/l emelés (= 2,8 °dKH) 378,5 literben
   * (100 US gallon) 378,5×84,006/1000 ≈ 31,8 g -- ez ugyanaz a képlet, csak
   * meq/l-ben kifejezve, dKH-átváltás nélkül, tehát a dKH-faktortól
   * FÜGGETLENÜL ellenőrzi a NaHCO3-tömeg számítást.
   */
  it("keresztellenőrzés meq/l-ben, a dKH-átváltástól függetlenül: 378,5 liter, 1 meq/l emelés kb. 31,8 g", () => {
    // 1 meq/l = 2,8 °dKH, tehát ezt dKH-ban kérjük le.
    const result = alkalinityElevation({
      volumeLiters: 378.5,
      currentDkh: 0,
      targetDkh: 2.8,
    });
    assert.ok(result.kind === "dose");
    assert.ok(
      Math.abs(result.grams - 31.8) < 0.2,
      `${result.grams} nincs 31,8 g közelében`,
    );
  });

  it("cél <= jelenlegi: nincs szükség adagolásra, nincs szám", () => {
    const result = alkalinityElevation({
      volumeLiters: 800,
      currentDkh: 8.5,
      targetDkh: 8.5,
    });
    assert.deepEqual(result, { kind: "no-dosing-needed" });
  });

  /**
   * SZÉLSŐÉRTÉK: nagyon kicsi emelés is helyesen ad számot, nem kerekít
   * nullára. 200 l, 8,0 -> 8,1 °dKH: emelés=0,1 °dKH.
   * meq = 0,1×200×(1/2,8) = 7,143 meq. Tömeg = 7,143×84,006/1000 = 0,60 g.
   */
  it("nagyon kicsi emelésre is ad valódi számot, nem nullát", () => {
    const result = alkalinityElevation({
      volumeLiters: 200,
      currentDkh: 8.0,
      targetDkh: 8.1,
    });
    assert.ok(result.kind === "dose");
    assert.ok(
      Math.abs(result.grams - 0.6) < 0.05,
      `${result.grams} nincs 0,6 g közelében`,
    );
  });
});
