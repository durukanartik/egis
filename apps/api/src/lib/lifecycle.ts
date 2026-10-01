// Lifecycle governance per Section 8.1 of the System Architecture Document:
// licence-status gating, suspension cascade, classification validity, 6-month upgrade cycle,
// and the 30-day post-decision review window.

import { db, recordAudit } from "../db.js";
import type { LifecycleRules } from "./scoring.js";

export type EspRow = {
  id: string;
  legal_name: string;
  sector: string;
  licence_status: "active" | "suspended" | "expired" | "revoked";
  licence_expiry_date: string;
  classification_valid_until: string | null;
  current_tier: string | null;
  last_classification_at: string | null;
  last_upgrade_request_at: string | null;
};

export function licenceIsUsable(esp: EspRow): { ok: boolean; reason?: string } {
  if (esp.licence_status === "suspended") return { ok: false, reason: "Waste Management Licence is suspended" };
  if (esp.licence_status === "revoked") return { ok: false, reason: "Waste Management Licence is revoked" };
  if (esp.licence_status === "expired") return { ok: false, reason: "Waste Management Licence is expired" };
  if (new Date(esp.licence_expiry_date) < new Date()) return { ok: false, reason: "Waste Management Licence has passed its expiry date" };
  return { ok: true };
}

/**
 * Suspension cascade (Section 8.1): if the underlying licence is suspended or revoked, the ESP's
 * classification is immediately and automatically voided. Run this on every read path that surfaces
 * an ESP's classification so the voiding is systematic rather than an ad-hoc request.
 */
export function applySuspensionCascade(espId: string) {
  const esp = db.prepare("SELECT * FROM esps WHERE id = ?").get(espId) as EspRow | undefined;
  if (!esp) return;
  const needsVoid =
    (esp.licence_status === "suspended" || esp.licence_status === "revoked") &&
    (esp.current_tier !== null || esp.classification_valid_until !== null);
  if (!needsVoid) return;

  db.prepare(
    `UPDATE esps SET current_tier = NULL, classification_valid_until = NULL WHERE id = ?`
  ).run(espId);

  recordAudit({
    actorUsername: "system-lifecycle-engine",
    actorRole: "admin",
    action: "esp.classification_voided_suspension_cascade",
    entityType: "esp",
    entityId: espId,
    before: { current_tier: esp.current_tier, classification_valid_until: esp.classification_valid_until },
    after: { current_tier: null, classification_valid_until: null, reason: `licence status is ${esp.licence_status}` },
  });
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
