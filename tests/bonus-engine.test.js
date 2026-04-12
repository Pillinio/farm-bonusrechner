// Golden-master tests for shared/bonus-engine.js
// Uses Node's built-in test runner — run with: node --test tests/bonus-engine.test.js

import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

/** Helper for floating-point comparisons (tolerance 1e-9). */
function approx(actual, expected, msg) {
  ok(
    Math.abs(actual - expected) < 1e-9,
    msg ?? `expected ≈${expected}, got ${actual}`,
  );
}

import {
  DEFAULTS,
  calculateEbit,
  calculateEbitBonus,
  calculateProductivityIndex,
  productivityFactor,
  calculateBonus,
} from '../shared/bonus-engine.js';

// ─── Group A: calculateEbit() ───────────────────────────────────────────────

describe('calculateEbit()', () => {
  it('A1 — default scenario', () => {
    const r = calculateEbit({
      herdSize: 800,
      slaughterWeight: 225,
      salesRate: 26,
      pricePerKg: 60,
      baseCosts: 2_000_000,
    });
    strictEqual(r.soldAnimals, 208);                 // round(800*0.26) = 208
    strictEqual(r.totalSlaughterWeight, 46_800);     // 208 * 225
    strictEqual(r.cattleRevenue, 2_808_000);         // 46800 * 60
    strictEqual(r.totalRevenue, 2_808_000);
    strictEqual(r.totalCost, 2_000_000);
    strictEqual(r.ebit, 808_000);
  });

  it('A2 — with side revenues', () => {
    const r = calculateEbit({
      herdSize: 800,
      slaughterWeight: 225,
      salesRate: 26,
      pricePerKg: 60,
      baseCosts: 2_000_000,
      huntingRevenue: 100_000,
      rentRevenue: 50_000,
      otherRevenue: 25_000,
    });
    strictEqual(r.totalRevenue, 2_808_000 + 175_000);
    strictEqual(r.ebit, 808_000 + 175_000);
  });

  it('A3 — salesRate=0 yields no sales, ebit = -baseCosts', () => {
    const r = calculateEbit({
      herdSize: 800,
      slaughterWeight: 225,
      salesRate: 0,
      pricePerKg: 60,
      baseCosts: 2_000_000,
    });
    strictEqual(r.soldAnimals, 0);
    strictEqual(r.totalSlaughterWeight, 0);
    strictEqual(r.cattleRevenue, 0);
    strictEqual(r.ebit, -2_000_000);
  });

  it('A4 — rounding: herdSize=100, salesRate=33.3 → soldAnimals=33', () => {
    const r = calculateEbit({
      herdSize: 100,
      slaughterWeight: 200,
      salesRate: 33.3,
      pricePerKg: 50,
      baseCosts: 0,
    });
    strictEqual(r.soldAnimals, 33); // Math.round(100 * 0.333) = Math.round(33.3) = 33
  });
});

// ─── Group B: calculateEbitBonus() ──────────────────────────────────────────

describe('calculateEbitBonus()', () => {
  it('B5 — EBIT=0 → total=0, empty breakdown', () => {
    const r = calculateEbitBonus(0);
    strictEqual(r.total, 0);
    strictEqual(r.breakdown.length, 0);
  });

  it('B6 — EBIT=-500000 → total=0, empty breakdown', () => {
    const r = calculateEbitBonus(-500_000);
    strictEqual(r.total, 0);
    strictEqual(r.breakdown.length, 0);
  });

  it('B7 — EBIT=100000 (exact tier1 boundary) → total=8000', () => {
    // 100000 * 0.08 = 8000
    const r = calculateEbitBonus(100_000);
    strictEqual(r.total, 8_000);
    strictEqual(r.breakdown.length, 1);
  });

  it('B8 — EBIT=500000 (tier1+tier2) → total=56000', () => {
    // Tier 1: 100000 * 0.08 = 8000
    // Tier 2: 400000 * 0.12 = 48000
    // Total: 56000
    const r = calculateEbitBonus(500_000);
    strictEqual(r.total, 56_000);
    strictEqual(r.breakdown.length, 2);
  });

  it('B9 — EBIT=2000000 (tier1-3) → total=281000', () => {
    // Tier 1: 100000 * 0.08 =   8000
    // Tier 2: 400000 * 0.12 =  48000
    // Tier 3: 1500000 * 0.15 = 225000
    // Total: 281000
    const r = calculateEbitBonus(2_000_000);
    strictEqual(r.total, 281_000);
    strictEqual(r.breakdown.length, 3);
  });

  it('B10 — EBIT=4000000 (cap, all tiers) → total=681000', () => {
    // Tier 1:   100000 * 0.08 =   8000
    // Tier 2:   400000 * 0.12 =  48000
    // Tier 3:  1500000 * 0.15 = 225000
    // Tier 4:  2000000 * 0.20 = 400000
    // Total: 681000
    const r = calculateEbitBonus(4_000_000);
    strictEqual(r.total, 681_000);
    strictEqual(r.breakdown.length, 4);
  });

  it('B11 — EBIT=5000000 (over cap) → same as 4M = 681000', () => {
    const r = calculateEbitBonus(5_000_000);
    strictEqual(r.total, 681_000);
  });

  it('B12 — custom params: tier1Rate=10, ebitCap=2', () => {
    // cappedEbit = min(500000, 2000000) = 500000
    // Tier 1: 100000 * 0.10 = 10000
    // Tier 2: 400000 * 0.12 = 48000 (uses default tier2Rate)
    // Total: 58000
    const r = calculateEbitBonus(500_000, {
      ...DEFAULTS,
      tier1Rate: 10,
      ebitCap: 2,
    });
    strictEqual(r.total, 58_000);
    strictEqual(r.breakdown.length, 2);
  });
});

// ─── Group C: calculateProductivityIndex() & productivityFactor() ───────────

describe('calculateProductivityIndex()', () => {
  it('C13 — totalCost=0 → index=0', () => {
    strictEqual(calculateProductivityIndex(46_800, 0), 0);
  });

  it('C14 — slaughterKg=46800, totalCost=2000000 → index=23.4', () => {
    // (46800 / 2000000) * 1000 = 23.4
    approx(calculateProductivityIndex(46_800, 2_000_000), 23.4);
  });
});

describe('productivityFactor() boundary behavior', () => {
  it('C15a — index=0 → factor 0 (no-cost branch)', () => {
    const r = productivityFactor(0);
    strictEqual(r.factor, 0);
  });

  it('C15b — index=14.99 → critical (factor 0), strictly < 15', () => {
    const r = productivityFactor(14.99);
    strictEqual(r.factor, DEFAULTS.prodFactorCritical); // 0
  });

  it('C15c — index=15 exactly → ok (factor 1.0), threshold uses >= 15', () => {
    // Code: if (index < 15) → critical; if (index <= 20) → ok
    // So 15 passes the < 15 check, falls into <= 20 → ok
    const r = productivityFactor(15);
    strictEqual(r.factor, DEFAULTS.prodFactorOk); // 1.0
  });

  it('C15d — index=20 → ok (factor 1.0), threshold uses <= 20', () => {
    const r = productivityFactor(20);
    strictEqual(r.factor, DEFAULTS.prodFactorOk); // 1.0
  });

  it('C15e — index=20.01 → good (factor 1.5)', () => {
    const r = productivityFactor(20.01);
    strictEqual(r.factor, DEFAULTS.prodFactorGood); // 1.5
  });

  it('C15f — index=25 → good (factor 1.5), threshold uses <= 25', () => {
    const r = productivityFactor(25);
    strictEqual(r.factor, DEFAULTS.prodFactorGood); // 1.5
  });

  it('C15g — index=25.01 → excellent (factor 2.0)', () => {
    const r = productivityFactor(25.01);
    strictEqual(r.factor, DEFAULTS.prodFactorExcellent); // 2.0
  });
});

// ─── Group D: calculateBonus() orchestration ────────────────────────────────

describe('calculateBonus()', () => {
  it('D16 — default full scenario: ebit=808000', () => {
    // EBIT bonus:
    //   Tier 1: 100000 * 0.08 = 8000
    //   Tier 2: 400000 * 0.12 = 48000
    //   Tier 3: 308000 * 0.15 = 46200
    //   ebitBonusRaw = 102200
    //
    // Weights: ebitWeight = 70%, prodWeight = 30%
    //   ebitBonusWeighted = 102200 * 0.70 = 71540
    //
    // Productivity: index = (46800 / 2000000) * 1000 = 23.4
    //   23.4 > 20 and <= 25 → good → factor 1.5
    //   prodBonus = 102200 * 0.30 * 1.5 = 45990
    //
    // totalBonus = 71540 + 45990 = 117530
    const r = calculateBonus({
      ebit: 808_000,
      slaughterKg: 46_800,
      totalCost: 2_000_000,
    });
    strictEqual(r.ebitBonusRaw, 102_200);
    strictEqual(r.ebitBonusWeighted, 71_540);
    approx(r.productivityIndex, 23.4);
    strictEqual(r.prodFactor, 1.5);
    approx(r.prodBonus, 45_990);
    approx(r.totalBonus, 117_530);
  });

  it('D17 — critical productivity (factor 0): very low slaughterKg', () => {
    // index = (100 / 2000000) * 1000 = 0.05 → < 15 → critical, factor 0
    // ebitBonusRaw for ebit=808000 = 102200
    // ebitBonusWeighted = 102200 * 0.70 = 71540
    // prodBonus = 102200 * 0.30 * 0 = 0
    // totalBonus = 71540
    const r = calculateBonus({
      ebit: 808_000,
      slaughterKg: 100,
      totalCost: 2_000_000,
    });
    strictEqual(r.prodFactor, 0);
    strictEqual(r.prodBonus, 0);
    strictEqual(r.totalBonus, 71_540);
  });

  it('D18 — excellent productivity (factor 2.0): high slaughterKg', () => {
    // index = (60000 / 2000000) * 1000 = 30 → > 25 → excellent, factor 2.0
    // ebitBonusRaw for ebit=808000 = 102200
    // prodBonus = 102200 * 0.30 * 2.0 = 61320
    // totalBonus = 71540 + 61320 = 132860
    const r = calculateBonus({
      ebit: 808_000,
      slaughterKg: 60_000,
      totalCost: 2_000_000,
    });
    strictEqual(r.prodFactor, 2.0);
    approx(r.prodBonus, 61_320);
    approx(r.totalBonus, 132_860);
  });

  it('D19 — ebitWeight=100 → prodBonus must be 0', () => {
    // prodWeight = 1 - 1.0 = 0
    // prodBonus = ebitBonusRaw * 0 * factor = 0
    const r = calculateBonus({
      ebit: 808_000,
      slaughterKg: 60_000,
      totalCost: 2_000_000,
      params: { ...DEFAULTS, ebitWeight: 100 },
    });
    strictEqual(r.prodBonus, 0);
    strictEqual(r.totalBonus, r.ebitBonusRaw); // 100% goes to EBIT
  });
});

// ─── Group E: Integration ───────────────────────────────────────────────────

describe('Integration: calculateEbit() → calculateBonus()', () => {
  it('E20 — full pipeline end-to-end', () => {
    const ebitResult = calculateEbit({
      herdSize: 800,
      slaughterWeight: 225,
      salesRate: 26,
      pricePerKg: 60,
      baseCosts: 2_000_000,
    });

    strictEqual(ebitResult.ebit, 808_000);
    strictEqual(ebitResult.totalSlaughterWeight, 46_800);
    strictEqual(ebitResult.totalCost, 2_000_000);

    const bonusResult = calculateBonus({
      ebit: ebitResult.ebit,
      slaughterKg: ebitResult.totalSlaughterWeight,
      totalCost: ebitResult.totalCost,
    });

    strictEqual(bonusResult.ebitBonusRaw, 102_200);
    strictEqual(bonusResult.totalBonus, 117_530);
    strictEqual(bonusResult.breakdown.length, 3);
  });
});
