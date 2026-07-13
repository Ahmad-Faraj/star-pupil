// Best-effort per-IP limiter. In-memory, so each serverless instance counts
// on its own — enough to stop one visitor from draining the free quota, not
// a security boundary.

const hits = new Map<string, number[]>();
const MAX_KEYS = 5000;

export function rateLimit(req: Request, limit: number, windowMs: number): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  // Keyed per route, not just per IP — every route calling this shares the map,
  // and one visitor's lesson (reply + extract per turn) must not eat the exam's
  // much smaller cap.
  const key = `${new URL(req.url).pathname}|${ip}`;
  const now = Date.now();
  if (hits.size > MAX_KEYS) hits.clear();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
