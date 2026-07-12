import { NextRequest } from "next/server";
import { Belief, ChatTurn, pupilReply } from "@/lib/student";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { topic, ledger, transcript, message } = (await req.json()) as {
    topic?: string;
    ledger?: Belief[];
    transcript?: ChatTurn[];
    message?: string;
  };
  if (!topic || !message?.trim()) {
    return Response.json({ error: "topic and message are required" }, { status: 400 });
  }
  const reply = await pupilReply(topic, ledger ?? [], transcript ?? [], message);
  return Response.json(reply);
}
