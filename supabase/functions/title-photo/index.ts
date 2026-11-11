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

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "Look at this field photograph and create one concise, factual map-pin title of 2 to 7 words. Identify the main visible subject or scene. Do not guess location, identity, danger, or details that are not clearly visible. Return only the title, no quotes or explanation." },
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 40 },
        }),
      },
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const upstreamMessage = payload?.error?.message || "Unknown Gemini API error";
      console.error("Gemini request failed", response.status, upstreamMessage);
      const safeMessage = response.status === 401 || response.status === 403
        ? "Gemini rejected the API key. Check the GEMINI_API_KEY secret in Supabase."
        : response.status === 429
          ? "Gemini rate limit or free quota reached. Try again shortly."
          : response.status === 404
            ? "Gemini model is unavailable for this API key."
            : "Gemini could not analyze this photo right now.";
      return json({ error: safeMessage }, 502);
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

    if (!title) {
      console.error("Gemini returned no usable title", JSON.stringify(payload).slice(0, 1000));
      return json({ error: "Gemini returned no title for this image. Try another photo." }, 502);
    }

    return json({ title });
  } catch (error) {
    console.error("title-photo error", error);
    return json({ error: "Could not generate a title for this photo." }, 500);
  }
});
