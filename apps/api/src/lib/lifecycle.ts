// Lifecycle governance per Section 8.1 of the System Architecture Document:
// licence-status gating, suspension cascade, classification validity, 6-month upgrade cycle,
// and the 30-day post-decision review window.

import { db, recordAudit } from "../db.js";

export type LifecycleRules = {
  licence_status_gating: boolean;
  suspension_cascade: boolean;
  classification_validity_months: number;
  upgrade_cycle_months: number;
  review_window_days: number;
  gps_scope: string;
};

export type EspRow = {
  id: string;
  legal_name: string;
  sector: string;
  licence_status: "pending" | "active" | "suspended" | "expired" | "revoked";
  licence_expiry_date: string | null;
  classification_valid_until: string | null;
  current_tier: string | null;
  previous_published_tier: string | null;
  classification_status: "Not classified" | "Active" | "Under review" | "Suspended" | "Revoked";
  last_classification_at: string | null;
  last_upgrade_request_at: string | null;
};

// Gate G0 (Section 8.2): "a valid authorisation ... and an active account". A suspended licence is
// still a valid authorisation — it is gate G2, not G0, that caps the tier and shows the classification
// as Suspended while the suspension lasts (Section 8.1). Only a revoked or expired licence fails G0.
export function licenceIsUsable(esp: EspRow): { ok: boolean; reason?: string } {
  if (esp.licence_status === "pending") return { ok: false, reason: "No Authorisation (WML / Environmental Permit) has been issued yet — PQ is pending" };
  if (esp.licence_status === "revoked") return { ok: false, reason: "Waste Management Licence / Environmental Permit is revoked" };
  if (esp.licence_status === "expired") return { ok: false, reason: "Waste Management Licence / Environmental Permit is expired" };
  if (esp.licence_expiry_date && new Date(esp.licence_expiry_date) < new Date()) {
    return { ok: false, reason: "Waste Management Licence / Environmental Permit has passed its expiry date" };
  }
  return { ok: true };
}

/**
 * Suspension cascade (Section 8.1/8.2, gate G2): while the WML or Environmental Permit is suspended,
 * the classification shows Suspended but the underlying tier is retained (not voided) — only gate G0
 * (no valid authorisation, e.g. a revoked licence) clears the tier entirely to Not classified. Run
 * this on every read path that surfaces an ESP's classification so the status stays in sync with the
 * licence rather than requiring an ad-hoc request.
 */
export function applySuspensionCascade(espId: string) {
  const esp = db.prepare("SELECT * FROM esps WHERE id = ?").get(espId) as EspRow | undefined;
  if (!esp) return;

  if (esp.licence_status === "revoked" && (esp.current_tier !== null || esp.classification_status !== "Not classified")) {
    db.prepare(
      `UPDATE esps SET current_tier = NULL, classification_valid_until = NULL, classification_status = 'Not classified' WHERE id = ?`
    ).run(espId);
    recordAudit({
      actorUsername: "system-lifecycle-engine",
      actorRole: "admin",
      action: "esp.classification_voided_gate_g0",
      entityType: "esp",
      entityId: espId,
      before: { current_tier: esp.current_tier, classification_status: esp.classification_status },
      after: { current_tier: null, classification_status: "Not classified", reason: "licence status is revoked (gate G0 unmet)" },
    });
    return;
  }

  if (esp.licence_status === "suspended" && esp.classification_status !== "Suspended" && esp.current_tier !== null) {
    db.prepare(`UPDATE esps SET classification_status = 'Suspended' WHERE id = ?`).run(espId);
    recordAudit({
      actorUsername: "system-lifecycle-engine",
      actorRole: "admin",
      action: "esp.classification_suspended_gate_g2",
      entityType: "esp",
      entityId: espId,
      before: { classification_status: esp.classification_status },
      after: { classification_status: "Suspended", reason: "licence is suspended (gate G2 caps the tier at Advanced)" },
    });
    return;
  }

  if (esp.licence_status === "active" && esp.classification_status === "Suspended") {
    db.prepare(`UPDATE esps SET classification_status = 'Active' WHERE id = ?`).run(espId);
    recordAudit({
      actorUsername: "system-lifecycle-engine",
      actorRole: "admin",
      action: "esp.classification_reactivated",
      entityType: "esp",
      entityId: espId,
      before: { classification_status: "Suspended" },
      after: { classification_status: "Active", reason: "suspension lifted" },
    });
  }
}

export function classificationIsValid(esp: EspRow): boolean {
  if (!esp.classification_valid_until) return false;
  return new Date(esp.classification_valid_until) >= new Date();
}

export function upgradeEligibility(
  esp: EspRow,
  rules: LifecycleRules
): { eligible: boolean; reason?: string; nextEligibleDate?: string } {
  const licence = licenceIsUsable(esp);
  if (!licence.ok) return { eligible: false, reason: licence.reason };

  const anchor = esp.last_classification_at ?? esp.last_upgrade_request_at;
  if (!anchor) return { eligible: true };

  const anchorDate = new Date(anchor);
  const nextEligible = new Date(anchorDate);
  nextEligible.setMonth(nextEligible.getMonth() + rules.upgrade_cycle_months);

  if (new Date() < nextEligible) {
    return {
      eligible: false,
      reason: `Re-evaluation is restricted to the systematic ${rules.upgrade_cycle_months}-month cycle (Section 8.1, Rule C5); not due until ${nextEligible.toISOString().slice(0, 10)}`,
      nextEligibleDate: nextEligible.toISOString().slice(0, 10),
    };
  }
  return { eligible: true };
}

export function isWithinReviewWindow(decidedAt: string, rules: LifecycleRules): boolean {
  const decided = new Date(decidedAt);
  const windowEnd = new Date(decided.getTime() + rules.review_window_days * 86400000);
  return new Date() <= windowEnd;
}
