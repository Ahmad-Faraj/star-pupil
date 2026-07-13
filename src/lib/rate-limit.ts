// Best-effort per-IP limiter. In-memory, so each serverless instance counts
// on its own — enough to stop one visitor from draining the free quota, not
// a security boundary.

const hits = new Map<string, number[]>();
const MAX_KEYS = 5000;

export function rateLimit(req: Request, limit: number, windowMs: number): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const now = Date.now();
  if (hits.size > MAX_KEYS) hits.clear();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}
