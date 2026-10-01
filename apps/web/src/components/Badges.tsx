const TIER_COLORS: Record<string, string> = {
  Premium: "bg-brand-green-50 text-brand-green-800 ring-1 ring-inset ring-brand-green-100",
  Advanced: "bg-brand-blue-50 text-brand-blue-800 ring-1 ring-inset ring-brand-blue-100",
  Basic: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-100",
  "NOT ELIGIBLE": "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100",
};

export function TierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return <span className="badge bg-brand-grey-50 text-brand-grey-600">Unclassified</span>;
  return <span className={`badge ${TIER_COLORS[tier] ?? "bg-brand-grey-50 text-brand-grey-700"}`}>{tier}</span>;
}

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-brand-grey-50 text-brand-grey-700",
  under_review: "bg-brand-blue-50 text-brand-blue-800",
  eligibility_failed: "bg-rose-50 text-rose-700",
  scoring: "bg-violet-50 text-violet-700",
  decided: "bg-brand-green-50 text-brand-green-800",
  voided: "bg-rose-50 text-rose-700",
  active: "bg-brand-green-50 text-brand-green-800",
  suspended: "bg-rose-50 text-rose-700",
  expired: "bg-amber-50 text-amber-800",
  revoked: "bg-rose-50 text-rose-700",
  draft: "bg-brand-grey-50 text-brand-grey-700",
  pending_approval: "bg-amber-50 text-amber-800",
  approved: "bg-brand-blue-50 text-brand-blue-800",
  published: "bg-brand-green-50 text-brand-green-800",
  superseded: "bg-brand-grey-50 text-brand-grey-500",
  rejected: "bg-rose-50 text-rose-700",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_COLORS[status] ?? "bg-brand-grey-50 text-brand-grey-700"}`}>{status.replace(/_/g, " ")}</span>;
}
