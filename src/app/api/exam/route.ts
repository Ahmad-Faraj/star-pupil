import { NextRequest } from "next/server";
import { Belief, generateExam, gradeExam, sitExam } from "@/lib/student";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { topic, ledger } = (await req.json()) as {
    topic?: string;
    ledger?: Belief[];
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
        const questions = await generateExam(topic, ledger, 6);
        send({ kind: "stage", stage: "sitting" });
        const answers = await sitExam(topic, ledger, questions);
        send({ kind: "stage", stage: "grading" });
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
