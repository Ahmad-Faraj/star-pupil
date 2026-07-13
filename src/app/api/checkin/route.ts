import { NextRequest } from "next/server";
import { Belief, explainConcept } from "@/lib/student";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { topic, ledger, concept } = (await req.json()) as {
    topic?: string;
    ledger?: Belief[];
    concept?: string;
  };
  if (!topic || !concept?.trim()) {
    return Response.json({ error: "topic and concept are required" }, { status: 400 });
  }
  try {
    const reply = await explainConcept(topic, ledger ?? [], concept);
    return Response.json(reply);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Pip could not explain that back" },
      { status: 500 }
    );
  }
}
