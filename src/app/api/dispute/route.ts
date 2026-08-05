import { NextRequest } from "next/server";
import { Belief, disputeBelief } from "@/lib/student";
import { rateLimit } from "@/lib/rate-limit";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!rateLimit(req, 30, 10 * 60 * 1000)) {
    return Response.json(
      { error: "Pip needs a minute. Try the argument again shortly." },
      { status: 429 }
    );
  }
  const { topic, belief, objection } = (await req.json()) as {
    topic?: string;
    belief?: Belief;
    objection?: string;
  };
  if (!topic || !belief?.quote || !objection?.trim()) {
    return Response.json(
      { error: "topic, belief and objection are required" },
      { status: 400 }
    );
  }
  try {
    return Response.json(await disputeBelief(topic, belief, objection));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "the argument failed" },
      { status: 500 }
    );
  }
}
