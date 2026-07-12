"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Belief,
  ChatTurn,
  ExamAnswer,
  ExamQuestion,
  GradedAnswer,
  PupilReply,
} from "@/lib/student";

type Phase = "enroll" | "lesson" | "exam" | "report";

interface ExamResult {
  questions: ExamQuestion[];
  answers: ExamAnswer[];
  grades: GradedAnswer[];
}

const SUGGESTED = ["photosynthesis", "binary search", "the French Revolution", "supply and demand"];

function gradeLetter(score: number, total: number): string {
  const pct = total === 0 ? 0 : score / total;
  if (pct >= 0.9) return "A";
  if (pct >= 0.8) return "B+";
  if (pct >= 0.65) return "B";
  if (pct >= 0.5) return "C";
  if (pct >= 0.35) return "D";
  return "F";
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("enroll");
  const [topic, setTopic] = useState("");
  const [transcript, setTranscript] = useState<ChatTurn[]>([]);
  const [ledger, setLedger] = useState<Belief[]>([]);
  const [draft, setDraft] = useState("");
  const [pipThinking, setPipThinking] = useState(false);
  const [writingNotes, setWritingNotes] = useState(0); // pending extractions
  const [examStage, setExamStage] = useState<string>("");
  const [result, setResult] = useState<ExamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const turnRef = useRef(0);

  function enroll(t: string) {
    setTopic(t.trim());
    setPhase("lesson");
    setTranscript([
      {
        role: "pupil",
        text: `Okay. I know nothing about ${t.trim()}, and I mean nothing. Teach me.`,
      },
    ]);
  }

  async function teach() {
    const message = draft.trim();
    if (!message || pipThinking) return;
    setDraft("");
    setError(null);
    const turn = ++turnRef.current;
    const nextTranscript: ChatTurn[] = [...transcript, { role: "teacher" as const, text: message }];
    setTranscript(nextTranscript);
    setPipThinking(true);
    setWritingNotes((n) => n + 1);

    // Pip answers fast; the notebook updates when the slower extraction lands.
    const replyPromise = fetch("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, ledger, transcript: nextTranscript, message }),
    });
    const extractPromise = fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, ledger, message, turn }),
    });

    try {
      const replyRes = await replyPromise;
      if (!replyRes.ok) throw new Error(String(replyRes.status));
      const reply = (await replyRes.json()) as PupilReply;
      setTranscript((t) => [...t, { role: "pupil", text: reply.reply }]);
    } catch {
      setError("Pip lost the thread. Your sentence is still in the notebook. Say the next one.");
    } finally {
      setPipThinking(false);
    }

    try {
      const exRes = await extractPromise;
      if (exRes.ok) {
        const { ledger: next } = (await exRes.json()) as { ledger: Belief[] };
        setLedger(next);
      }
    } catch {
      // extraction failure just means the notebook missed a beat
    } finally {
      setWritingNotes((n) => n - 1);
    }
  }

  async function sendToExam() {
    setPhase("exam");
    setExamStage("writing");
    setError(null);
    try {
      const res = await fetch("/api/exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, ledger }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? `request failed (${res.status})`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.kind === "stage") setExamStage(msg.stage);
          else if (msg.kind === "done") {
            setResult({ questions: msg.questions, answers: msg.answers, grades: msg.grades });
            setPhase("report");
          } else if (msg.kind === "error") throw new Error(msg.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "the exam hall caught fire");
      setPhase("lesson");
    }
  }

  function teachTheGaps() {
    setResult(null);
    setPhase("lesson");
    setTranscript((t) => [
      ...t,
      { role: "pupil", text: "Back from the exam. I have questions about the parts we never got to." },
    ]);
  }

  function reset() {
    setPhase("enroll");
    setTopic("");
    setTranscript([]);
    setLedger([]);
    setResult(null);
    turnRef.current = 0;
  }

  const score = result
    ? result.grades.reduce(
        (s, g) => s + (g.verdict === "correct" ? 1 : g.verdict === "partial" ? 0.5 : 0),
        0
      )
    : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between px-6 py-4">
          <span className="font-semibold tracking-tight">
            <Star filled /> Star Pupil
          </span>
          <span className="text-sm text-muted-foreground">
            the report card grades you
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {phase === "enroll" && (
          <section className="mx-auto max-w-xl">
            <h1 className="text-3xl font-semibold tracking-tight">
              Every AI wants to teach you. This one needs a teacher.
            </h1>
            <p className="mt-3 text-muted-foreground">
              Pip knows nothing. You explain, and every sentence you say becomes
              a belief in Pip&apos;s notebook — including the sloppy ones. Then
              Pip sits an exam alone, answering only from what you taught. The
              grade on the report card is yours.
            </p>
            <div className="mt-8 flex gap-2">
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && topic.trim() && enroll(topic)}
                placeholder="What are you teaching Pip today?"
              />
              <Button disabled={!topic.trim()} onClick={() => enroll(topic)}>
                Start the lesson
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Ideas:</span>
              {SUGGESTED.map((s) => (
                <Button key={s} variant="outline" size="sm" onClick={() => enroll(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </section>
        )}

        {phase === "lesson" && (
          <section className="grid gap-6 md:grid-cols-[1fr_340px]">
            <div>
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold tracking-tight">
                  Teaching Pip: {topic}
                </h2>
              </div>
              <div className="mt-4 flex min-h-[420px] flex-col gap-3 rounded-md border bg-card p-4">
                {transcript.map((t, i) => (
                  <div
                    key={i}
                    className={`max-w-[85%] rounded-md px-3 py-2 text-[15px] leading-6 ${
                      t.role === "teacher"
                        ? "self-end bg-primary text-primary-foreground"
                        : "self-start bg-secondary"
                    }`}
                  >
                    {t.role === "pupil" && (
                      <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Pip
                      </span>
                    )}
                    {t.text}
                  </div>
                ))}
                {pipThinking && (
                  <div className="self-start rounded-md bg-secondary px-3 py-2 text-sm text-muted-foreground">
                    <span className="animate-pulse">Pip is thinking…</span>
                  </div>
                )}
                {ledger.length === 0 && !pipThinking && (
                  <p className="mt-auto border-t pt-3 text-sm text-muted-foreground">
                    Teach three or four things, then send Pip to the exam. If you want to see what
                    this really does, slip one sloppy sentence in on purpose. Pip will believe it,
                    and the report card will quote it back to you.
                  </p>
                )}
              </div>
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
              <div className="mt-3 flex gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      teach();
                    }
                  }}
                  placeholder="Explain something. Pip believes exactly what you say."
                  className="min-h-20 bg-card"
                />
                <Button onClick={teach} disabled={!draft.trim() || pipThinking}>
                  Teach
                </Button>
              </div>
            </div>

            <aside>
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold tracking-tight">
                  Pip&apos;s notebook
                </h3>
                <span className="text-xs text-muted-foreground">
                  {writingNotes > 0 ? "writing…" : `${ledger.length} beliefs`}
                </span>
              </div>
              <div className="mt-4 min-h-[300px] rounded-md border bg-card p-4">
                {ledger.length === 0 && writingNotes === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Empty. Everything you teach lands here — correct, fuzzy, or
                    flat wrong.
                  </p>
                )}
                <div className="space-y-2">
                  {ledger.map((b) => (
                    <BeliefChip key={b.id} belief={b} />
                  ))}
                  {writingNotes > 0 && (
                    <p className="animate-pulse text-sm text-muted-foreground">
                      Pip is writing in the notebook…
                    </p>
                  )}
                </div>
              </div>
              <Button
                className="mt-4 w-full"
                size="lg"
                disabled={ledger.length < 3 || writingNotes > 0}
                onClick={sendToExam}
              >
                Send Pip to the exam
              </Button>
              {ledger.length < 3 && (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Teach at least three things first.
                </p>
              )}
            </aside>
          </section>
        )}

        {phase === "exam" && (
          <section className="mx-auto max-w-xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              Pip is in the exam hall
            </h2>
            <p className="mt-2 text-muted-foreground">You wait outside. No helping now.</p>
            <div className="mx-auto mt-8 max-w-sm space-y-2 text-left font-mono text-sm">
              <StageLine done={examStage !== "writing"} active={examStage === "writing"}>
                the examiner writes the paper
              </StageLine>
              <StageLine done={examStage === "grading"} active={examStage === "sitting"}>
                Pip answers from the notebook alone
              </StageLine>
              <StageLine done={false} active={examStage === "grading"}>
                red pen comes out
              </StageLine>
            </div>
          </section>
        )}

        {phase === "report" && result && (
          <section className="mx-auto max-w-2xl">
            <div className="rounded-md border-2 border-foreground bg-card p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Report card
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                    Pip — {topic}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Answered entirely from your teaching. Grade belongs to the teacher.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-5xl font-semibold">
                    {gradeLetter(score, result.questions.length)}
                  </div>
                  <div className="mt-1 text-sm tabular-nums text-muted-foreground">
                    {score}/{result.questions.length}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xl tracking-widest">
                {result.grades.map((g, i) => (
                  <Star key={i} filled={g.verdict === "correct"} />
                ))}
              </div>

              <Separator className="my-5" />

              <div className="space-y-5">
                {result.questions.map((q, i) => {
                  const g = result.grades[i];
                  const a = result.answers[i];
                  const culprit =
                    g.culpritBeliefId != null
                      ? ledger.find((b) => b.id === g.culpritBeliefId)
                      : undefined;
                  return (
                    <div key={i}>
                      <div className="flex items-center gap-2">
                        <VerdictChip verdict={g.verdict} />
                        <p className="text-sm font-medium">{q.q}</p>
                      </div>
                      <p className="mt-2 font-hand text-xl leading-6">
                        {a?.answer ?? "(no answer)"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{g.explanation}</p>
                      {culprit && (
                        <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
                          Traced to your lesson, turn {culprit.turn}: &ldquo;{culprit.quote}&rdquo;
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <Separator className="my-5" />
              <p className="font-hand text-2xl text-destructive">
                {score / result.questions.length >= 0.8
                  ? "A pleasure to teach. Whoever taught this child knew their stuff."
                  : score / result.questions.length >= 0.5
                    ? "Bright student, patchy lessons. See the red boxes above."
                    : "Pip tried. The teaching did not. Teach the gaps and send them back."}
              </p>
            </div>

            <div className="mt-6 flex gap-3">
              <Button onClick={teachTheGaps}>Teach the gaps, retake</Button>
              <Button variant="outline" onClick={reset}>
                New topic
              </Button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Star({ filled }: { filled: boolean }) {
  return (
    <span
      className={filled ? "text-[oklch(0.72_0.13_85)]" : "text-border"}
      aria-hidden
    >
      {"★"}
    </span>
  );
}

function VerdictChip({ verdict }: { verdict: GradedAnswer["verdict"] }) {
  const styles: Record<GradedAnswer["verdict"], string> = {
    correct: "border-[oklch(0.72_0.13_85)] text-[oklch(0.55_0.12_80)]",
    partial: "border-muted-foreground/50 text-muted-foreground",
    wrong: "border-destructive text-destructive",
    blank: "border-border text-muted-foreground",
  };
  return (
    <span
      className={`inline-block rounded-[3px] border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-widest ${styles[verdict]}`}
    >
      {verdict}
    </span>
  );
}

function BeliefChip({ belief }: { belief: Belief }) {
  const [open, setOpen] = useState(false);
  const mark =
    belief.status === "correct" ? (
      <Star filled />
    ) : belief.status === "wrong" ? (
      <span className="font-semibold text-destructive">{"✗"}</span>
    ) : (
      <span className="font-semibold text-muted-foreground">?</span>
    );
  return (
    <button
      onClick={() => setOpen(!open)}
      className={`block w-full rounded-md border p-2 text-left text-sm transition-colors hover:bg-secondary ${
        belief.status === "wrong" ? "border-destructive/50" : ""
      }`}
    >
      <span className="flex items-start gap-2">
        <span className="mt-0.5">{mark}</span>
        <span>
          <span className="font-medium">{belief.concept}</span>
          {open && (
            <>
              <span className="mt-1 block text-muted-foreground">{belief.statement}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                your words, turn {belief.turn}: &ldquo;{belief.quote}&rdquo;
              </span>
              {belief.status !== "correct" && (
                <span className="mt-1 block text-xs text-destructive">{belief.note}</span>
              )}
            </>
          )}
        </span>
      </span>
    </button>
  );
}

function StageLine({
  done,
  active,
  children,
}: {
  done: boolean;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <p className={active ? "animate-pulse" : done ? "" : "text-muted-foreground/50"}>
      {done ? "x " : active ? "> " : "  "}
      {children}
    </p>
  );
}
