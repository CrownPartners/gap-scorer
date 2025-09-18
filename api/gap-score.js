// api/gap-score.js

export default async function handler(req, res) {
  // --- CORS headers for Webflow (update with your domain) ---
  res.setHeader("Access-Control-Allow-Origin", "https://crown-partners-ltd.webflow.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-key");

  if (req.method === "OPTIONS") return res.status(200).end(); // Handle preflight

  try {
    if (req.method !== "POST") return res.status(405).end();
    if (req.headers["x-key"] !== process.env.WF_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const { website, answers = {}, carbon = {}, meta = {} } = req.body || {};

    // ---------- 1) COMPLIANCE ----------
    const W = {
      insolvency_clear: 12,
      tax_clear: 10,
      no_convictions: 8,
      dp_ukgdpr: 8,
      bcp_dr: 5,
      ce_plus: 6
    };
    const gates = ["insolvency_clear", "tax_clear", "no_convictions"];
    for (const g of gates) {
      if (!answers[g]) {
        return res.json({
          overallPct: 22,
          bandLabel: "Early stage — start with foundations",
          bullets: ["Resolve legal/financial disqualifiers before bidding."],
          subscore: { compliancePct: 0, perceptionPct: 0, carbonPct: 0 },
          carbonAdvice: null
        });
      }
    }

    let c = 0, m = 0;
    for (const [k, w] of Object.entries(W)) {
      m += w;
      if (answers[k]) c += w;
    }
    if (answers["targets_public_sector"] && !answers["modern_slavery"]) c -= 3;
    const compliancePct = clamp((c / m) * 100);

    // ---------- 2) CARBON ----------
    const { baseline_year, baseline_tco2e, current_year, current_tco2e, target_year } = carbon || {};
    const TY = Number(target_year) || 2050;
    const CY = Number(current_year) || new Date().getUTCFullYear();
    let carbonPct = answers["crp_ppn"] ? 60 : 45;
    let carbonAdvice = {
      mode: "indicative",
      message: "Provide a baseline; proxy ~4.2% absolute Scope 1+2 reduction per year.",
      suggestedAnnualReduction_percent: 4.2
    };

    if (num(baseline_tco2e) && Number(baseline_year) > 1990) {
      const base = Number(baseline_tco2e);
      const cur = num(current_tco2e) ? Number(current_tco2e) : base;
      const yrs = Math.max(TY - CY, 1);
      const drop = (cur - 0) / yrs;
      carbonAdvice = {
        mode: "data",
        baselineYear: Number(baseline_year),
        baselineTCO2e: base,
        currentYear: CY,
        currentTCO2e: cur,
        targetYear: TY,
        suggestedAnnualReduction_tCO2e: round(drop),
        suggestedAnnualReduction_percentOfCurrent: round(cur ? (drop / cur) * 100 : 0)
      };
      if (answers["crp_ppn"] && answers["scope12_reporting"] && answers["carbon_targets"]) carbonPct = 75;
      else if (answers["crp_ppn"] && (answers["scope12_reporting"] || answers["carbon_targets"])) carbonPct = 62;
      else if (answers["scope12_reporting"]) carbonPct = 55;
      else carbonPct = 45;
    }

    // ---------- 3) PERCEPTION ----------
    let perceptionPct = 45;
    let pFlags = [];
    if (website && /^https?:\/\//i.test(website)) {
      try {
        const r = await fetch(website, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 GapScoreBot" } });
        const html = (await r.text()).toLowerCase();
        if (website.startsWith("https://")) perceptionPct += 6; else pFlags.push("no_https");
        if (html.includes("privacy")) perceptionPct += 4; else pFlags.push("privacy_missing");
        if (html.includes("contact")) perceptionPct += 4;
        if (html.includes("company number") || html.includes("registered in")) perceptionPct += 6; else pFlags.push("no_company_number");
        if (html.includes("case stud") || html.includes("testimonial") || html.includes("trustpilot") || html.includes("google reviews")) perceptionPct += 6; else pFlags.push("no_social_proof");
      } catch {
        pFlags.push("fetch_failed");
        perceptionPct = 40;
      }
    }
    perceptionPct = clamp(perceptionPct);

    // ---------- 4) OVERALL ----------
    const overallPct = Math.round(
      0.45 * compliancePct +
      0.35 * perceptionPct +
      0.20 * carbonPct
    );
    const bandLabel = overallPct >= 80 ? "Public-sector ready (indicative)" :
                      overallPct >= 60 ? "Nearly there — a few gaps" :
                      overallPct >= 40 ? "Emerging — quick wins available" :
                                         "Early stage — start with foundations";
    const bullets = buildBullets(answers, pFlags).slice(0, 3);

    return res.json({
      overallPct,
      bandLabel,
      bullets,
      subscore: { compliancePct, perceptionPct, carbonPct },
      carbonAdvice,
      nextStepUrl: "https://YOUR-SITE/thanks"
    });

  } catch {
    return res.status(500).json({ error: "server_error" });
  }
}

// ---------- helpers ----------
const clamp = x => Math.max(0, Math.min(100, Math.round(x)));
const num = n => n !== null && n !== "" && !isNaN(Number(n));
const round = n => Math.round(n * 10) / 10;

function buildBullets(a, pf) {
  const out = [];
  if (pf.includes("no_social_proof")) out.push("Add 2–3 outcome-led case studies or link to reviews.");
  if (pf.includes("privacy_missing")) out.push("Ensure a visible Privacy page in the footer.");
  if (pf.includes("no_company_number")) out.push("Display registered company info to reassure public buyers.");
  if (!a["dp_ukgdpr"]) out.push("Publish a UK GDPR + DPA 2018 policy with DPO/contact.");
  if (!a["bcp_dr"]) out.push("Document Business Continuity & Disaster Recovery basics.");
  if (!a["iso_27001"] && !a["ce_plus"]) out.push("Strengthen information security assurance (CE+ or ISO 27001).");
  if (!a["modern_slavery"] && a["targets_public_sector"]) out.push("Publish a Modern Slavery statement and link it in the footer.");
  return out;
}
