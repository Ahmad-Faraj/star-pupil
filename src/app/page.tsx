"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
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
  rootCause,
} from "@/lib/student";
import { BeliefGraph } from "@/components/belief-graph";
import { Mood, PipFace } from "@/components/pip-face";
import { useSpeechInput } from "@/lib/use-speech-input";
import { downloadReportCard } from "@/lib/report-card-image";
import {
  SEED_ANSWERS,
  SEED_EXAM,
  SEED_GRADES,
  SEED_LEDGER,
  SEED_TOPIC,
  SEED_TRANSCRIPT,
} from "@/lib/seed-demo";

type Phase = "enroll" | "lesson" | "exam" | "report";
type Tab = "map" | "log";

interface DisplayTurn extends ChatTurn {
  checkin?: boolean;
}

interface ExamResult {
  questions: ExamQuestion[];
  answers: ExamAnswer[];
  grades: GradedAnswer[];
}

const SUGGESTED = ["photosynthesis", "binary search", "the French Revolution", "supply and demand"];

function scoreOf(grades: GradedAnswer[]): number {
  return grades.reduce(
    (s, g) => s + (g.verdict === "correct" ? 1 : g.verdict === "partial" ? 0.5 : 0),
    0
  );
}

function gradeLetter(score: number, total: number): string {
  const pct = total === 0 ? 0 : score / total;
  if (pct >= 0.9) return "A";
  if (pct >= 0.8) return "B+";
  if (pct >= 0.65) return "B";
  if (pct >= 0.5) return "C";
  if (pct >= 0.35) return "D";
  return "F";
}

// Coverage asks "how much of the subject did you actually teach"; accuracy
// asks "of what you taught, how much was right." A confessed gap counts
// against coverage but not accuracy — Pip refusing to guess is honest, not
// wrong.
function coverageStats(answers: ExamAnswer[], grades: GradedAnswer[]) {
  const total = grades.length;
  const covered = answers.filter((a) => !a.confessed).length;
  const coveredScore = grades.reduce(
    (s, g, i) =>
      !answers[i]?.confessed ? s + (g.verdict === "correct" ? 1 : g.verdict === "partial" ? 0.5 : 0) : s,
    0
  );
  return {
    coveragePct: total ? covered / total : 0,
    accuracyPct: covered ? coveredScore / covered : 0,
  };
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("enroll");
  const [topic, setTopic] = useState("");
  const [transcript, setTranscript] = useState<DisplayTurn[]>([]);
  const [ledger, setLedger] = useState<Belief[]>([]);
  const [draft, setDraft] = useState("");
  const [pipThinking, setPipThinking] = useState(false);
  const [writingNotes, setWritingNotes] = useState(0); // pending extractions
  const [examStage, setExamStage] = useState<string>("");
  const [result, setResult] = useState<ExamResult | null>(null);
  const [paper, setPaper] = useState<ExamQuestion[] | null>(null);
  const [prevReport, setPrevReport] = useState<GradedAnswer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("map");
  const [mood, setMood] = useState<Mood>("curious");
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinConcept, setCheckinConcept] = useState("");
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [paperPending, setPaperPending] = useState(false);
  const [selectedBelief, setSelectedBelief] = useState<number | null>(null);
  const [flashTurn, setFlashTurn] = useState<number | null>(null);
  const turnRef = useRef(0);
  const chatRef = useRef<HTMLDivElement>(null);
  // Whether the reader is parked at the bottom of the chat. New messages only
  // pull the scroll down when this is true, so scrolling up to reread an old
  // quote doesn't get yanked away by Pip's next reply.
  const stickRef = useRef(true);
  const paperTopicRef = useRef("");
  // Extraction is the slow call and Pip's reply is the fast one, so the teacher
  // can send the next sentence while the notebook is still being written. Both
  // guards below exist for that: the ref carries the newest ledger (state would
  // still be the one from render), and the queue keeps extractions in turn
  // order so a late reply cannot overwrite the beliefs an earlier one wrote.
  const ledgerRef = useRef<Belief[]>([]);
  const extractions = useRef<Promise<void>>(Promise.resolve());
  const speech = useSpeechInput((text) => setDraft((d) => (d ? `${d} ${text}` : text)));

  useEffect(() => {
    const el = chatRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [transcript, pipThinking]);

  function writeLedger(next: Belief[]) {
    ledgerRef.current = next;
    setLedger(next);
  }

  function enroll(t: string) {
    const subject = t.trim();
    setTopic(subject);
    setPhase("lesson");
    setTranscript([
      {
        role: "pupil",
        text: `Okay. I know nothing about ${subject}, and I mean nothing. Teach me.`,
      },
    ]);
    // The paper is written now, before any teaching, so it cannot be fitted to
    // the lesson. If this call fails the exam route writes one at exam time
    // instead — the lesson screen just never claims the seal.
    paperTopicRef.current = subject;
    setPaperPending(true);
    fetch("/api/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: subject }),
    })
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok && body.questions?.length && paperTopicRef.current === subject) {
          setPaper(body.questions as ExamQuestion[]);
        }
      })
      .catch(() => {})
      .finally(() => setPaperPending(false));
  }

  function loadSeedDemo() {
    setTopic(SEED_TOPIC);
    setTranscript(SEED_TRANSCRIPT);
    writeLedger(SEED_LEDGER);
    turnRef.current = 4;
    paperTopicRef.current = SEED_TOPIC;
    setPaper(SEED_EXAM);
    setResult({ questions: SEED_EXAM, answers: SEED_ANSWERS, grades: SEED_GRADES });
    setPrevReport(null);
    setError(null);
    setMood("curious");
    setPhase("report");
  }

  async function teach() {
    const message = draft.trim();
    if (!message || pipThinking) return;
    stickRef.current = true;
    setDraft("");
    setError(null);
    const turn = ++turnRef.current;
    const nextTranscript: DisplayTurn[] = [...transcript, { role: "teacher" as const, text: message }];
    setTranscript(nextTranscript);
    setPipThinking(true);
    setWritingNotes((n) => n + 1);

    const replyPromise = fetch("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        ledger: ledgerRef.current,
        transcript: nextTranscript,
        message,
      }),
    });

    extractions.current = extractions.current.then(async () => {
      try {
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, ledger: ledgerRef.current, message, turn }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `notebook failed (${res.status})`);
        writeLedger(body.ledger as Belief[]);
      } catch (e) {
        setError(
          e instanceof Error
            ? `Pip could not write that down. ${e.message}`
            : "Pip could not write that down."
        );
      } finally {
        setWritingNotes((n) => n - 1);
      }
    });

    try {
      const replyRes = await replyPromise;
      const body = await replyRes.json();
      if (!replyRes.ok) throw new Error(body?.error ?? `request failed (${replyRes.status})`);
      const reply = body as PupilReply;
      setMood(reply.mood);
      setTranscript((t) => [...t, { role: "pupil", text: reply.reply }]);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Pip lost the thread. ${e.message}`
          : "Pip lost the thread. Say the next one."
      );
    } finally {
      setPipThinking(false);
    }
  }

  async function checkUnderstanding() {
    if (!checkinConcept || checkinBusy) return;
    setCheckinBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, ledger: ledgerRef.current, concept: checkinConcept }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `request failed (${res.status})`);
      const reply = body as PupilReply;
      setMood(reply.mood);
      setTranscript((t) => [...t, { role: "pupil", text: reply.reply, checkin: true }]);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Pip could not explain that back. ${e.message}`
          : "Pip could not explain that back."
      );
    } finally {
      setCheckinBusy(false);
      setShowCheckin(false);
      setCheckinConcept("");
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
        body: JSON.stringify({ topic, ledger, paper }),
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
            setPaper(msg.questions);
            setPhase("report");
          } else if (msg.kind === "error") throw new Error(msg.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "the exam hall caught fire");
      setPhase("lesson");
    }
  }

  // A node and the sentence that created it are the same thing seen from two
  // sides. Selecting from either side highlights both: the map dims to the
  // belief's chain and the chat scrolls to the teacher's own words.
  function focusBelief(id: number | null) {
    setSelectedBelief(id);
    if (id == null) return;
    const belief = ledgerRef.current.find((b) => b.id === id);
    if (!belief) return;
    setTab("map");
    stickRef.current = false;
    chatRef.current
      ?.querySelector(`[data-turn="${belief.turn}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashTurn(belief.turn);
    window.setTimeout(() => setFlashTurn(null), 1400);
  }

  function teachTheGaps() {
    if (result) setPrevReport(result.grades);
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
    writeLedger([]);
    setResult(null);
    setPaper(null);
    setPrevReport(null);
    setError(null);
    setMood("curious");
    setSelectedBelief(null);
    setPaperPending(false);
    turnRef.current = 0;
    paperTopicRef.current = "";
  }

  function downloadCard() {
    if (!result) return;
    const wrongGrade = result.grades.find((g) => g.culpritBeliefId != null);
    const culprit =
      wrongGrade?.culpritBeliefId != null ? ledger.find((b) => b.id === wrongGrade.culpritBeliefId) : undefined;
    const root = culprit ? rootCause(ledger, culprit.id) : undefined;
    downloadReportCard({
      topic,
      grade: gradeLetter(score, result.questions.length),
      score,
      total: result.questions.length,
      starsFilled: result.grades.map((g) => g.verdict === "correct"),
      worstQuote: root ? { turn: root.turn, quote: root.quote } : undefined,
    });
  }

  const score = result ? scoreOf(result.grades) : 0;
  // Only comparable when the retake sat the same paper, which it does.
  const prevScore = prevReport ? scoreOf(prevReport) : null;
  const pct = result?.questions.length ? score / result.questions.length : 0;
  const stats = result ? coverageStats(result.answers, result.grades) : null;
  const concepts = Array.from(new Map(ledger.map((b) => [b.concept, b])).values());
  const beliefsByTurn = new Map<number, Belief[]>();
  for (const b of ledger) {
    const list = beliefsByTurn.get(b.turn) ?? [];
    list.push(b);
    beliefsByTurn.set(b.turn, list);
  }
  let teacherCount = 0;
  const turnOfIndex = transcript.map((t) => (t.role === "teacher" ? ++teacherCount : 0));

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
              a belief on Pip&apos;s live belief map — including the sloppy ones. Then
              Pip sits an exam alone, answering only from what you taught. The
              paper is written the moment you enroll, before your first sentence,
              so it cannot be bent around your lesson. The grade on the report
              card is yours.
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
            <div className="mt-6 border-t pt-4">
              <Button variant="link" size="sm" className="px-0" onClick={loadSeedDemo}>
                Skip the typing — watch a finished report card first
              </Button>
            </div>
          </section>
        )}

        {phase === "lesson" && (
          <section className="grid gap-6 md:grid-cols-[1fr_340px]">
            <div>
              <div className="flex items-center gap-2">
                <PipFace mood={mood} className="h-7 w-7 text-foreground" />
                <h2 className="text-lg font-semibold tracking-tight">
                  Teaching Pip: {topic}
                </h2>
              </div>
              <div
                ref={chatRef}
                onScroll={() => {
                  const el = chatRef.current;
                  if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                }}
                className="mt-4 flex h-[420px] flex-col gap-3 overflow-y-auto rounded-md border bg-card p-4"
              >
                {transcript.map((t, i) => {
                  const turn = turnOfIndex[i];
                  const noted = t.role === "teacher" ? (beliefsByTurn.get(turn) ?? []) : [];
                  return (
                    <div
                      key={i}
                      data-turn={t.role === "teacher" ? turn : undefined}
                      className={`max-w-[85%] rounded-md px-3 py-2 text-[15px] leading-6 transition-shadow ${
                        t.role === "teacher"
                          ? "self-end bg-primary text-primary-foreground"
                          : t.checkin
                            ? "self-start border border-dashed bg-secondary/60"
                            : "self-start bg-secondary"
                      } ${
                        t.role === "teacher" && flashTurn === turn
                          ? "ring-2 ring-[oklch(0.75_0.12_85)] ring-offset-2"
                          : ""
                      }`}
                    >
                      {t.role === "pupil" && (
                        <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t.checkin ? "Pip · checking understanding" : "Pip"}
                        </span>
                      )}
                      {t.text}
                      {noted.length > 0 && (
                        <span className="mt-1.5 flex items-center gap-1.5 border-t border-primary-foreground/15 pt-1.5">
                          <span className="text-[10px] uppercase tracking-wide text-primary-foreground/60">
                            in the notebook
                          </span>
                          {noted.map((b) => (
                            <button
                              key={b.id}
                              title={`${b.concept} (${b.status})`}
                              aria-label={`${b.concept} (${b.status})`}
                              onClick={() => focusBelief(b.id)}
                              className="h-2.5 w-2.5 rounded-full transition-transform hover:scale-125"
                              style={{
                                background:
                                  b.status === "correct"
                                    ? "oklch(0.8 0.13 85)"
                                    : b.status === "wrong"
                                      ? "oklch(0.62 0.19 27)"
                                      : "oklch(0.75 0.015 80)",
                              }}
                            />
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
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
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => (speech.listening ? speech.stop() : speech.start())}
                  disabled={!speech.supported}
                  title={speech.supported ? "Speak your explanation" : "Voice input not supported in this browser"}
                >
                  {speech.listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
                <Button onClick={teach} disabled={!draft.trim() || pipThinking}>
                  Teach
                </Button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={ledger.length === 0}
                  onClick={() => setShowCheckin((s) => !s)}
                >
                  Check understanding
                </Button>
                {showCheckin && (
                  <>
                    <select
                      value={checkinConcept}
                      onChange={(e) => setCheckinConcept(e.target.value)}
                      className="rounded-md border border-input bg-card px-2 py-1 text-sm"
                    >
                      <option value="">pick a concept…</option>
                      {concepts.map((c) => (
                        <option key={c.concept} value={c.concept}>
                          {c.concept}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" onClick={checkUnderstanding} disabled={!checkinConcept || checkinBusy}>
                      {checkinBusy ? "asking…" : "Ask Pip"}
                    </Button>
                  </>
                )}
              </div>
            </div>

            <aside>
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold tracking-tight">
                  Pip&apos;s belief map
                </h3>
                <span className="text-xs text-muted-foreground">
                  {writingNotes > 0 ? "writing…" : `${ledger.length} beliefs`}
                </span>
              </div>
              <div className="mt-2 flex gap-1">
                <Button
                  variant={tab === "map" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setTab("map")}
                >
                  Map
                </Button>
                <Button
                  variant={tab === "log" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setTab("log")}
                >
                  Log
                </Button>
              </div>
              <div className="mt-2 min-h-[300px] rounded-md border bg-card p-4">
                {tab === "map" ? (
                  <BeliefGraph beliefs={ledger} selected={selectedBelief} onSelect={focusBelief} />
                ) : (
                  <>
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
                  </>
                )}
              </div>
              <div className="mt-4 rounded-md border bg-card p-4">
                <div className="flex items-baseline justify-between">
                  <h4 className="text-sm font-semibold tracking-tight">The exam paper</h4>
                  <span className="text-xs text-muted-foreground">
                    {paperPending ? "being written…" : paper ? "sealed" : "written at exam time"}
                  </span>
                </div>
                {paperPending && (
                  <p className="mt-2 animate-pulse text-sm text-muted-foreground">
                    The examiner next door is writing the paper — from the subject, not from your
                    lesson.
                  </p>
                )}
                {!paperPending && paper && (
                  <>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {prevReport
                        ? "Same paper as last time. The retake grades the teaching, not new questions."
                        : `${paper.length} questions, written the moment you enrolled. Two are face up so you can see the paper is real. Pip sits exactly these.`}
                    </p>
                    <ol className="mt-3 space-y-2">
                      {paper.map((q, i) =>
                        i < 2 || prevReport ? (
                          <li key={i} className="flex gap-2 text-sm leading-5">
                            <span className="w-6 shrink-0 pt-px text-xs tabular-nums text-muted-foreground">
                              Q{i + 1}
                            </span>
                            <span>{q.q}</span>
                          </li>
                        ) : (
                          <li key={i} className="flex items-center gap-2">
                            <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                              Q{i + 1}
                            </span>
                            <span
                              className="h-3.5 rounded-[2px] bg-foreground/80"
                              style={{ width: `${58 + ((i * 17) % 30)}%` }}
                            />
                          </li>
                        )
                      )}
                    </ol>
                  </>
                )}
                {!paperPending && !paper && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    The examiner will write it when Pip walks in.
                  </p>
                )}
              </div>
              <Button
                className="mt-4 w-full"
                size="lg"
                disabled={ledger.length < 3 || writingNotes > 0 || paperPending}
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
            <PipFace mood="thinking" className="mx-auto h-10 w-10 text-foreground" />
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Pip is in the exam hall
            </h2>
            <p className="mt-2 text-muted-foreground">You wait outside. No helping now.</p>
            <div className="mx-auto mt-8 max-w-sm space-y-2 text-left font-mono text-sm">
              <StageLine done={examStage !== "writing"} active={examStage === "writing"}>
                {paper ? "the sealed paper is opened" : "the examiner writes the paper"}
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

        {phase === "report" && result && stats && (
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
                    {prevScore === null
                      ? "Answered entirely from your teaching. Grade belongs to the teacher."
                      : "Retake. Same paper, same pupil, better teaching."}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-5xl font-semibold">
                    {gradeLetter(score, result.questions.length)}
                  </div>
                  <div className="mt-1 text-sm tabular-nums text-muted-foreground">
                    {prevScore !== null && (
                      <span className="text-muted-foreground/60 line-through">
                        {prevScore}/{result.questions.length}
                      </span>
                    )}{" "}
                    {score}/{result.questions.length}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xl tracking-widest">
                {result.grades.map((g, i) => (
                  <Star key={i} filled={g.verdict === "correct"} />
                ))}
              </div>

              <div className="mt-4 flex gap-6 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Coverage</p>
                  <p className="font-medium tabular-nums">{Math.round(stats.coveragePct * 100)}%</p>
                  <p className="text-xs text-muted-foreground">of the subject you taught</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Accuracy</p>
                  <p className="font-medium tabular-nums">{Math.round(stats.accuracyPct * 100)}%</p>
                  <p className="text-xs text-muted-foreground">of what you taught was right</p>
                </div>
              </div>

              <Separator className="my-5" />

              <div className="space-y-5">
                {result.questions.map((q, i) => {
                  const g = result.grades[i];
                  const a = result.answers[i];
                  const before = prevReport?.[i];
                  const culprit =
                    g.culpritBeliefId != null
                      ? ledger.find((b) => b.id === g.culpritBeliefId)
                      : undefined;
                  const culpritRoot = culprit ? rootCause(ledger, culprit.id) : undefined;
                  return (
                    <div key={i}>
                      <div className="flex items-center gap-2">
                        {before && before.verdict !== g.verdict && (
                          <span className="text-xs text-muted-foreground/60 line-through">
                            {before.verdict}
                          </span>
                        )}
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
                      {culpritRoot && culprit && culpritRoot.id !== culprit.id && (
                        <p className="mt-1 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                          That belief was itself built on turn {culpritRoot.turn}: &ldquo;{culpritRoot.quote}&rdquo;
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <Separator className="my-5" />
              <p className="font-hand text-2xl text-destructive">
                {pct >= 0.8
                  ? "A pleasure to teach. Whoever taught this child knew their stuff."
                  : pct >= 0.5
                    ? "Bright student, patchy lessons. See the red boxes above."
                    : "Pip tried. The teaching did not. Teach the gaps and send them back."}
              </p>
            </div>

            <div className="mt-6 flex gap-3">
              <Button onClick={teachTheGaps}>Teach the gaps, retake</Button>
              <Button variant="outline" onClick={downloadCard}>
                Download report card
              </Button>
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
