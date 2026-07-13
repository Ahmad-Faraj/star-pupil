import { NextRequest } from "next/server";
import { generateExam } from "@/lib/student";
import { rateLimit } from "@/lib/rate-limit";

export const maxDuration = 60;

// The paper is written here, at enrollment, before the teacher has said one
// word. That ordering is the trust claim the lesson screen makes ("sealed
// before you taught"), so this route must never see the ledger.
export async function POST(req: NextRequest) {
  if (!rateLimit(req, 8, 10 * 60 * 1000)) {
    return Response.json(
      { error: "The examiner's office is swamped. Try again in a few minutes." },
      { status: 429 }
    );
  }
  const { topic } = (await req.json()) as { topic?: string };
  if (!topic?.trim()) {
    return Response.json({ error: "no topic" }, { status: 400 });
  }
  const questions = await generateExam(topic.trim());
  return Response.json({ questions });
}
