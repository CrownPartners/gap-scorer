// /api/gap-score.js
export default async function handler(req, res) {
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

      insurance_pl: 3,
      insurance_pi: 3,
      insurance_el: 3,
      insurance_pl_10m_bonus: 1,

      iso_9001: 6,
      iso_27001: 8,
      iso_14001: 4,
      iso_20000: 5,
      ce_plus: 6,
      ce_basic: 3,
      csa_star: 4,

      bpss: 5,
      sc_or_dv: 3,

      modern_slavery: 6,
      dp_ukgdpr: 8,
      h_and_s: 4,
      edi: 4,
      whistleblowing: 2,
      anti_bribery: 4,
      bcp_dr: 5,
      supplier_mgmt: 2,

      crp_ppn: 6,
      scope12_reporting: 3,
      carbon_targets: 2,
      iso_50001: 1,
      sbti: 1,
      carbon_trust: 1,

      ps_experience_some: 5,
      ps_experience_strong: 7,
      case_studies_2plus: 3,
      financial_stability: 6,

      portals_registered: 3,
      bid_process: 3,
      prev_framework_award: 2
    };
    const gates = ["insolvency_clear", "tax_clear", "no_convictions"];
    let complianceScore = 0, complianceMax = 0, cFlags = [];

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

    for (const [k, w] of Object.entries(W)) {
      if (k === "ce_basic" && answers["ce_plus"]) continue;
      complianceMax += w;
      if (answers[k]) complianceScore += w;
    }

    if (answers["targets_public_sector"] && !answers["modern_slavery"]) {
      complianceScore -= 3;
      cFlags.push("no_modern_slavery_ps");
    }

    const compliancePct = clampPct((complianceScore / complianceMax) * 100);
    const complianceBand = band4(compliancePct);

    // ---------- 2) CARBON ----------
    const {
      baseline_year,
      baseline_tco2e,
      current_year,
      current_tco2e,
      target_year
    } = carbon || {};

    const TY = Number(target_year) || 2050;
    const CY = Number(current_year) || new Date().getUTCFullYear();
    let carbonAdvice = null;
    let carbonPct = 50;

    if (isNumber(baseline_tco2e) && Number(baseline_year) > 1990) {
      const base = Number(baseline_tco2e);
      const cur = isNumber(current_tco2e) ? Number(current_tco2e) : base;
      const yearsLeft = Math.max(TY - CY, 1);
      const drop = (cur - 0) / yearsLeft;
      const pctDrop = cur > 0 ? (drop / cur) * 100 : 0;

      carbonAdvice = {
        mode: "data",
        baselineYear: Number(baseline_year),
        baselineTCO2e: base,
        currentYear: CY,
        currentTCO2e: cur,
        targetYear: TY,
        suggestedAnnualReduction_tCO2e: round1(drop),
        suggestedAnnualReduction_percentOfCurrent: round1(pctDrop)
      };

      if (answers["crp_ppn"] && answers["scope12_reporting"] && answers["carbon_targets"]) carbonPct = 75;
      else if (answers["crp_ppn"] && (answers["scope12_reporting"] || answers["carbon_targets"])) carbonPct = 62;
      else if (answers["scope12_reporting"]) carbonPct = 55;
      else carbonPct = 45;
    } else {
      carbonAdvice = {
        mode: "indicative",
        message: "Provide a baseline to calculate tonnage. Proxy: ~4.2% absolute Scope 1+2 reduction per year.",
        suggestedAnnualReduction_percent: 4.2
      };
      carbonPct = answers["crp_ppn"] ? 60 : 45;
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
        if (html.includes("accessibility")) perceptionPct += 2;
      } catch {
        pFlags.push("fetch_failed");
        perceptionPct = 40;
      }
    }

    perceptionPct = clampPct(perceptionPct);
    const perceptionBullets = [];
    if (pFlags.includes("no_social_proof")) perceptionBullets.push("Add 2–3 outcome-led case studies or link to reviews.");
    if (pFlags.includes("privacy_missing")) perceptionBullets.push("Ensure a visible Privacy page in the footer.");
    if (pFlags.includes("no_company_number")) perceptionBullets.push("Display registered company info to reassure public buyers.");
    if (!perceptionBullets.length) perceptionBullets.push("Tidy footer hygiene and clarify outcomes.");

    // ---------- 4) OVERALL ----------
    const overallPct = Math.round(
      0.45 * compliancePct +
      0.35 * perceptionPct +
      0.20 * carbonPct
    );

    const overallBand = overallPct >= 80 ? "Public-sector ready (indicative)"
                      : overallPct >= 60 ? "Nearly there — a few gaps"
                      : overallPct >= 40 ? "Emerging — quick wins available"
                      : "Early stage — start with foundations";

    const complianceBullets = suggestComplianceBullets(answers);
    const bullets = [...perceptionBullets, ...complianceBullets].slice(0, 3);

    return res.json({
      overallPct,
      bandLabel: overallBand,
      bullets,
      subscore: {
        compliancePct,
        perceptionPct,
        carbonPct
      },
      carbonAdvice,
      nextStepUrl: "https://YOUR-SITE/thanks"
    });

  } catch {
    return res.status(500).json({ error: "server_error" });
  }
}

// ---------- helpers ----------
const clampPct = (x) => Math.max(0, Math.min(100, Math.round(x)));
const round1 = (n) => Math.round(n * 10) / 10;
const isNumber = (n) => n !== null && n !== "" && !isNaN(Number(n));

function band4(p) {
  return p >= 80 ? "Strong" : p >= 60 ? "Good" : p >= 40 ? "Emerging" : "Low";
}
function suggestComplianceBullets(a) {
  const out = [];
  if (!a["dp_ukgdpr"]) out.push("Publish a UK GDPR + DPA 2018 policy with DPO/contact.");
  if (!a["bcp_dr"]) out.push("Document Business Continuity & Disaster Recovery basics.");
  if (!a["iso_27001"] && !a["ce_plus"]) out.push("Strengthen information security assurance (CE+ or ISO 27001).");
  if (!a["modern_slavery"] && a["targets_public_sector"]) out.push("Publish a Modern Slavery statement and link it in the footer.");
  return out;
}
