// Scoring & Classification engine — implements the EAD "ESP Classification & Rating System –
// Scoring Calculator" (R02, 30 Sept 2026) exactly: four weighted categories on a 100-point scale,
// differentiated category minimums (non-compensation), Basic/Advanced/Premium tiers, a retention
// buffer against year-to-year flipping, three operational gates plus the eligibility gate, and a
// pass/fail hazardous-waste module. This supersedes the simplified placeholder scoring model from
// the MVP's first iteration.

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
  g0: "Y" | "N"; // valid EAD permit AND active account
  g1: "Y" | "N"; // critical violation or fatality in last 12 months
  g2: "Y" | "N"; // permit/account suspension in last 12 months
  g3: "Y" | "N"; // holds a hazardous waste permit
};

export type ClassificationParameters = {
  advancedMinTotal: number; // 60
  premiumMinTotal: number; // 85
  retentionBufferPoints: number; // 3
  gateCapG1: "Basic" | "Advanced" | "Premium";
  gateCapG2: "Basic" | "Advanced" | "Premium";
  gateCapG3: "Basic" | "Advanced" | "Premium";
  categoryMinimums: Record<Category, { advanced: number; premium: number }>;
};

export type Tier = "Basic" | "Advanced" | "Premium";
const TIER_NUM: Record<Tier, number> = { Basic: 1, Advanced: 2, Premium: 3 };
const NUM_TIER: Tier[] = ["Basic", "Advanced", "Premium"]; // index 0 unused, 1-based

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
  scoreBasedTier: Tier; // M13, before retention buffer
  tierWithRetention: Tier; // O13, after retention buffer
  retained: boolean; // O13 > M13
  gateCapTier: Tier | "No cap";
  finalClassification: Tier | "NOT ELIGIBLE";
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

  let scoreBasedTierNum = 1;
  if (total >= params.premiumMinTotal && premiumMinimumsAllMet) scoreBasedTierNum = 3;
  else if (total >= params.advancedMinTotal && advancedMinimumsAllMet) scoreBasedTierNum = 2;

  const prevNum = previousPublishedTier === "None" ? 0 : TIER_NUM[previousPublishedTier];
  let tierWithRetentionNum = scoreBasedTierNum;
  if (
    prevNum === 3 &&
    scoreBasedTierNum < 3 &&
    total >= params.premiumMinTotal - params.retentionBufferPoints &&
    premiumMinimumsAllMet
  ) {
    tierWithRetentionNum = 3;
  } else if (
    prevNum >= 2 &&
    scoreBasedTierNum < 2 &&
    total >= params.advancedMinTotal - params.retentionBufferPoints &&
    advancedMinimumsAllMet
  ) {
    tierWithRetentionNum = 2;
  }

  const g1Cap = gates.g1 === "Y" ? TIER_NUM[params.gateCapG1] : 3;
  const g2Cap = gates.g2 === "Y" ? TIER_NUM[params.gateCapG2] : 3;
  const g3Cap = gates.g3 === "Y" && hazardousModuleResult === "FAIL" ? TIER_NUM[params.gateCapG3] : 3;
  const gateCapNum = Math.min(3, g1Cap, g2Cap, g3Cap);

  const scoreBasedTier = NUM_TIER[scoreBasedTierNum - 1];
  const tierWithRetention = NUM_TIER[tierWithRetentionNum - 1];
  const gateCapTier: Tier | "No cap" = gateCapNum === 3 ? "No cap" : NUM_TIER[gateCapNum - 1];

  let finalClassification: Tier | "NOT ELIGIBLE";
  let reason: string;

  if (gates.g0 !== "Y") {
    finalClassification = "NOT ELIGIBLE";
    reason = "Eligibility gate G0 not met – not classified";
  } else {
    const finalNum = Math.min(tierWithRetentionNum, gateCapNum);
    finalClassification = NUM_TIER[finalNum - 1];

    if (gateCapNum < tierWithRetentionNum) {
      const capReasons: string[] = [];
      if (gates.g1 === "Y") capReasons.push("G1 critical violation/fatality; ");
      if (gates.g2 === "Y") capReasons.push("G2 suspension in last 12 months; ");
      if (gates.g3 === "Y" && hazardousModuleResult === "FAIL") capReasons.push("G3 hazardous module not passed");
      reason = `Capped by gate: ${capReasons.join("")}`;
    } else if (tierWithRetentionNum > scoreBasedTierNum) {
      reason = `Existing tier retained within ${params.retentionBufferPoints}-point buffer – improvement needed to secure it next cycle`;
    } else if (tierWithRetentionNum === 3) {
      reason = "Premium: score and all category minimums met";
    } else if (total >= params.premiumMinTotal) {
      reason = "Score ≥ Premium threshold but a category is below its Premium minimum";
    } else if (tierWithRetentionNum === 1 && total >= params.advancedMinTotal) {
      reason = "Score ≥ Advanced threshold but a category is below its Advanced minimum";
    } else if (tierWithRetentionNum === 2) {
      reason = "Advanced: score-based";
    } else {
      reason = "Basic: score below Advanced threshold";
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
    finalClassification,
    reason,
    hazardousModuleResult,
  };
}
