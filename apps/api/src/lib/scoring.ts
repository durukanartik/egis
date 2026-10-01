// Scoring & Classification engine — a pure function over (Application, ConfigVersion, IntegratedData),
// per Section 8 of the System Architecture Document. Criterion formulas are evaluated by a small,
// explicit registry (not a generic expression evaluator) to keep the engine auditable and safe.

export type Criterion = {
  code: string;
  sector: string; // "All" or comma-separated sector list
  name: string;
  data_source: string;
  formula: string;
  weight: number;
  active: boolean;
  thresholds: { T1: number; T2: number; T3: number };
};

export type LifecycleRules = {
  licence_status_gating: boolean;
  suspension_cascade: boolean;
  classification_validity_months: number;
  upgrade_cycle_months: number;
  review_window_days: number;
  gps_scope: string;
};

export type TierThresholds = { A: number; B: number; C: number };

export type IntegratedData = {
  bolisaty: Record<string, unknown>;
  iwms: Record<string, unknown>;
  compliance?: { open_violations: number };
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Evaluates a single criterion's raw ratio (0..1 expected, but not clamped here) from integrated data.
 * Returns null when a required input field is unavailable ("Not Available" in the EAD data catalogue) —
 * callers must treat null as "cannot evaluate" and the criterion must have been marked inactive by config
 * governance, per the architectural implication in Section 7.2.
 */
export function evaluateCriterionValue(code: string, data: IntegratedData): number | null {
  const b = data.bolisaty ?? {};
  const w = data.iwms ?? {};
  const compliance = data.compliance ?? { open_violations: 0 };

  switch (code) {
    case "TRN.FLEET_COMPLIANCE": {
      const compliant = num(b.compliant_vehicles);
      const total = num(b.vehicle_count);
      if (compliant === null || total === null || total === 0) return null;
      return compliant / total;
    }
    case "TRN.FLEET_AGE": {
      const age = num(b.avg_vehicle_age_years);
      if (age === null) return null;
      return 1 - age / 15;
    }
    case "TRT.RECOVERY_RATE": {
      const recovered = num(w.recovered_output_qty_tonnes_month);
      const received = num(w.received_qty_tonnes_month);
      if (recovered === null || received === null || received === 0) return null;
      return recovered / received;
    }
    case "TRT.THROUGHPUT_UTILISATION": {
      const treated = num(w.treated_qty_tonnes_month);
      const received = num(w.received_qty_tonnes_month);
      if (treated === null || received === null || received === 0) return null;
      return treated / received;
    }
    case "COMPLIANCE.VIOLATION_FREE": {
      const openViolations = num(compliance.open_violations) ?? 0;
      return 1 - Math.min(openViolations, 1);
    }
    case "MARKET.ACTIVE_CONTRACTS": {
      const contracts = num(b.active_contracts);
      if (contracts === null) return null;
      return Math.min(contracts / 20, 1);
    }
    case "WORKFORCE.EMIRATISATION": {
      const pct = num(w.emiratisation_pct);
      if (pct === null) return null;
      return pct;
    }
    case "ECONOMIC.ICV_SCORE": {
      const score = num(w.icv_score);
      if (score === null) return null;
      return score / 100;
    }
    default:
      return null;
  }
}

function criterionTier(value: number, thresholds: { T1: number; T2: number; T3: number }): "T1" | "T2" | "T3" | "BELOW_T3" {
  if (value >= thresholds.T1) return "T1";
  if (value >= thresholds.T2) return "T2";
  if (value >= thresholds.T3) return "T3";
  return "BELOW_T3";
}

const TIER_SCORE: Record<string, number> = { T1: 1, T2: 0.75, T3: 0.5, BELOW_T3: 0.25 };

export type CriterionBreakdown = {
  code: string;
  name: string;
  sector: string;
  weight: number;
  normalized_weight: number;
  applicable: boolean;
  evaluable: boolean;
  value: number | null;
  criterion_tier: string | null;
  tier_score: number | null;
  contribution: number;
  reason_excluded?: string;
};

export type ScoreResult = {
  raw_score: number;
  tier: "A" | "B" | "C" | "D";
  breakdown: CriterionBreakdown[];
};

function sectorApplies(criterionSector: string, espSector: string): boolean {
  if (criterionSector === "All") return true;
  return criterionSector.split(",").map((s) => s.trim()).includes(espSector);
}

export function runScoring(
  criteria: Criterion[],
  tierThresholds: TierThresholds,
  espSector: string,
  data: IntegratedData
): ScoreResult {
  const breakdown: CriterionBreakdown[] = [];

  const candidates = criteria.map((c) => {
    const applicable = sectorApplies(c.sector, espSector);
    if (!applicable) {
      return { c, applicable, evaluable: false, value: null as number | null };
    }
    if (!c.active) {
      return { c, applicable, evaluable: false, value: null as number | null, reason: "criterion inactive — data source not yet confirmed by EAD" };
    }
    const value = evaluateCriterionValue(c.code, data);
    return { c, applicable, evaluable: value !== null, value, reason: value === null ? "required data field unavailable" : undefined };
  });

  const usable = candidates.filter((x) => x.applicable && x.evaluable);
  const totalWeight = usable.reduce((s, x) => s + x.c.weight, 0) || 1;

  let rawScore = 0;
  for (const x of candidates) {
    const normalizedWeight = x.applicable && x.evaluable ? x.c.weight / totalWeight : 0;
    if (x.applicable && x.evaluable && x.value !== null) {
      const ct = criterionTier(x.value, x.c.thresholds);
      const tierScore = TIER_SCORE[ct];
      const contribution = tierScore * normalizedWeight;
      rawScore += contribution;
      breakdown.push({
        code: x.c.code,
        name: x.c.name,
        sector: x.c.sector,
        weight: x.c.weight,
        normalized_weight: Number(normalizedWeight.toFixed(4)),
        applicable: true,
        evaluable: true,
        value: Number(x.value.toFixed(4)),
        criterion_tier: ct,
        tier_score: tierScore,
        contribution: Number(contribution.toFixed(4)),
      });
    } else {
      breakdown.push({
        code: x.c.code,
        name: x.c.name,
        sector: x.c.sector,
        weight: x.c.weight,
        normalized_weight: 0,
        applicable: x.applicable,
        evaluable: false,
        value: null,
        criterion_tier: null,
        tier_score: null,
        contribution: 0,
        reason_excluded: !x.applicable ? "not applicable to this ESP's sector" : x.reason,
      });
    }
  }

  rawScore = Number(rawScore.toFixed(4));
  let tier: ScoreResult["tier"] = "D";
  if (rawScore >= tierThresholds.A) tier = "A";
  else if (rawScore >= tierThresholds.B) tier = "B";
  else if (rawScore >= tierThresholds.C) tier = "C";

  return { raw_score: rawScore, tier, breakdown };
}
