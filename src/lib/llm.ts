// Thin LLM provider layer. Gemini today; swappable without touching the engine.
// Two tiers: "smart" carries the calls where quality is the product (belief
// extraction, exam writing, grading), "fast" carries Pip's in-character chat.
// Each tier is a ladder that steps down when a model is throttled.
// gemini-flash-latest and 3.5-flash are unusable here: ~20 free requests/day.

const TIERS = {
  smart: [
    process.env.GEMINI_MODEL ?? "gemini-3-flash-preview",
    "gemini-3.1-flash-lite",
  ],
  fast: ["gemini-3.1-flash-lite", "gemini-3-flash-preview"],
};

const urlFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export interface LlmOptions {
  temperature?: number;
  tier?: keyof typeof TIERS;
  // JSON schema for structured output (Gemini responseSchema format)
  responseSchema?: object;
}

export async function generateJson<T>(
  prompt: string,
  opts: LlmOptions = {}
): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 1.0,
      responseMimeType: "application/json",
      ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
    },
  };

  // 5xx gets retried with backoff, then drops down the model ladder; a
  // throttled model (429) drops down immediately instead of waiting out the
  // quota window. Only a non-retryable 4xx aborts the ladder.
  const maxAttempts = 3;
  let lastError = "";
  for (const model of TIERS[opts.tier ?? "smart"]) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(urlFor(model), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        // A 200 with no content (safety block) or truncated JSON is a model
        // blip, not a caller error — treat it like a 5xx and keep climbing
        // down the ladder instead of aborting.
        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (raw) {
          try {
            return JSON.parse(raw) as T;
          } catch {
            lastError = `unparseable JSON from ${model}`;
          }
        } else {
          lastError = `empty response from ${model} (${data?.candidates?.[0]?.finishReason ?? "no candidates"})`;
        }
        if (attempt === maxAttempts) break;
        await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
        continue;
      }

      lastError = `${res.status} on ${model}: ${(await res.text()).slice(0, 200)}`;
      if (res.status === 429) break; // throttled — next model
      if (res.status < 500) {
        throw new Error(`LLM request failed (${lastError})`);
      }
      if (attempt === maxAttempts) break; // model is down — next model
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
    }
  }
  console.error("llm: every model failed —", lastError);
  throw new Error(
    "Gemini is overloaded or out of free quota right now. Wait a minute and try again."
  );
}
