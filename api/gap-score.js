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

 // ---------------- Severity model ----------------
// Red  = very serious (must-have to bid)
// Amber = important (likely needed to win/be credible)
// Green = minor fixables / hygiene

const MANDATORY_RED = [
  "insolvency_clear","tax_clear","no_convictions","has_insurance",
  "dp_ukgdpr","h_and_s","modern_slavery","anti_bribery","bcp_dr","edi","whistleblowing"
];

// Expected that affect assurance/eligibility -> AMBER
const EXPECTED_AMBER = [
  "iso_27001","ce_plus_or_equiv","staff_clearance",
  "iso_9001","iso_14001","iso_20000_or_itil",
  "ps_experience","case_studies","financial_stability",
  "registered_portals","bid_process","framework_awards",
  "crp_ppn","scope12_reporting","carbon_targets"
];

// Best-practice / hygiene -> GREEN (minor)
const MINOR_GREEN = [
  "sustainability_policy","supplier_mgmt","sv_reporting"
];

// Social value themes are optional bonus; not counted as issues if missing
const SOCIAL_VALUE_OPTIONAL = ["sv_employment","sv_community","sv_smes","sv_environment"];

// ---------------- Build issues from missing answers ----------------
const issues = [];  // {key, label, severity}
const label = (k) => ({
  insolvency_clear: "Company not insolvent",
  tax_clear: "Up to date with UK tax",
  no_convictions: "No disqualifying convictions",
  has_insurance: "Insurance cover (PLI/PI/EL)",
  dp_ukgdpr: "Data Protection / UK GDPR policy",
  h_and_s: "Health & Safety policy",
  modern_slavery: "Modern Slavery statement",
  anti_bribery: "Anti-bribery & corruption policy",
  bcp_dr: "Business Continuity / DR plan",
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
})[k] || k;

// Only score keys you actually sent in the form for expected/minor,
// but keep mandatory strict (if it exists in the model and is false => red).
const has = (k) => !!answers[k];
const seen = (k) => Object.prototype.hasOwnProperty.call(answers, k);

// RED: mandatory missing
for (const k of MANDATORY_RED) {
  if (!has(k)) {
    issues.push({ key: k, label: label(k), severity: "red" });
  }
}

// AMBER: expected, but only if the page sent that key and it’s false
for (const k of EXPECTED_AMBER) {
  if (seen(k) && !has(k)) {
    issues.push({ key: k, label: label(k), severity: "amber" });
  }
}

// GREEN: minor, only if the page sent that key and it’s false
for (const k of MINOR_GREEN) {
  if (seen(k) && !has(k)) {
    issues.push({ key: k, label: label(k), severity: "green" });
  }
}

// Social value themes: ignore if missing (optional)

// ---------------- Website perception (kept, additive points) ----------------
let perceptionPct = 40;
const site = { present: [], missing: [] };
let scoreP = 0;
let maxP = 0;

const addCheck = (labelText, pass, sev = "green") => {
  maxP += 1;
  if (pass) { site.present.push(labelText); scoreP += 1; }
  else {
    site.missing.push(labelText);
    // classify website misses as minor by default; Accessibility/CE as amber
    const websiteKey = `web_${labelText.toLowerCase().replace(/\s+/g,'_')}`;
    const severity = (labelText === "Accessibility" || labelText.startsWith("Cyber Essentials")) ? "amber" : "green";
    issues.push({ key: websiteKey, label: labelText, severity });
  }
};

if (website && /^https?:\/\//i.test(website)) {
  try {
    const r = await fetch(website, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 GapScoreBot" } });
    const html = (await r.text()).toLowerCase().replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"");

    addCheck("HTTPS", website.startsWith("https://"));
    addCheck("Privacy", /privacy/i.test(html));
    addCheck("Cookies", /cookie/i.test(html));
    addCheck("Accessibility", /accessibility|wcag/i.test(html));
    addCheck("Company details", /(company number|registered in)/i.test(html));
    addCheck("Social proof", /(testimonial|case\s*stud|trustpilot|google\s*reviews)/i.test(html));
    addCheck("Modern Slavery link", /modern slavery/i.test(html));
    addCheck("Cyber Essentials badge", /cyber\s*essentials(\s*plus)?|iasme/i.test(html));

    const inc = maxP > 0 ? (60 / maxP) * scoreP : 0;
    perceptionPct = Math.min(100, Math.round(40 + inc));
  } catch {
    site.missing.push("Fetched HTML");
    // treat as minor website issue
    issues.push({ key: "web_fetch", label: "Fetched HTML", severity: "green" });
    perceptionPct = 45;
  }
} else {
  perceptionPct = 45;
}

// ---------------- RAG counts from issues only ----------------
const rag = issues.reduce((acc, it) => { acc[it.severity]++; return acc; }, { red:0, amber:0, green:0 });

// ---------------- Scoring (penalize by severity) ----------------
// Tune weights to taste
const penalty = rag.red * 20 + rag.amber * 8 + rag.green * 2;
const compliancePct = Math.max(0, Math.min(100, 100 - penalty));
const overallPct = Math.round(0.60 * compliancePct + 0.40 * perceptionPct);

// Build top suggestions from the most serious issues first
const bullets = buildBullets(
  issues.filter(i=>i.severity==="red").map(i=>i.key),
  issues.filter(i=>i.severity==="amber").map(i=>i.key),
  site.missing
).slice(0,3);

return res.json({
  overallPct,
  bandLabel:
    overallPct >= 80 ? "Public-sector ready (indicative)" :
    overallPct >= 60 ? "Nearly there — a few gaps" :
    overallPct >= 40 ? "Emerging — quick wins available" :
                       "Early stage — start with foundations",
  rag,
  issues,                 // <- full list of issues with severity
  websiteFindings: site,
  nextStepUrl: "https://www.crownpartners.co.uk/contact"
});

  }
}

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
