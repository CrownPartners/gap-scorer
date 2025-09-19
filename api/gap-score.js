// /api/gap-score.js  — Compliance + Website Perception only (no carbon maths)

function allowOrigin(origin) {
  if (!origin) return null;
  try {
    const { hostname, protocol } = new URL(origin);
    const isHttps = protocol === "https:";
    const endsWith = (h, s) => h === s || h.endsWith("." + s);
    return (isHttps && (endsWith(hostname, "crownpartners.co.uk") || endsWith(hostname, "webflow.io"))) ? origin : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  // CORS
  const allow = allowOrigin(req.headers.origin);
  if (allow) { res.setHeader("Access-Control-Allow-Origin", allow); res.setHeader("Vary","Origin"); }
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, x-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") return res.status(405).end();
    if (req.headers["x-key"] !== process.env.WF_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
    const { website, answers = {} } = req.body || {};

    // ---------------- Compliance RAG (UPDATE THESE LISTS ANYTIME) ----------------
    // 🔴 Mandatory: unchecked = Red
    const mandatory = [
      // 1) Legal & Financial
      "insolvency_clear", "tax_clear", "no_convictions", "has_insurance",
      // 3) Policies & Procedures (mandatory subset)
      "dp_ukgdpr", "h_and_s", "modern_slavery", "anti_bribery", "bcp_dr", "edi", "whistleblowing"
    ];

    // 🟠 Expected: unchecked = Amber
    const expected = [
      // 2) Certifications & Security
      "iso_9001","iso_14001","iso_27001","iso_20000_or_itil","ce_plus_or_equiv","staff_clearance",
      // 3) Policies & Procedures (expected subset)
      "sustainability_policy","supplier_mgmt",
      // 4) Social value
      "sv_reporting",
      // 5) Carbon/Sustainability (checkboxes only)
      "crp_ppn","scope12_reporting","carbon_targets","iso_50001","carbon_trust","sbti",
      // 6) Commercial & Delivery
      "ps_experience","case_studies","financial_stability",
      // 7) Framework Engagement
      "registered_portals","bid_process","framework_awards"
    ];

    // Bonus greens (no penalty if missing) — Social value themes
    const socialValue = ["sv_employment","sv_community","sv_smes","sv_environment"];

    const rag = { red: 0, amber: 0, green: 0 };
    const missingMandatory = [];
    const missingExpected = [];
    const present = [];

    for (const k of mandatory) {
      if (answers[k]) { rag.green++; present.push(k); }
      else { rag.red++; missingMandatory.push(k); }
    }
    for (const k of expected) {
      if (answers[k]) { rag.green++; present.push(k); }
      else { rag.amber++; missingExpected.push(k); }
    }
    for (const k of socialValue) {
      if (answers[k]) rag.green++; // no penalty if false
    }

    // ---------------- Website perception (very lightweight) ----------------
    let perceptionPct = 45;
    const site = { present: [], missing: [] };

    if (website && /^https?:\/\//i.test(website)) {
      try {
        const r = await fetch(website, {
          redirect: "follow",
          headers: { "user-agent": "Mozilla/5.0 GapScoreBot" }
        });
        const html = (await r.text()).toLowerCase();

        const check = (label, fn) => { if (fn(html)) site.present.push(label); else site.missing.push(label); };

        if (website.startsWith("https://")) { perceptionPct += 6; site.present.push("HTTPS"); } else site.missing.push("HTTPS");
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

    // ---------------- Issue-based RAG + Scoring (replace the old scoring block with this) ----------------

// Map internal keys to friendly labels (used in bullets / issues list)
const ISSUE_LABEL = (k => ({
  // Mandatory → RED if missing
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

  // Expected → AMBER if missing (only if that key is present in the form submission)
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

  // Minor (best-practice) → GREEN if missing (only if present in submission)
  sustainability_policy: "Sustainability/Environmental policy",
  supplier_mgmt: "Supplier & subcontractor management policy",
  sv_reporting: "Social value reporting capability"
}))[k] || k);

// Build an issues list from missing answers + website misses
const issues = [];  // { key, label, severity }

// Mandatory → RED (use your existing missingMandatory array)
for (const k of (missingMandatory || [])) {
  issues.push({ key: k, label: ISSUE_LABEL(k), severity: "red" });
}

// Expected → AMBER, but only penalise keys your form actually sent
for (const k of (missingExpected || [])) {
  if (Object.prototype.hasOwnProperty.call(answers || {}, k)) {
    issues.push({ key: k, label: ISSUE_LABEL(k), severity: "amber" });
  }
}

// Website perception misses → fold into issues
// By default, Accessibility & CE are AMBER; others are GREEN (minor)
(site?.missing || []).forEach(labelText => {
  const sev = (labelText === "Accessibility" || labelText.startsWith("Cyber Essentials"))
    ? "amber" : "green";
  const key = `web_${labelText.toLowerCase().replace(/\s+/g, "_")}`;
  issues.push({ key, label: labelText, severity: sev });
});

// RAG counts from issues ONLY (we ignore things done correctly)
const ragIssues = issues.reduce((acc, it) => {
  acc[it.severity]++; return acc;
}, { red: 0, amber: 0, green: 0 });

// Severity penalties → compliance %
const penalty = ragIssues.red * 20 + ragIssues.amber * 8 + ragIssues.green * 2; // tune if you like
const compliancePct = clamp(100 - penalty);

// Overall score blends compliance & perception
const overallPct = Math.round(0.60 * compliancePct + 0.40 * perceptionPct);

// Band label
const bandLabel =
  overallPct >= 80 ? "Public-sector ready (indicative)" :
  overallPct >= 60 ? "Nearly there — a few gaps" :
  overallPct >= 40 ? "Emerging — quick wins available" :
                     "Early stage — start with foundations";

// Top actions: feed RED/AMBER (most serious first) and site misses into your helper
const bullets = buildBullets(
  issues.filter(i => i.severity === "red").map(i => i.key),
  issues.filter(i => i.severity === "amber").map(i => i.key),
  site?.missing || []
).slice(0, 3);

// Respond
return res.json({
  overallPct,
  bandLabel,
  bullets,
  rag: ragIssues,              // <- R/A/G now counts ONLY issues (greens = minor issues)
  issues,                      // <- full list with severities (handy for future UI)
  websiteFindings: site,
  nextStepUrl: "https://www.crownpartners.co.uk/contact"
});


function buildBullets(mandMiss, expMiss, siteMiss) {
  const out = [];
  // Mandatory
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

  // Expected
  if (expMiss.includes("iso_27001") && expMiss.includes("ce_plus_or_equiv"))
    out.push("Strengthen information security assurance (CE+ or ISO 27001).");
  if (expMiss.includes("case_studies"))
    out.push("Add outcome-led case studies or references relevant to the public sector.");
  if (expMiss.includes("registered_portals"))
    out.push("Register on Contracts Finder and relevant eSourcing portals.");
  if (expMiss.includes("crp_ppn"))
    out.push("Publish a Carbon Reduction Plan aligned to UK PPN requirements.");

  // Website
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
