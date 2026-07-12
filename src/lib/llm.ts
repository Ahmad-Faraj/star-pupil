// Thin LLM provider layer. Gemini today; swappable without touching the engine.
// Two tiers: "smart" carries the calls where quality is the product (planting
// and fact-checking lies), "fast" carries the style check. Each tier is a
// ladder that steps down when a model is throttled. gemini-flash-latest and
// 3.5-flash are unusable here: ~20 free requests per day.

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

  // 5xx gets retried with backoff; a throttled model (429) drops down the
  // model ladder instead of waiting out the quota window.
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
        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!raw) throw new Error("LLM returned no content");
        return JSON.parse(raw) as T;
      }

      lastError = `${res.status} on ${model}: ${(await res.text()).slice(0, 200)}`;
      if (res.status === 429) break; // throttled — next model
      if (res.status < 500 || attempt === maxAttempts) {
        throw new Error(`LLM request failed (${lastError})`);
      }
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
    }
  }
  console.error("llm: every model failed —", lastError);
  throw new Error(
    "The free Gemini tier is out of quota right now. Wait a minute and try again."
  );
}
