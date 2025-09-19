// /api/gap-score.js  — Compliance + Website Perception only (no carbon maths)
// RAG reports errors only; exposes BOTH {large,medium,minor} AND {high,medium,low}

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
  // ---- CORS ----
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

    // ---------------- Compliance sets ----------------
    const mandatory = [
      "insolvency_clear","tax_clear","no_convictions","has_insurance",
      "dp_ukgdpr","h_and_s","modern_slavery","anti_bribery","bcp_dr","edi","whistleblowing"
    ];
    const expected = [
      "iso_9001","iso_14001","iso_27001","iso_20000_or_itil","ce_plus_or_equiv","staff_clearance",
      "sustainability_policy","supplier_mgmt",
      "sv_reporting",
      "crp_ppn","scope12_reporting","carbon_targets","iso_50001","carbon_trust","sbti",
      "ps_experience","case_studies","financial_stability",
      "registered_portals","bid_process","framework_awards"
    ];
    const socialValue = ["sv_employment","sv_community","sv_smes","sv_environment"]; // informational only

    // ---------------- Compliance evaluation ----------------
    const missingMandatory = [];
    const missingExpected = [];
    const present = [];

    for (const k of mandatory) { if (answers[k]) present.push(k); else missingMandatory.push(k); }
    for (const k of expected)  { if (answers[k]) present.push(k); else missingExpected.push(k); }
    // socialValue ignored

    // ---------------- Website perception ----------------
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

    // ---------------- RAG (errors only) + Scoring ----------------
    const websiteMediumLabels = new Set(["Accessibility", "Cyber Essentials badge"]);
    let siteMedium = 0, siteMinor = 0;
    for (const lbl of site.missing) {
      if (websiteMediumLabels.has(lbl)) siteMedium++; else siteMinor++;
    }

    const large  = missingMandatory.length;                 // major gaps
    const medium = missingExpected.length + siteMedium;     // expected + key web
    const minor  = siteMinor;                               // other web hygiene

    // Output both: new scheme + "importance wording"
    const rag = {
      large, medium, minor,    // raw counts
      high: large,             // high-importance / hard to fix
      mediumImportance: medium,// medium-importance
      low: minor               // low-importance / quick wins
    };

    // Compliance maths
    const complianceBase = 100 - (missingMandatory.length * 12 + missingExpected.length * 4);
    const compliancePct = clamp(complianceBase);

    const overallPct = Math.round(0.60 * compliancePct + 0.40 * perceptionPct);
    const bandLabel =
      overallPct >= 80 ? "Public-sector ready (indicative)" :
      overallPct >= 60 ? "Nearly there — a few gaps" :
      overallPct >= 40 ? "Emerging — quick wins available" :
                         "Early stage — start with foundations";

    const bullets = buildBullets(missingMandatory, missingExpected, site.missing).slice(0, 3);

    return res.json({
      overallPct,
      bandLabel,
      bullets,
      rag,
      websiteFindings: site,
      nextStepUrl: "https://www.crownpartners.co.uk/contact"
    });
  } catch (e) {
    return res.status(500).json({ error: "server_error" });
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
