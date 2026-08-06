import { NextRequest } from "next/server";
import { Belief, ExamQuestion, generateExam, gradeExam, sitExam } from "@/lib/student";
import { rateLimit } from "@/lib/rate-limit";

// Vercel's Hobby plan hard-caps every function at 60s regardless of what a
// higher value here claims. An exam is three model calls in one invocation, so
// each is budgeted (see the ladderBudgetMs args in student.ts) to keep their
// sum safely under this real ceiling.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // An exam is three model calls, so it gets the tightest cap.
  if (!rateLimit(req, 6, 10 * 60 * 1000)) {
    return Response.json(
      { error: "The exam hall is booked out. Try again in a few minutes." },
      { status: 429 }
    );
  }
  // A retake sends the paper back. Pip must sit the SAME questions or the two
  // grades cannot be compared, and comparing them is the point of a retake.
  const { topic, ledger, paper } = (await req.json()) as {
    topic?: string;
    ledger?: Belief[];
    paper?: ExamQuestion[];
  };
  if (!topic || !ledger?.length) {
    return Response.json(
      { error: "teach Pip at least one thing before the exam" },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        send({ kind: "stage", stage: "writing" });
        const questions = paper?.length ? paper : await generateExam(topic, ledger, 6);
        send({ kind: "stage", stage: "sitting", questions });
        const answers = await sitExam(topic, ledger, questions);
        // Pip's script goes out before the red pen touches it. Grading is the
        // slowest of the three calls, and the teacher spends it reading what
        // their own lesson made him write, which is the interesting part.
        send({ kind: "stage", stage: "grading", answers });
        const grades = await gradeExam(topic, ledger, questions, answers);
        send({ kind: "done", questions, answers, grades });
      } catch (err) {
        send({ kind: "error", message: err instanceof Error ? err.message : "failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
