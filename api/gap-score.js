// pages/api/gap-score.ts  (Pages Router)  — SAFE MODE
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // --- Permissive CORS to rule out preflight issues ---
  const origin = (req.headers.origin as string) || "*";
  res.setHeader("Access-Control-Allow-Origin", origin); // echo origin
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] || "Content-Type, Authorization, X-Requested-With, Accept, x-key"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  // If you send cookies/credentials from the site, also uncomment:
  // res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  // Auth OFF in safe mode — we just want to see the request get through
  try {
    // Don’t do any fetches or heavy logic here
    return res.status(200).json({
      ok: true,
      note: "Safe mode OK",
      echo: {
        origin,
        method: req.method,
        contentType: req.headers["content-type"] || null,
        receivedKeys: req.body && typeof req.body === "object" ? Object.keys(req.body) : null,
      },
    });
  } catch (e: any) {
    console.error("safe-mode error", e);
    return res.status(500).json({ error: "server_error", message: e?.message });
  }
}
