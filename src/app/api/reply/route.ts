import { NextRequest } from "next/server";
import { Belief, ChatTurn, pupilReply } from "@/lib/student";
import { rateLimit } from "@/lib/rate-limit";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!rateLimit(req, 60, 10 * 60 * 1000)) {
    return Response.json(
      { error: "Pip needs a short break. Try again in a minute." },
      { status: 429 }
    );
  }
  const { topic, ledger, transcript, message } = (await req.json()) as {
    topic?: string;
    ledger?: Belief[];
    transcript?: ChatTurn[];
    message?: string;
  };
  if (!topic || !message?.trim()) {
    return Response.json({ error: "topic and message are required" }, { status: 400 });
  }
  try {
    const reply = await pupilReply(topic, ledger ?? [], transcript ?? [], message);
    return Response.json(reply);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Pip could not answer" },
      { status: 500 }
    );
  }
}
