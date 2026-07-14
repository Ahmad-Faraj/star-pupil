"use client";

import { useEffect, useRef, useState } from "react";
import { NotebookPen, PencilLine, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Mood, PipFace, PipSitting } from "@/components/pip-face";
import { downloadReportCard, StarFill } from "@/lib/report-card-image";
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
  mood?: Mood; // the face Pip made saying it; frozen into the bubble's avatar
}

interface ExamResult {
  questions: ExamQuestion[];
  answers: ExamAnswer[];
  grades: GradedAnswer[];
}

// Everything needed to survive a refresh mid-lesson. A session interrupted
// mid-exam restores to the lesson — the exam stream is gone either way.
interface SavedSession {
  phase: Phase;
  topic: string;
  transcript: DisplayTurn[];
  ledger: Belief[];
  paper: ExamQuestion[] | null;
  prevReport: GradedAnswer[] | null;
  result: ExamResult | null;
  turn: number;
  // Whether the seal was actually shown during the lesson. A paper written at
  // exam time (enrollment call failed) has a hash too, but the report must not
  // claim "you saw this at enrollment" about a paper nobody saw.
  sealSeen?: boolean;
}

const STORAGE_KEY = "star-pupil-session";

// Short human-readable fingerprint of the sealed paper's questions. Shown at
// enrollment and repeated on the report card: the same eight characters on
// both is the receipt that Pip sat the paper you saw before you taught.
async function sealOf(questions: ExamQuestion[]): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(questions.map((q) => q.q)));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SUGGESTED = ["photosynthesis", "binary search", "the French Revolution", "supply and demand"];

function scoreOf(grades: GradedAnswer[]): number {
  return grades.reduce(
    (s, g) => s + (g.verdict === "correct" ? 1 : g.verdict === "partial" ? 0.5 : 0),
    0
  );
}

// A partial mark is half a point in scoreOf, so it must be half a star too —
// five gold stars next to "5.5/6" reads like a math error.
function starOf(verdict: GradedAnswer["verdict"]): StarFill {
  return verdict === "correct" ? "full" : verdict === "partial" ? "half" : "empty";
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
  const [sealHash, setSealHash] = useState<string | null>(null);
  const [sealSeen, setSealSeen] = useState(false);
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

  useEffect(() => {
    const el = chatRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [transcript, pipThinking]);

  // Restore a session that a refresh would otherwise have destroyed. This is
  // a one-time read of an external store on mount; the cascading-render cost
  // is the point (hydrate, then re-render restored).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as SavedSession;
      if (s.phase === "enroll" || !s.topic || !s.transcript?.length) return;
      setTopic(s.topic);
      setTranscript(s.transcript);
      writeLedger(s.ledger ?? []);
      setPaper(s.paper ?? null);
      setPrevReport(s.prevReport ?? null);
      setResult(s.result ?? null);
      turnRef.current = s.turn ?? 0;
      paperTopicRef.current = s.topic;
      if (s.paper?.length && s.sealSeen) {
        setSealSeen(true);
        sealOf(s.paper).then(setSealHash);
      }
      setPhase(s.phase === "report" && s.result ? "report" : "lesson");
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (phase === "enroll") {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const session: SavedSession = {
      phase: phase === "exam" ? "lesson" : phase,
      topic,
      transcript,
      ledger,
      paper,
      prevReport,
      result,
      turn: turnRef.current,
      sealSeen,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // storage full or blocked — the app just loses refresh insurance
    }
  }, [phase, topic, transcript, ledger, paper, prevReport, result, sealSeen]);

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
          const questions = body.questions as ExamQuestion[];
          setPaper(questions);
          setSealSeen(true);
          sealOf(questions).then(setSealHash);
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
    setSealSeen(true); // the seed replays a session where the seal was shown
    sealOf(SEED_EXAM).then(setSealHash);
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
      setTranscript((t) => [...t, { role: "pupil", text: reply.reply, mood: reply.mood }]);
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
    if (!checkinConcept.trim() || checkinBusy) return;
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
      setTranscript((t) => [...t, { role: "pupil", text: reply.reply, checkin: true, mood: reply.mood }]);
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
  // sides. Selecting a belief anywhere — map row, notebook line, chat dot —
  // expands its file in place: statement, status, quote, ancestry. Selecting
  // it again folds it back; the map stays dimmed to the belief's chain while
  // it is open, and clicking the map's background clears that.
  function focusBelief(id: number | null) {
    setSelectedBelief((cur) => (id !== null && cur === id ? null : id));
  }

  // From the belief's file back to the moment it was taught: scroll the chat
  // to the teacher's own sentence and flash it.
  function revealInLesson(belief: Belief) {
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
    setDraft("");
    setResult(null);
    setPaper(null);
    setPrevReport(null);
    setError(null);
    setMood("curious");
    setSelectedBelief(null);
    setShowCheckin(false);
    setCheckinConcept("");
    setPaperPending(false);
    setSealHash(null);
    setSealSeen(false);
    turnRef.current = 0;
    paperTopicRef.current = "";
  }

  function downloadCard() {
    if (!result) return;
    const wrongGrade = result.grades.find((g) => g.culpritBeliefId != null);
    const culprit =
      wrongGrade?.culpritBeliefId != null ? ledger.find((b) => b.id === wrongGrade.culpritBeliefId) : undefined;
    const root = culprit ? rootCause(ledger, culprit.id) : undefined;
    const total = result.questions.length;
    const pctForCard = total ? scoreOf(result.grades) / total : 0;
    downloadReportCard({
      topic,
      grade: gradeLetter(score, total),
      score,
      total,
      stars: result.grades.map((g) => starOf(g.verdict)),
      worstQuote: root ? { turn: root.turn, quote: root.quote } : undefined,
      face: pctForCard >= 0.8 ? "proud" : pctForCard >= 0.5 ? "okay" : "worried",
      seal: sealHash ?? undefined,
    });
  }

  const score = result ? scoreOf(result.grades) : 0;
  // Only comparable when the retake sat the same paper, which it does.
  const prevScore = prevReport ? scoreOf(prevReport) : null;
  const pct = result?.questions.length ? score / result.questions.length : 0;
  const stats = result ? coverageStats(result.answers, result.grades) : null;
  const concepts = Array.from(new Map(ledger.map((b) => [b.concept, b])).values());
  const beliefCount = `${ledger.length} ${ledger.length === 1 ? "belief" : "beliefs"}`;
  const openBelief = selectedBelief != null ? ledger.find((b) => b.id === selectedBelief) : undefined;
  const openBeliefRoot = openBelief ? rootCause(ledger, openBelief.id) : undefined;
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
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <PipFace
              mood={phase === "exam" ? "thinking" : phase === "lesson" ? mood : "curious"}
              className="h-6 w-6 text-foreground"
            />
            Star Pupil
          </span>
          <span className="text-sm text-muted-foreground">
            {phase === "lesson" ? (
              <>
                teaching <span className="text-foreground">{topic}</span>
                {" · "}
                {writingNotes > 0 ? "Pip is writing…" : beliefCount}
              </>
            ) : phase === "exam" ? (
              "exam in progress — no helping"
            ) : phase === "report" ? (
              <>
                report card · <span className="text-foreground">{topic}</span>
              </>
            ) : (
              "the report card grades you"
            )}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {phase === "enroll" && (
          <section className="mx-auto max-w-xl animate-in fade-in slide-in-from-bottom-2 duration-500">
            <PipSitting mood="curious" className="w-36 text-foreground" />
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
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
          <section className="grid items-start gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500 md:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
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
                aria-live="polite"
                className="mt-4 flex h-[clamp(420px,60vh,680px)] flex-col gap-3 overflow-y-auto rounded-md border bg-card p-4"
              >
                {transcript.map((t, i) => {
                  const turn = turnOfIndex[i];
                  const noted = t.role === "teacher" ? (beliefsByTurn.get(turn) ?? []) : [];
                  const bubble = (
                    <div
                      data-turn={t.role === "teacher" ? turn : undefined}
                      className={`rounded-md px-3 py-2 text-[15px] leading-6 transition-shadow ${
                        t.role === "teacher"
                          ? "bg-primary text-primary-foreground"
                          : t.checkin
                            ? "border border-dashed bg-secondary/60"
                            : "bg-secondary"
                      } ${
                        t.role === "teacher" && flashTurn === turn
                          ? "ring-2 ring-ring ring-offset-2"
                          : ""
                      }`}
                    >
                      {t.checkin && (
                        <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          checking understanding
                        </span>
                      )}
                      {t.text}
                      {noted.length > 0 && (
                        <span className="mt-1.5 flex items-center gap-1.5 border-t border-primary-foreground/15 pt-1.5 animate-in fade-in duration-500">
                          <PencilLine className="h-3 w-3 text-primary-foreground/60" aria-hidden />
                          <span className="text-[10px] uppercase tracking-wide text-primary-foreground/60">
                            in the notebook
                          </span>
                          {noted.map((b) => (
                            <button
                              key={b.id}
                              title={`${b.concept} (${b.status})`}
                              aria-label={`${b.concept} (${b.status})`}
                              onClick={() => {
                                // The expansion lives in the sidebar, so make
                                // sure the tab showing it is the open one.
                                setTab("map");
                                setSelectedBelief(b.id);
                              }}
                              className="-my-1.5 p-1.5 transition-transform hover:scale-125"
                            >
                              <span
                                className="block h-2.5 w-2.5 rounded-full"
                                style={{
                                  background:
                                    b.status === "correct"
                                      ? "oklch(0.8 0.13 85)"
                                      : b.status === "wrong"
                                        ? "oklch(0.62 0.19 27)"
                                        : "oklch(0.75 0.015 80)",
                                }}
                              />
                            </button>
                          ))}
                        </span>
                      )}
                    </div>
                  );
                  return t.role === "teacher" ? (
                    <div key={i} className="max-w-[85%] self-end animate-in fade-in slide-in-from-bottom-1 duration-300">
                      {bubble}
                    </div>
                  ) : (
                    <div key={i} className="flex max-w-[85%] items-end gap-1.5 self-start animate-in fade-in slide-in-from-bottom-1 duration-300">
                      <PipFace mood={t.mood ?? "curious"} className="mb-0.5 h-6 w-6 shrink-0 text-foreground" />
                      {bubble}
                    </div>
                  );
                })}
                {pipThinking && (
                  <div className="flex items-center gap-1.5 self-start animate-in fade-in slide-in-from-bottom-1 duration-300">
                    <PipFace mood="thinking" className="h-6 w-6 shrink-0 text-foreground" />
                    <div className="rounded-md bg-secondary px-3 py-2 text-sm text-muted-foreground">
                      <span className="animate-pulse">Pip is thinking…</span>
                    </div>
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
                  <PencilLine className="h-4 w-4" aria-hidden /> Teach
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
                    <Input
                      list="pip-concepts"
                      value={checkinConcept}
                      onChange={(e) => setCheckinConcept(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && checkUnderstanding()}
                      placeholder="anything — even something you never taught"
                      className="h-8 w-64 bg-card text-sm"
                    />
                    <datalist id="pip-concepts">
                      {concepts.map((c) => (
                        <option key={c.concept} value={c.concept} />
                      ))}
                    </datalist>
                    <Button size="sm" onClick={checkUnderstanding} disabled={!checkinConcept.trim() || checkinBusy}>
                      {checkinBusy ? "asking…" : "Ask Pip"}
                    </Button>
                  </>
                )}
              </div>
            </div>

            <aside className="md:sticky md:top-[72px]">
              <PipSitting
                mood={pipThinking ? "thinking" : mood}
                writing={writingNotes > 0}
                className="mx-auto w-32 text-foreground"
              />
              <div className="mt-3 flex items-baseline justify-between">
                <h3 className="text-lg font-semibold tracking-tight">
                  Inside Pip&apos;s head
                </h3>
                <span className="text-xs text-muted-foreground">
                  {writingNotes > 0 ? "writing…" : beliefCount}
                </span>
              </div>
              <div className="mt-2 flex gap-1">
                <Button
                  variant={tab === "map" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setTab("map")}
                >
                  <Waypoints className="h-3 w-3" aria-hidden /> Map
                </Button>
                <Button
                  variant={tab === "log" ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setTab("log")}
                >
                  <NotebookPen className="h-3 w-3" aria-hidden /> Notebook
                </Button>
              </div>
              {tab === "map" ? (
                <div key="map" className="mt-2 flex min-h-[300px] flex-col rounded-md border bg-card p-4 animate-in fade-in duration-200">
                  <BeliefGraph beliefs={ledger} selected={selectedBelief} onSelect={focusBelief} />
                  {openBelief && (
                    <BeliefFile
                      belief={openBelief}
                      root={openBeliefRoot}
                      onReveal={() => revealInLesson(openBelief)}
                      onClose={() => focusBelief(null)}
                    />
                  )}
                </div>
              ) : (
                <div key="log" className="paper-ruled mt-2 min-h-[300px] rounded-md border pb-2 text-[17px] leading-8 animate-in fade-in duration-200">
                  {ledger.length === 0 && writingNotes === 0 && (
                    <p className="pl-10 pr-3 font-hand text-muted-foreground">
                      Nothing yet. Everything you teach lands on these lines —
                      correct, fuzzy, or flat wrong.
                    </p>
                  )}
                  {ledger.map((b) => (
                    <BeliefChip
                      key={b.id}
                      belief={b}
                      open={selectedBelief === b.id}
                      root={selectedBelief === b.id ? rootCause(ledger, b.id) : undefined}
                      onToggle={() => focusBelief(b.id)}
                      onReveal={() => revealInLesson(b)}
                    />
                  ))}
                  {writingNotes > 0 && (
                    <p className="animate-pulse pl-10 pr-3 font-hand text-muted-foreground">
                      Pip is writing…
                    </p>
                  )}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 rounded-md border bg-card py-2 pl-3 pr-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold tracking-tight">The exam paper</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {paperPending
                      ? "being written next door…"
                      : paper
                        ? `${paper.length} questions${sealSeen ? ` · seal ${sealHash ?? "…"}` : ""}`
                        : "written when Pip walks in"}
                  </p>
                </div>
                {paperPending && (
                  <span className="animate-pulse text-xs text-muted-foreground">writing…</span>
                )}
                {!paperPending && paper && (
                  <Dialog>
                    <DialogTrigger
                      render={
                        <Button variant="outline" size="sm">
                          <span className="-rotate-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-destructive/80">
                            Sealed
                          </span>
                          Read it
                        </Button>
                      }
                    />
                    <DialogContent className="bg-[oklch(0.99_0.005_95)] sm:max-w-md">
                      {/* The sheet itself, set like a printed paper: serif, board
                          header, double rule, marks in the gutter. */}
                      <div className="relative px-2 py-1 font-serif">
                        <span
                          aria-hidden
                          className="absolute -top-1 left-0 -rotate-6 rounded-[2px] border-2 border-destructive/60 px-1.5 py-0.5 text-[9px] font-sans font-semibold uppercase tracking-[0.18em] text-destructive/80"
                        >
                          Sealed
                        </span>
                        <DialogHeader className="gap-0.5 text-center sm:text-center">
                          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                            Star Pupil Examination Board
                          </p>
                          <DialogTitle className="font-serif text-lg capitalize">{topic}</DialogTitle>
                          <DialogDescription className="text-xs italic">
                            Candidate: Pip · Answer all questions · Notebook only, no outside knowledge
                          </DialogDescription>
                        </DialogHeader>
                        <div className="mt-3 border-y-[3px] border-double border-foreground/50 py-1 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                          {prevReport ? "Retake — same paper, second sitting" : "Written at enrollment, before the first lesson"}
                        </div>
                        <ol className="mt-4 space-y-3">
                          {paper.map((q, i) =>
                            i < 2 || prevReport ? (
                              <li
                                key={i}
                                className="flex gap-3 text-sm leading-5 animate-in fade-in fill-mode-backwards duration-300"
                                style={{ animationDelay: `${i * 60}ms` }}
                              >
                                <span className="w-4 shrink-0 pt-px text-sm tabular-nums">{i + 1}.</span>
                                <span className="flex-1">{q.q}</span>
                                <span className="shrink-0 self-start whitespace-nowrap text-[10px] italic text-muted-foreground">
                                  [1 mark]
                                </span>
                              </li>
                            ) : (
                              <li
                                key={i}
                                className="flex items-center gap-3 animate-in fade-in fill-mode-backwards duration-300"
                                style={{ animationDelay: `${i * 60}ms` }}
                              >
                                <span className="w-4 shrink-0 text-sm tabular-nums">{i + 1}.</span>
                                <span
                                  className="h-3.5 rounded-[2px] bg-foreground/80"
                                  style={{ width: `${52 + ((i * 17) % 30)}%` }}
                                />
                                <span className="shrink-0 whitespace-nowrap text-[10px] italic text-muted-foreground">
                                  [1 mark]
                                </span>
                              </li>
                            )
                          )}
                        </ol>
                        <div className="mt-4 flex items-baseline justify-between border-t pt-2 text-[10px] text-muted-foreground">
                          <span className="font-mono">seal {sealHash ?? "—"}</span>
                          <span className="italic">Total: {paper.length} marks · End of paper</span>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <Button
                className="mt-3 w-full"
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
          <section className="mx-auto max-w-xl text-center animate-in fade-in duration-500">
            <PipSitting
              mood="thinking"
              writing={examStage === "sitting"}
              className="mx-auto w-40 text-foreground"
            />
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Pip is in the exam hall
            </h2>
            <p className="mt-2 text-muted-foreground">You wait outside. No helping now.</p>
            <div className="mx-auto mt-8 max-w-sm space-y-2 text-left font-mono text-sm">
              <StageLine done={examStage !== "writing"} active={examStage === "writing"}>
                {paper
                  ? `the sealed paper is opened${sealHash ? ` (seal ${sealHash})` : ""}`
                  : "the examiner writes the paper"}
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
          <section className="mx-auto max-w-2xl animate-in fade-in slide-in-from-bottom-3 duration-700">
            <div className="rounded-md border-2 border-foreground bg-card p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <PipFace
                    mood={pct >= 0.8 ? "lightbulb" : pct >= 0.5 ? "curious" : "worried"}
                    className="mt-1 h-12 w-12 shrink-0 text-foreground"
                  />
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
                    {sealHash && sealSeen && (
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        paper seal {sealHash} — the same paper you saw at enrollment
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-5xl font-semibold animate-in zoom-in-75 fade-in fill-mode-backwards delay-300 duration-500">
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
                  <span
                    key={i}
                    className="inline-block animate-in zoom-in fade-in fill-mode-backwards duration-300"
                    style={{ animationDelay: `${300 + i * 90}ms` }}
                  >
                    <Star fill={starOf(g.verdict)} />
                  </span>
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
                    <div
                      key={i}
                      className="animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards duration-300"
                      style={{ animationDelay: `${400 + i * 80}ms` }}
                    >
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
                        <p className="mt-2 border-l-2 border-destructive/50 pl-3 font-hand text-lg leading-6 text-destructive animate-in fade-in slide-in-from-left-2 fill-mode-backwards delay-700 duration-400">
                          {"✗ "}Traced to your lesson, turn {culprit.turn}:{" "}
                          <span className="underline decoration-destructive/50 decoration-wavy underline-offset-4">
                            &ldquo;{culprit.quote}&rdquo;
                          </span>
                        </p>
                      )}
                      {culpritRoot && culprit && culpritRoot.id !== culprit.id && (
                        <p className="mt-1 border-l-2 border-destructive/25 pl-3 font-hand text-base leading-5 text-destructive/80 animate-in fade-in slide-in-from-left-2 fill-mode-backwards delay-1000 duration-400">
                          which was itself built on turn {culpritRoot.turn}:{" "}
                          <span className="underline decoration-destructive/40 decoration-wavy underline-offset-4">
                            &ldquo;{culpritRoot.quote}&rdquo;
                          </span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <Separator className="my-5" />
              <p className="font-hand text-2xl text-destructive animate-in fade-in fill-mode-backwards delay-1000 duration-700">
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

// One belief's file, expanded in place under the map. The same sticky-note
// quote the modal used to carry, just living inside the panel now.
function BeliefFile({
  belief,
  root,
  onReveal,
  onClose,
}: {
  belief: Belief;
  root: Belief | undefined;
  onReveal: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-3 border-t pt-3 animate-in fade-in slide-in-from-bottom-1 duration-200">
      <div className="flex items-center gap-2">
        <BeliefStatusChip status={belief.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{belief.concept}</span>
        <button
          onClick={onClose}
          aria-label="fold the belief back up"
          className="px-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          {"×"}
        </button>
      </div>
      <p className="mt-2 font-hand text-lg leading-6">{belief.statement}</p>
      <div className="relative mt-2 max-w-[95%] -rotate-[0.8deg] rounded-[1px] bg-[oklch(0.955_0.07_100)] p-2.5 pt-3 text-xs leading-4 text-[oklch(0.42_0.02_75)] shadow-[1px_3px_7px_oklch(0.26_0.015_70_/_0.18)]">
        <span
          aria-hidden
          className="absolute -top-1.5 left-1/2 h-3 w-12 -translate-x-1/2 rotate-[2deg] rounded-[1px] bg-[oklch(0.93_0.015_95_/_0.75)] shadow-[0_1px_2px_oklch(0.26_0.015_70_/_0.12)]"
        />
        your words, turn {belief.turn}: &ldquo;{belief.quote}&rdquo;
      </div>
      {belief.status !== "correct" && belief.note && (
        <p className="mt-2 text-xs text-destructive">{belief.note}</p>
      )}
      {root && root.id !== belief.id && (
        <p className="mt-2 border-l-2 border-destructive/40 pl-2 text-xs text-destructive">
          built on a shakier belief, turn {root.turn}: &ldquo;{root.quote}&rdquo;
        </p>
      )}
      <Button variant="outline" size="sm" className="mt-3" onClick={onReveal}>
        See it in the lesson
      </Button>
    </div>
  );
}

function BeliefStatusChip({ status }: { status: Belief["status"] }) {
  const styles: Record<Belief["status"], string> = {
    correct: "border-[oklch(0.72_0.13_85)] text-[oklch(0.55_0.12_80)]",
    wrong: "border-destructive text-destructive",
    fuzzy: "border-dashed border-muted-foreground/50 text-muted-foreground",
  };
  return (
    <span
      className={`inline-block shrink-0 rounded-[3px] border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-widest ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function Star({ fill }: { fill: StarFill }) {
  if (fill === "half") {
    // A hollow star with its left half painted gold — the clip does the work.
    return (
      <span className="relative inline-block" aria-hidden>
        <span className="text-border">{"★"}</span>
        <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden text-[oklch(0.72_0.13_85)]">
          {"★"}
        </span>
      </span>
    );
  }
  return (
    <span
      className={fill === "full" ? "text-[oklch(0.72_0.13_85)]" : "text-border"}
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

// One line in Pip's notebook, written like real notes: a bullet per belief.
// The bullet doubles as the grade — casual black • for ordinary notes, gold ★
// where the teaching was right, red ✗ where it went wrong (no green: gold
// already means "correct" everywhere in this app). Clicking a line unfolds
// the full note right there on the page; clicking again folds it back. The
// detail lines stay in the hand font at the ruled line-height so they sit on
// the paper's rules like the rest of the notebook.
function BeliefChip({
  belief,
  open,
  root,
  onToggle,
  onReveal,
}: {
  belief: Belief;
  open: boolean;
  root: Belief | undefined;
  onToggle: () => void;
  onReveal: () => void;
}) {
  const bullet =
    belief.status === "correct" ? (
      <Star fill="full" />
    ) : belief.status === "wrong" ? (
      <span className="font-semibold text-destructive">{"✗"}</span>
    ) : (
      <span className="text-foreground/80">{"•"}</span>
    );
  return (
    <div className={open ? "bg-foreground/[0.03]" : undefined}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="block w-full text-left transition-colors hover:bg-foreground/[0.04]"
      >
        <span className="flex">
          <span className="w-9 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 pr-3">
            <span className={`font-hand text-[19px] ${belief.status === "wrong" ? "text-destructive" : ""}`}>
              <span className="mr-1.5 inline-block w-4 text-center font-sans text-[15px]">{bullet}</span>
              {belief.concept}
            </span>
          </span>
        </span>
      </button>
      {open && (
        <div className="flex animate-in fade-in slide-in-from-top-1 duration-200">
          <span className="w-9 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 pb-1 pr-3">
            <p className="font-hand text-[17px]">{belief.statement}</p>
            <p className="font-hand text-[15px] text-muted-foreground">
              your words, turn {belief.turn}: &ldquo;{belief.quote}&rdquo;
            </p>
            {belief.status !== "correct" && belief.note && (
              <p className="font-hand text-[15px] text-destructive">{belief.note}</p>
            )}
            {root && root.id !== belief.id && (
              <p className="font-hand text-[15px] text-destructive/80">
                built on turn {root.turn}: &ldquo;{root.quote}&rdquo;
              </p>
            )}
            <button
              onClick={onReveal}
              className="font-hand text-[15px] underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
            >
              see it in the lesson
            </button>
          </div>
        </div>
      )}
    </div>
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
    <p
      className={`transition-colors duration-300 ${
        active ? "animate-pulse" : done ? "" : "text-muted-foreground/50"
      }`}
    >
      {done ? "x " : active ? "> " : "  "}
      {children}
    </p>
  );
}
