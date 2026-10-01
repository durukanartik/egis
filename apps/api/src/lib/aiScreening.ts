// H1 (MVP) AI-enabled functionality per Section 12: deterministic rule-based document completeness
// screening. This is advisory only — it flags findings for the human reviewer, it never decides.

export type DocRow = {
  doc_type: string;
  expiry_date: string | null;
  status: string;
};

const REQUIRED_DOCS_BY_SECTOR: Record<string, string[]> = {
  Transportation: ["Vehicle Registration Schedule", "Insurance Certificate", "Waste Carrier Permit"],
  Treatment: ["Facility Operating Permit", "Environmental Compliance Certificate", "Insurance Certificate"],
  Trading: ["Trade Licence Copy", "Insurance Certificate"],
};

export type ScreeningFinding = {
  severity: "info" | "warning" | "blocker";
  doc_type: string;
  issue: string;
};

export function runDocumentScreening(sector: string, docs: DocRow[]): { passed: boolean; findings: ScreeningFinding[] } {
  const required = REQUIRED_DOCS_BY_SECTOR[sector] ?? [];
  const findings: ScreeningFinding[] = [];
  const presentTypes = new Set(docs.map((d) => d.doc_type));

  for (const req of required) {
    if (!presentTypes.has(req)) {
      findings.push({ severity: "blocker", doc_type: req, issue: "Mandatory document missing from the application package." });
    }
  }

  const today = new Date();
  for (const d of docs) {
    if (!d.expiry_date) continue;
    const expiry = new Date(d.expiry_date);
    if (expiry < today) {
      findings.push({ severity: "blocker", doc_type: d.doc_type, issue: `Document expired on ${d.expiry_date}; re-upload required via TAMM.` });
    } else if (expiry.getTime() - today.getTime() < 30 * 86400000) {
      findings.push({ severity: "warning", doc_type: d.doc_type, issue: `Document expires within 30 days (${d.expiry_date}).` });
    }
  }

  const passed = !findings.some((f) => f.severity === "blocker");
  return { passed, findings };
}
