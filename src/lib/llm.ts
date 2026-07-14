// Thin LLM provider layer. Two tiers: "smart" carries the calls where quality is
// the product (belief extraction, exam writing, grading), "fast" carries Pip's
// in-character chat. Each tier is a ladder of rungs that steps down when a model
// is throttled, and the bottom rungs are a different provider, so Gemini running
// out of free quota mid-demo degrades to a slower answer instead of an error.
// gemini-flash-latest and 3.5-flash are unusable here: ~20 free requests/day.

type Provider = "gemini" | "groq";

interface Rung {
  provider: Provider;
  model: string;
}

// Groq is the fallback rather than the primary because only Gemini enforces the
// response schema. Groq is held to JSON validity and the shape stated in each
// prompt, which is looser, so it answers only when Gemini cannot.
const TIERS: Record<"smart" | "fast", Rung[]> = {
  smart: [
    { provider: "gemini", model: process.env.GEMINI_MODEL ?? "gemini-3-flash-preview" },
    { provider: "gemini", model: "gemini-3.1-flash-lite" },
    { provider: "groq", model: "openai/gpt-oss-120b" },
    { provider: "groq", model: "llama-3.3-70b-versatile" },
  ],
  fast: [
    { provider: "gemini", model: "gemini-3.1-flash-lite" },
    { provider: "gemini", model: "gemini-3-flash-preview" },
    { provider: "groq", model: "llama-3.1-8b-instant" },
  ],
};

export interface LlmOptions {
  temperature?: number;
  tier?: keyof typeof TIERS;
  // JSON schema for structured output (Gemini responseSchema format)
  responseSchema?: object;
}

interface Attempt {
  ok: boolean;
  text?: string;
  status?: number;
  detail?: string;
}

const keyFor = (provider: Provider) =>
  provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY;

async function callGemini(model: string, prompt: string, opts: LlmOptions): Promise<Attempt> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": keyFor("gemini")!,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts.temperature ?? 1.0,
          responseMimeType: "application/json",
          ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
        },
      }),
    }
  );
  if (!res.ok) {
    return { ok: false, status: res.status, detail: (await res.text()).slice(0, 200) };
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text
    ? { ok: true, text }
    : { ok: false, detail: `empty (${data?.candidates?.[0]?.finishReason ?? "no candidates"})` };
}

// json_object mode, not a strict json_schema: strict mode requires every field
// to be required and forbids extra ones, and half the engine's schemas have
// optional fields (a belief's derivedFrom, a grade's culpritBeliefId). So the
// shape comes from the "Return JSON: {...}" line every prompt already ends with,
// and a reply that ignores it is caught by the parse below and drops a rung.
async function callGroq(model: string, prompt: string, opts: LlmOptions): Promise<Attempt> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${keyFor("groq")!}`,
    },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 1.0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: (await res.text()).slice(0, 200) };
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return text
    ? { ok: true, text }
    : { ok: false, detail: `empty (${data?.choices?.[0]?.finish_reason ?? "no choices"})` };
}

export async function generateJson<T>(prompt: string, opts: LlmOptions = {}): Promise<T> {
  const rungs = TIERS[opts.tier ?? "smart"].filter((r) => keyFor(r.provider));
  if (!rungs.length) throw new Error("no LLM provider is configured");

  // 5xx gets retried with backoff, then drops to the next rung; a throttled model
  // (429) drops immediately instead of waiting out the quota window. A 4xx is our
  // own request being wrong for that provider, so it skips the provider's
  // remaining rungs rather than repeating the same mistake on a sibling model.
  const maxAttempts = 3;
  let lastError = "";
  const dead = new Set<Provider>();

  for (const { provider, model } of rungs) {
    if (dead.has(provider)) continue;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const call = provider === "gemini" ? callGemini : callGroq;
      const res = await call(model, prompt, opts);

      if (res.ok) {
        try {
          return JSON.parse(res.text!) as T;
        } catch {
          // Unparseable JSON is a model blip, not a caller error, so treat it
          // like a 5xx and keep climbing down rather than aborting.
          lastError = `unparseable JSON from ${model}`;
        }
      } else {
        lastError = `${res.status ?? "?"} on ${model}: ${res.detail}`;
        if (res.status === 429) break; // throttled, try the next rung
        if (res.status && res.status < 500) {
          dead.add(provider);
          break;
        }
      }

      if (attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
    }
  }

  console.error("llm: every rung failed:", lastError);
  throw new Error(
    "Every model is overloaded or out of free quota right now. Wait a minute and try again."
  );
}
