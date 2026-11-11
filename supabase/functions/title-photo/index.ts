import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const prompt = "Look at this field photograph and create one concise, factual map-pin title of 2 to 7 words. Identify the main visible subject or scene. Do not guess location, identity, danger, or details that are not clearly visible. Return only the title, no quotes or explanation.";

async function generateTitle(apiKey: string, model: string, imageBase64: string, mimeType: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 40 },
      }),
      signal: AbortSignal.timeout(12000),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || "Unknown Gemini API error";
    console.error("Gemini model attempt failed", model, response.status, message);
    return { title: "", status: response.status };
  }

  const raw = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? "")
    .join(" ")
    .trim();

  const title = String(raw || "")
    .replace(/^[\"']|[\"']$/g, "")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 120)
    .trim();

  if (!title) console.error("Gemini returned no usable title", model, JSON.stringify(payload).slice(0, 700));
  return { title, status: title ? 200 : 502 };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return json({ error: "AI photo titles are not configured. Add GEMINI_API_KEY to Supabase Edge Function secrets." }, 503);
  }

  try {
    const body = await req.json();
    const imageBase64 = body?.imageBase64;
    const mimeType = body?.mimeType;

    if (typeof imageBase64 !== "string" || imageBase64.length === 0 || imageBase64.length > 7_000_000) {
      return json({ error: "Image is missing or too large for title generation." }, 400);
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      return json({ error: "Unsupported image format." }, 400);
    }

    // Prefer the efficient, free-tier Flash-Lite model. If it is busy or unavailable,
    // automatically fail over to Flash so a temporary model outage does not block titles.
    const models = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
    let lastStatus = 503;

    for (const model of models) {
      try {
        const result = await generateTitle(apiKey, model, imageBase64, mimeType);
        if (result.title) return json({ title: result.title, model });
        lastStatus = result.status;
        if (![404, 429, 500, 502, 503, 504].includes(result.status)) break;
      } catch (error) {
        console.error("Gemini model request threw", model, error);
        lastStatus = 503;
      }
    }

    const safeMessage = lastStatus === 401 || lastStatus === 403
      ? "Gemini rejected the API key. Check the GEMINI_API_KEY secret in Supabase."
      : lastStatus === 429
        ? "Gemini free quota or rate limit reached for both models. Try again later."
        : "Gemini is temporarily busy or unavailable. The photo pin can still be saved; try AI titling again shortly.";
    return json({ error: safeMessage }, 503);
  } catch (error) {
    console.error("title-photo error", error);
    return json({ error: "Could not generate a title for this photo." }, 500);
  }
});
