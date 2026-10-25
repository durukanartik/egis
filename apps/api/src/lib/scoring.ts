// Scoring & Classification engine — implements EAD's confirmed Output 3 / R02 classification model
// as corrected and extended by Output 07 – Licensing Integration and the Egis feedback incorporated
// through System Architecture Document v7.1 (14 Oct 2026): four weighted categories on a 100-point
// scale, differentiated category minimums (non-compensation), a four-tier scale (Premium / Advanced
// / Basic / Below Basic), a retention buffer, four gates (G0–G3), and a pass/fail hazardous-waste
// module. Tier and classification status are deliberately separate outputs — a "Suspended" or
// "Under review" ESP still has an underlying computed tier, it just isn't the published status.

export type Sector = "Transportation" | "Trading" | "Treatment";
export type Category =
  | "Regulatory & Organisational Capability"
  | "Technical Capability"
  | "Environmental & HSE Performance"
  | "Digital Capability";

export type Thresholds = {
  t1: number;
  pts1: number;
  t2: number | null;
  pts2: number | null;
  t3: number | null;
  pts3: number | null;
  belowPts: number;
};

export type Criterion = {
  id: string; // e.g. "R-01"
  sector: Sector;
  category: Category;
  name: string;
  status: "Active" | "Phase 2";
  maxPts: number;
  kpiDefinition: string;
  unit: string;
  scoringRule: string;
  direction: "H" | "L"; // higher-is-better / lower-is-better
  thresholds: Thresholds;
  dataSource: string;
  evidenceRequired: string;
};

export type HazardousModuleItem = {
  id: string; // "H-1".."H-5"
  requirement: string;
  verification: string;
};

export type CriterionEntry = {
  criterionId: string;
  applicable: "Y" | "N/A";
  value: number | null;
  evidenceVerified: "Y" | "N" | null;
};

export type Gates = {
  g0: "Y" | "N"; // valid Authorisation (WML or Environmental Permit) AND active account
  g1: "Y" | "N"; // critical violation or fatality in last 12 months
  g2CurrentlySuspended: "Y" | "N"; // Authorisation is suspended right now — drives the "Suspended" status
  g2CapActive: "Y" | "N"; // suspended now, or suspension lifted within the configured cap window
  g3: "Y" | "N"; // holds a hazardous waste authorisation
};

export type ClassificationParameters = {
  basicMinTotal: number; // 40 (Egis-proposed, pending EAD — Decision D1)
  advancedMinTotal: number; // 60
  premiumMinTotal: number; // 85
  retentionBufferPoints: number; // 3
  suspensionAdvancedCapMonths: number; // 12
  gateCapG1: Tier;
  gateCapG2: Tier;
  gateCapG3: Tier;
  categoryMinimums: Record<Category, { advanced: number; premium: number }>;
};

export type Tier = "Below Basic" | "Basic" | "Advanced" | "Premium";
export type ClassificationStatus = "Not classified" | "Active" | "Under review" | "Suspended" | "Revoked";

const TIER_NUM: Record<Tier, number> = { "Below Basic": 1, Basic: 2, Advanced: 3, Premium: 4 };
const NUM_TIER: Tier[] = ["Below Basic", "Basic", "Advanced", "Premium"]; // 1-based

function scoreCriterion(c: Criterion, entry: CriterionEntry | undefined): number {
  if (c.status !== "Active") return 0;
  if (!entry || entry.applicable === "N/A") return 0;
  if (entry.value === null || entry.value === undefined || entry.evidenceVerified !== "Y") return 0;

  const { t1, pts1, t2, pts2, t3, pts3, belowPts } = c.thresholds;
  const v = entry.value;
  if (c.direction === "H") {
    if (v >= t1) return pts1;
    if (t2 !== null && v >= t2) return pts2 as number;
    if (t3 !== null && v >= t3) return pts3 as number;
    return belowPts;
  }
  if (v <= t1) return pts1;
  if (t2 !== null && v <= t2) return pts2 as number;
  if (t3 !== null && v <= t3) return pts3 as number;
  return belowPts;
}

export type CriterionResultRow = {
  id: string;
  category: Category;
  name: string;
  status: Criterion["status"];
  maxPts: number;
  applicable: "Y" | "N/A" | null;
  value: number | null;
  evidenceVerified: "Y" | "N" | null;
  score: number;
};

export type CategoryResult = {
  category: Category;
  categoryWeight: number; // sum of maxPts of Active criteria (I column)
  categoryScore: number; // J column
  categoryPct: number | null; // K column; null when categoryWeight is 0
  advancedMinimumMet: boolean;
  premiumMinimumMet: boolean;
  rows: CriterionResultRow[];
};

export type ClassificationResult = {
  categories: CategoryResult[];
  total: number;
  advancedMinimumsAllMet: boolean;
  premiumMinimumsAllMet: boolean;
  scoreBasedTier: Tier; // before retention buffer
  tierWithRetention: Tier; // after retention buffer
  retained: boolean;
  gateCapTier: Tier | "No cap";
  finalTier: Tier | null; // null when status is "Not classified" — G0 fail means no tier is computed/published
  status: ClassificationStatus; // gate-derived default; the caller may override to "Under review" / "Revoked"
  reason: string;
  hazardousModuleResult: "N/A" | "PASS" | "FAIL";
};

const CATEGORIES: Category[] = [
  "Regulatory & Organisational Capability",
  "Technical Capability",
  "Environmental & HSE Performance",
  "Digital Capability",
];

export function evaluateHazardousModule(
  gates: Gates,
  items: HazardousModuleItem[],
  answers: Map<string, "Y" | "N">
): "N/A" | "PASS" | "FAIL" {
  if (gates.g3 !== "Y") return "N/A";
  return items.every((item) => answers.get(item.id) === "Y") ? "PASS" : "FAIL";
}

function tierThreshold(tier: Tier, params: ClassificationParameters): number | null {
  if (tier === "Premium") return params.premiumMinTotal;
  if (tier === "Advanced") return params.advancedMinTotal;
  if (tier === "Basic") return params.basicMinTotal;
  return null; // Below Basic has no threshold to retain against
}

export function runClassification(
  criteria: Criterion[],
  entries: Map<string, CriterionEntry>,
  params: ClassificationParameters,
  gates: Gates,
  previousPublishedTier: Tier | "None",
  hazardousModuleResult: "N/A" | "PASS" | "FAIL"
): ClassificationResult {
  const categories: CategoryResult[] = CATEGORIES.map((category) => {
    const activeCriteria = criteria.filter((c) => c.category === category && c.status === "Active");
    const categoryWeight = activeCriteria.reduce((s, c) => s + c.maxPts, 0);

    const applicableMaxPts = activeCriteria.reduce((s, c) => {
      const entry = entries.get(c.id);
      const isNA = entry?.applicable === "N/A";
      return s + (isNA ? 0 : c.maxPts);
    }, 0);

    const rows: CriterionResultRow[] = activeCriteria.map((c) => {
      const entry = entries.get(c.id);
      return {
        id: c.id,
        category: c.category,
        name: c.name,
        status: c.status,
        maxPts: c.maxPts,
        applicable: entry?.applicable ?? null,
        value: entry?.value ?? null,
        evidenceVerified: entry?.evidenceVerified ?? null,
        score: scoreCriterion(c, entry),
      };
    });

    const rawScoreSum = rows.reduce((s, r) => s + r.score, 0);
    const categoryScore = applicableMaxPts === 0 ? 0 : (rawScoreSum / applicableMaxPts) * categoryWeight;
    const categoryPct = categoryWeight === 0 ? null : categoryScore / categoryWeight;

    const minimums = params.categoryMinimums[category];
    const advancedMinimumMet = categoryWeight === 0 || (categoryPct as number) >= minimums.advanced;
    const premiumMinimumMet = categoryWeight === 0 || (categoryPct as number) >= minimums.premium;

    return { category, categoryWeight, categoryScore, categoryPct, advancedMinimumMet, premiumMinimumMet, rows };
  });

  const total = Number(categories.reduce((s, c) => s + c.categoryScore, 0).toFixed(4));
  const advancedMinimumsAllMet = categories.every((c) => c.advancedMinimumMet);
  const premiumMinimumsAllMet = categories.every((c) => c.premiumMinimumMet);

  // Score-based tier: Premium requires total + every category's Premium minimum; Advanced requires
  // total + every category's Advanced minimum; Basic requires only the total (no category minimum
  // defined for Basic); otherwise Below Basic. A category below its minimum falls through to the
  // next check, exactly as Section 8.2 describes ("a category below its minimum gives the next
  // lower tier").
  let scoreBasedTierNum = TIER_NUM["Below Basic"];
  if (total >= params.premiumMinTotal && premiumMinimumsAllMet) scoreBasedTierNum = TIER_NUM.Premium;
  else if (total >= params.advancedMinTotal && advancedMinimumsAllMet) scoreBasedTierNum = TIER_NUM.Advanced;
  else if (total >= params.basicMinTotal) scoreBasedTierNum = TIER_NUM.Basic;

  // Retention buffer: an ESP already holding a tier keeps it if the new total is within the buffer
  // of that tier's own threshold AND (for Premium/Advanced) its category minimums are still met.
  const prevNum = previousPublishedTier === "None" ? 0 : TIER_NUM[previousPublishedTier];
  let tierWithRetentionNum = scoreBasedTierNum;
  if (prevNum > scoreBasedTierNum) {
    const prevTier = NUM_TIER[prevNum - 1];
    const threshold = tierThreshold(prevTier, params);
    const minimumsMet = prevTier === "Premium" ? premiumMinimumsAllMet : prevTier === "Advanced" ? advancedMinimumsAllMet : true;
    if (threshold !== null && total >= threshold - params.retentionBufferPoints && minimumsMet) {
      tierWithRetentionNum = prevNum;
    }
  }

  const topNum = TIER_NUM.Premium;
  const g1Cap = gates.g1 === "Y" ? TIER_NUM[params.gateCapG1] : topNum;
  const g2Cap = gates.g2CapActive === "Y" ? TIER_NUM[params.gateCapG2] : topNum;
  const g3Cap = gates.g3 === "Y" && hazardousModuleResult === "FAIL" ? TIER_NUM[params.gateCapG3] : topNum;
  const gateCapNum = Math.min(topNum, g1Cap, g2Cap, g3Cap);

  const scoreBasedTier = NUM_TIER[scoreBasedTierNum - 1];
  const tierWithRetention = NUM_TIER[tierWithRetentionNum - 1];
  const gateCapTier: Tier | "No cap" = gateCapNum === topNum ? "No cap" : NUM_TIER[gateCapNum - 1];

  let finalTier: Tier | null;
  let status: ClassificationStatus;
  let reason: string;

  if (gates.g0 !== "Y") {
    finalTier = null;
    status = "Not classified";
    reason = "Gate G0 not met (no valid Authorisation, or an inactive account) – not classified";
  } else {
    const finalNum = Math.min(tierWithRetentionNum, gateCapNum);
    finalTier = NUM_TIER[finalNum - 1];
    status = gates.g2CurrentlySuspended === "Y" ? "Suspended" : "Active";

    if (gateCapNum < tierWithRetentionNum) {
      const capReasons: string[] = [];
      if (gates.g1 === "Y") capReasons.push("G1 critical violation/fatality; ");
      if (gates.g2CapActive === "Y") capReasons.push(gates.g2CurrentlySuspended === "Y" ? "G2 Authorisation currently suspended; " : "G2 suspended within the last 12 months; ");
      if (gates.g3 === "Y" && hazardousModuleResult === "FAIL") capReasons.push("G3 hazardous module not passed");
      reason = `Capped by gate: ${capReasons.join("")}`;
    } else if (tierWithRetentionNum > scoreBasedTierNum) {
      reason = `Existing tier retained within ${params.retentionBufferPoints}-point buffer – improvement needed to secure it next cycle`;
    } else if (tierWithRetentionNum === TIER_NUM.Premium) {
      reason = "Premium: score and all category minimums met";
    } else if (total >= params.premiumMinTotal) {
      reason = "Score ≥ Premium threshold but a category is below its Premium minimum";
    } else if (tierWithRetentionNum === TIER_NUM.Advanced) {
      reason = "Advanced: score-based";
    } else if (total >= params.advancedMinTotal) {
      reason = "Score ≥ Advanced threshold but a category is below its Advanced minimum";
    } else if (tierWithRetentionNum === TIER_NUM.Basic) {
      reason = `Basic: score-based (≥ ${params.basicMinTotal}-point Basic minimum)`;
    } else {
      reason = `Below Basic: score below the ${params.basicMinTotal}-point Basic minimum`;
    }
  }

  return {
    categories,
    total,
    advancedMinimumsAllMet,
    premiumMinimumsAllMet,
    scoreBasedTier,
    tierWithRetention,
    retained: tierWithRetentionNum > scoreBasedTierNum,
    gateCapTier,
    finalTier,
    status,
    reason,
    hazardousModuleResult,
  };
}
