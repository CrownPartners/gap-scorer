// pages/api/gap-score.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // ----- CORS -----
    const ORIGIN = (req.headers.origin as string) || "";
    const ALLOW_LIST = new Set([
      "https://www.crownpartners.co.uk",
      "https://crown-partners-ltd.webflow.io",
    ]);
    const ACAO = ALLOW_LIST.has(ORIGIN) ? ORIGIN : "https://www.crownpartners.co.uk";

    res.setHeader("Access-Control-Allow-Origin", ACAO);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      // be generous here to avoid preflight blocks
      "Content-Type, Authorization, X-Requested-With, Accept, x-key"
    );
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    // ----- Early method & auth checks -----
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    if (req.headers["x-key"] !== process.env.WF_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
    const { website, answers = {} } = (req.body as any) || {};

    // ---------------- Compliance RAG ----------------
    const mandatory = [
      "insolvency_clear", "tax_clear", "no_convictions", "has_insurance",
      "dp_ukgdpr", "h_and_s", "modern_slavery", "anti_bribery", "bcp_dr", "edi", "whistleblowing",
    ];

    const expected = [
      "iso_9001","iso_14001","iso_27001","iso_20000_or_itil","ce_plus_or_equiv","staff_clearance",
      "sustainability_policy","supplier_mgmt",
      "sv_reporting",
      "crp_ppn","scope12_reporting","carbon_targets","iso_50001","carbon_trust","sbti",
      "ps_experience","case_studies","financial_stability",
      "registered_portals","bid_process","framework_awards",
    ];

    const socialValue = ["sv_employment","sv_community","sv_smes","sv_environment"];

    const rag = { red: 0, amber: 0, green: 0 };
    const missingMandatory: string[] = [];
    const missingExpected: string[] = [];
    const present: string[] = [];

    for (const k of mandatory) {
      if ((answers as any)[k]) { rag.green++; present.push(k); }
      else { rag.red++; missingMandatory.push(k); }
    }
    for (const k of expected) {
      if ((answers as any)[k]) { rag.green++; present.push(k); }
      else { rag.amber++; missingExpected.push(k); }
    }
    for (const k of socialValue) {
      if ((answers as any)[k]) rag.green++;
    }

    // ---------------- Website perception ----------------
    let perceptionPct = 45;
    const site: { present: string[]; missing: string[] } = { present: [], missing: [] };

    if (website && /^https?:\/\//i.test(website)) {
      try {
        const r = await fetch(website as string, {
          redirect: "follow",
          headers: { "user-agent": "Mozilla/5.0 GapScoreBot" },
        });
        const html = (await r.text()).toLowerCase();

        const check = (label: string, fn: (h: string) => boolean) => {
          if (fn(html)) site.present.push(label); else site.missing.push(label);
        };

        if ((website as string).startsWith("https://")) { perceptionPct += 6; site.present.push("HTTPS"); }
        else site.missing.push("HTTPS");

        check("Privacy", h => h.includes("privacy"));
        check("Cookies", h => h.includes("cookie"));
        check("Accessibility", h => h.includes("accessibility"));
        check("Company details", h => h.includes("company number") || h.includes("registered in"));
        check("Social proof", h => h.includes("case stud") || h.includes("testimonial") || h.includes("trustpilot") || h.includes("google reviews"));
        check("Modern Slavery link", h => h.includes("modern slavery"));
        check("Cyber Essentials badge", h => h.includes("cyber essentials"));
      } catch {
        site.missing.push("Fetched HTML");
        perceptionPct = 40;
      }
    }
    perceptionPct = clamp(perceptionPct);

    // ---------------- Issue-based RAG + Scoring ----------------
    const ISSUE_LABEL = (k: string) => ({
      insolvency_clear: "Company not insolvent",
      tax_clear: "Up to date with UK tax",
      no_convictions: "No disqualifying convictions",
      has_insurance: "Insurance cover (PLI/PI/EL)",
      dp_ukgdpr: "Data Protection / UK GDPR policy",
      h_and_s: "Health & Safety policy",
      modern_slavery: "Modern Slavery statement",
      anti_bribery: "Anti-bribery & corruption policy",
      bcp_dr: "Business Continuity / Disaster Recovery plan",
      edi: "Equality, Diversity & Inclusion policy",
      whistleblowing: "Whistleblowing policy",

      iso_27001: "ISO 27001",
      ce_plus_or_equiv: "Cyber Essentials Plus (or equivalent)",
      staff_clearance: "Staff security clearances (BPSS/SC/DV)",
      iso_9001: "ISO 9001",
      iso_14001: "ISO 14001",
      iso_20000_or_itil: "ISO 20000-1 / ITIL",
      ps_experience: "Public sector delivery experience",
      case_studies: "Case studies / references",
      financial_stability: "Financial stability & scalability",
      registered_portals: "Registered on sourcing portals",
      bid_process: "Bid/tender management process",
      framework_awards: "Framework awards history",
      crp_ppn: "Carbon Reduction Plan (PPN-aligned)",
      scope12_reporting: "Scope 1 & 2 reporting",
      carbon_targets: "Carbon reduction targets",

      sustainability_policy: "Sustainability/Environmental policy",
      supplier_mgmt: "Supplier & subcontractor management policy",
      sv_reporting: "Social value reporting capability",
    } as Record<string,string>)[k] || k;

    const issues: { key: string; label: string; severity: "red"|"amber"|"green" }[] = [];

    for (const k of (missingMandatory || [])) {
      issues.push({ key: k, label: ISSUE_LABEL(k), severity: "red" });
    }
    for (const k of (missingExpected || [])) {
      if (Object.prototype.hasOwnProperty.call(answers || {}, k)) {
        issues.push({ key: k, label: ISSUE_LABEL(k), severity: "amber" });
      }
    }
    (site?.missing || []).forEach(labelText => {
      const sev: "amber"|"green" = (labelText === "Accessibility" || labelText.startsWith("Cyber Essentials")) ? "amber" : "green";
      const key = `web_${labelText.toLowerCase().replace(/\s+/g, "_")}`;
      issues.push({ key, label: labelText, severity: sev });
    });

    const ragIssues = issues.reduce(
      (acc, it) => { acc[it.severity]++; return acc; },
      { red: 0, amber: 0, green: 0 }
    );

    const penalty = ragIssues.red * 20 + ragIssues.amber * 8 + ragIssues.green * 2;
    const compliancePct = clamp(100 - penalty);

    const overallPct = Math.round(0.60 * compliancePct + 0.40 * perceptionPct);

    const bandLabel =
      overallPct >= 80 ? "Public-sector ready (indicative)" :
      overallPct >= 60 ? "Nearly there — a few gaps" :
      overallPct >= 40 ? "Emerging — quick wins available" :
                         "Early stage — start with foundations";

    const bullets = buildBullets(
      issues.filter(i => i.severity === "red").map(i => i.key),
      issues.filter(i => i.severity === "amber").map(i => i.key),
      site?.missing || []
    ).slice(0, 3);

    return res.status(200).json({
      overallPct,
      bandLabel,
      bullets,
      rag: ragIssues,
      issues,
      websiteFindings: site,
      nextStepUrl: "https://www.crownpartners.co.uk/contact",
    });
  } catch (e: any) {
    console.error("gap-score error:", e);
    return res.status(500).json({ error: "server_error", message: e?.message });
  }
}

// ---- helpers ----
function buildBullets(mandMiss: string[], expMiss: string[], siteMiss: string[]) {
  const out: string[] = [];
  if (mandMiss.includes("has_insurance"))
    out.push("Provide valid PLI (£5m), PI (£1–5m), and EL (£10m) insurance certificates.");
  if (mandMiss.includes("dp_ukgdpr"))
    out.push("Publish UK GDPR/Data Protection policy with contact/DPO.");
  if (mandMiss.includes("bcp_dr"))
    out.push("Create a simple Business Continuity & Disaster Recovery plan.");
  if (mandMiss.includes("modern_slavery"))
    out.push("Publish a Modern Slavery statement and link it in the footer.");
  if (mandMiss.includes("whistleblowing"))
    out.push("Publish a whistleblowing policy and reporting route.");

  if (expMiss.includes("iso_27001") && expMiss.includes("ce_plus_or_equiv"))
    out.push("Strengthen information security assurance (CE+ or ISO 27001).");
  if (expMiss.includes("case_studies"))
    out.push("Add outcome-led case studies or references relevant to the public sector.");
  if (expMiss.includes("registered_portals"))
    out.push("Register on Contracts Finder and relevant eSourcing portals.");
  if (expMiss.includes("crp_ppn"))
    out.push("Publish a Carbon Reduction Plan aligned to UK PPN requirements.");

  if (siteMiss.includes("Social proof"))
    out.push("Link to testimonials or reviews to build trust.");
  if (siteMiss.includes("Company details"))
    out.push("Show registered company information in the footer.");

  if (!out.length && siteMiss.length)
    out.push("Improve footer hygiene (privacy, cookies, accessibility).");
  if (!out.length)
    out.push("Solid baseline — consider CE+/ISO signals and case studies.");

  return out;
}
