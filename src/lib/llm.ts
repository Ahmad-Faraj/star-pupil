// Thin LLM provider layer. Two tiers: "smart" carries the calls where quality is
// the product (belief extraction, exam writing, grading), "fast" carries Pip's
// in-character chat. Each tier is a ladder of rungs that steps down when a model
// is throttled, and the bottom rungs are a different provider, so Gemini running
// out of free quota mid-demo degrades to a slower answer instead of an error.
// gemini-flash-latest and 3.5-flash are unusable here: ~20 free requests/day.

export type Provider = "gemini" | "groq";

export interface Rung {
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
  // Replaces the tier's ladder for this one call. The app never sets it: a
  // ladder that cannot step down is a worse app. scripts/leak-eval.ts sets it
  // to pin one exact model, because "the grader's leniency depends on which
  // model is grading" is only a measurement if you choose the model.
  rungs?: Rung[];
  // Overrides the default wall-clock budget for this one call. The exam route
  // makes three of these calls back to back inside one function invocation, so
  // each gets a tighter budget than a route that only ever makes one, keeping
  // their sum well inside the route's own maxDuration.
  ladderBudgetMs?: number;
}

interface Attempt {
  ok: boolean;
  text?: string;
  status?: number;
  detail?: string;
}

// Judges hitting the live deploy concurrently share one free-tier quota per
// key, so a comma-separated list of backup keys is treated as a pool: a 429
// on one rotates to the next key for the same model before the ladder gives
// up on that model entirely and steps down to a different one. A single key
// still works exactly as before - split(",") on one value is just that value.
function keysFor(provider: Provider): string[] {
  const raw = provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY;
  return (raw ?? "").split(",").map((k) => k.trim()).filter(Boolean);
}

async function callGemini(
  model: string,
  prompt: string,
  opts: LlmOptions,
  apiKey: string,
  signal: AbortSignal
): Promise<Attempt> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts.temperature ?? 1.0,
          responseMimeType: "application/json",
          ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
        },
      }),
      signal,
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
async function callGroq(
  model: string,
  prompt: string,
  opts: LlmOptions,
  apiKey: string,
  signal: AbortSignal
): Promise<Attempt> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 1.0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal,
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

// A judge hammering the app mid-hackathon is the whole point of shipping it, so
// a single stuck upstream call must never be allowed to sit there until the
// platform kills the whole function and hands back an HTML error page instead
// of JSON (that page is what the frontend's res.json() then chokes on). Two
// bounds, not one: a per-attempt timeout so a hang can't eat the budget on its
// own, and a wall-clock budget on the whole ladder so a bad run always fails
// fast and clean well inside the route's own maxDuration, rather than racing it.
const ATTEMPT_TIMEOUT_MS = 20_000;
const LADDER_BUDGET_MS = 45_000;

interface Step {
  provider: Provider;
  model: string;
  apiKey: string;
}

export async function generateJson<T>(prompt: string, opts: LlmOptions = {}): Promise<T> {
  const rungs = opts.rungs ?? TIERS[opts.tier ?? "smart"];
  // Every (model, key) pairing is its own step, keys innermost: a 429 rotates
  // to a sibling key on the SAME model first (a fresh key is a fresh quota
  // bucket, so this is usually enough on its own), and only steps down to a
  // different model once every key for this one is spent.
  const steps: Step[] = rungs.flatMap((r) => keysFor(r.provider).map((apiKey) => ({ ...r, apiKey })));
  if (!steps.length) throw new Error("no LLM provider is configured");

  // 5xx gets retried with backoff, then drops to the next step; a throttled key
  // (429) drops immediately instead of waiting out the quota window. A 4xx is
  // our own request being wrong for that provider, so it skips every remaining
  // step on that provider rather than repeating the same mistake on a sibling
  // model or key.
  const maxAttempts = 2;
  const ladderBudgetMs = opts.ladderBudgetMs ?? LADDER_BUDGET_MS;
  let lastError = "";
  const dead = new Set<Provider>();
  const startedAt = Date.now();

  for (const { provider, model, apiKey } of steps) {
    if (dead.has(provider)) continue;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const remaining = ladderBudgetMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        lastError = lastError || "ran out of time before any rung answered";
        break;
      }
      const call = provider === "gemini" ? callGemini : callGroq;
      const timeoutMs = Math.min(ATTEMPT_TIMEOUT_MS, remaining);
      // fetch throws rather than returning a response when the connection
      // itself fails (DNS, reset, headers timeout, or our own abort). Unhandled,
      // that escapes the ladder entirely and a flaky minute of network looks
      // exactly like an outage. It is a transport failure, so treat it as a
      // 5xx: retry, then step down.
      let res: Attempt;
      try {
        res = await call(model, prompt, opts, apiKey, AbortSignal.timeout(timeoutMs));
      } catch (e) {
        const timedOut = e instanceof Error && e.name === "TimeoutError";
        res = {
          ok: false,
          detail: timedOut ? `no response in ${timeoutMs}ms` : e instanceof Error ? e.message : "fetch failed",
        };
      }

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
        if (res.status === 429) break; // throttled, try the next key or model
        if (res.status && res.status < 500) {
          dead.add(provider);
          break;
        }
      }

      if (attempt === maxAttempts) break;
      const backoff = Math.min(800 * 2 ** (attempt - 1), ladderBudgetMs - (Date.now() - startedAt));
      if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
    }
    if (Date.now() - startedAt >= ladderBudgetMs) break;
  }

  console.error("llm: every rung failed:", lastError);
  throw new Error(
    "Every model is overloaded or out of free quota right now. Wait a minute and try again."
  );
}
