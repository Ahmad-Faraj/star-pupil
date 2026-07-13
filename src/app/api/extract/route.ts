import { NextRequest } from "next/server";
import { Belief, extractBeliefs } from "@/lib/student";
import { rateLimit } from "@/lib/rate-limit";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!rateLimit(req, 60, 10 * 60 * 1000)) {
    return Response.json(
      { error: "The notebook is full for now. Try again in a minute." },
      { status: 429 }
    );
  }
  const { topic, ledger, message, turn } = (await req.json()) as {
    topic?: string;
    ledger?: Belief[];
    message?: string;
    turn?: number;
  };
  if (!topic || !message?.trim() || typeof turn !== "number") {
    return Response.json(
      { error: "topic, message and turn are required" },
      { status: 400 }
    );
  }
  try {
    const next = await extractBeliefs(topic, ledger ?? [], message, turn);
    return Response.json({ ledger: next });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "the notebook failed" },
      { status: 500 }
    );
  }
}
