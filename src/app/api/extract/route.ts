import { NextRequest } from "next/server";
import { Belief, extractBeliefs } from "@/lib/student";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
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
  const next = await extractBeliefs(topic, ledger ?? [], message, turn);
  return Response.json({ ledger: next });
}
