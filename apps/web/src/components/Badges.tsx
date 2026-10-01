const TIER_COLORS: Record<string, string> = {
  Premium: "bg-emerald-100 text-emerald-800",
  Advanced: "bg-sky-100 text-sky-800",
  Basic: "bg-amber-100 text-amber-800",
  "NOT ELIGIBLE": "bg-rose-100 text-rose-800",
};

export function TierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return <span className="badge bg-slate-100 text-slate-500">Unclassified</span>;
  return <span className={`badge ${TIER_COLORS[tier] ?? "bg-slate-100 text-slate-700"}`}>{tier}</span>;
}

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-slate-100 text-slate-700",
  under_review: "bg-sky-100 text-sky-800",
  eligibility_failed: "bg-rose-100 text-rose-800",
  scoring: "bg-violet-100 text-violet-800",
  decided: "bg-emerald-100 text-emerald-800",
  voided: "bg-rose-100 text-rose-800",
  active: "bg-emerald-100 text-emerald-800",
  suspended: "bg-rose-100 text-rose-800",
  expired: "bg-amber-100 text-amber-800",
  revoked: "bg-rose-100 text-rose-800",
  draft: "bg-slate-100 text-slate-700",
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-sky-100 text-sky-800",
  published: "bg-emerald-100 text-emerald-800",
  superseded: "bg-slate-100 text-slate-500",
  rejected: "bg-rose-100 text-rose-800",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_COLORS[status] ?? "bg-slate-100 text-slate-700"}`}>{status.replace(/_/g, " ")}</span>;
}
