"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Maximize2, NotebookPen, PencilLine, SkipForward, Waypoints } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Belief,
  ChatTurn,
  ExamAnswer,
  Dispute,
  ExamQuestion,
  GradedAnswer,
  PupilReply,
  SyllabusNode,
  conceptStates,
  frontierOf,
  rootCause,
} from "@/lib/student";
import { BeliefMap, MapLegend, Trace, keyOfBelief } from "@/components/belief-map";
import { Mood, PipDesk, PipFace } from "@/components/pip-face";
import { downloadReportCard, StarFill } from "@/lib/report-card-image";
import {
  SEED_ANSWERS,
  SEED_EXAM,
  SEED_GRADES,
  SEED_LEDGER,
  SEED_SYLLABUS,
  SEED_TOPIC,
  SEED_TRANSCRIPT,
} from "@/lib/seed-demo";

type Phase = "enroll" | "lesson" | "exam" | "report";

interface DisplayTurn extends ChatTurn {
  // Pip talking because he was asked to, rather than because he was taught
  // something: the bubble is drawn dashed either way, but it has to say which.
  checkin?: boolean;
  kind?: "checkin" | "dispute";
  mood?: Mood; // the face he wore saying it, frozen into the bubble's avatar
}

interface ExamResult {
  questions: ExamQuestion[];
  answers: ExamAnswer[];
  grades: GradedAnswer[];
}

// Everything needed to survive a refresh mid-lesson. A session interrupted
// mid-exam restores to the lesson: the exam stream is gone either way.
interface SavedSession {
  phase: Phase;
  topic: string;
  transcript: DisplayTurn[];
  ledger: Belief[];
  syllabus: SyllabusNode[];
  paper: ExamQuestion[] | null;
  prevReport: GradedAnswer[] | null;
  result: ExamResult | null;
  turn: number;
  startedAt: number;
  // Whether the seal was actually shown during the lesson. A paper written at
  // exam time (enrollment call failed) has a hash too, but the report must not
  // claim "you saw this at enrollment" about a paper nobody saw.
  sealSeen?: boolean;
}

const STORAGE_KEY = "star-pupil-session";

// Short human-readable fingerprint of the sealed documents. Shown at enrollment
// and repeated on the report card: the same eight characters on both is the
// receipt that Pip sat the paper you saw before you taught.
//
// It covers the map and the mark scheme, not just the question text, and that
// is the point. A seal over the questions alone leaves the obvious objection
// open: fix the questions, then decide after the lesson what counts as a right
// answer, or quietly redraw the subject around what got taught. All three are
// written at enrollment, so all three go under one seal.
async function sealOf(questions: ExamQuestion[], syllabus: SyllabusNode[]): Promise<string> {
  const data = new TextEncoder().encode(
    JSON.stringify([
      syllabus.map((n) => [n.id, n.label, n.requires]),
      questions.map((q) => [q.q, q.lookingFor, q.nodeId ?? ""]),
    ])
  );
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

// A partial mark is half a point in scoreOf, so it must be half a star too.
// Five gold stars next to "5.5/6" reads like a math error.
function starOf(verdict: GradedAnswer["verdict"]): StarFill {
  return verdict === "correct" ? "full" : verdict === "partial" ? "half" : "empty";
}

// The face Pip makes about a batch of beliefs. He starts shy and pleased to be
// here, is happy when what landed was sound, and goes confused the moment you
// teach him something wrong. One bad belief in the batch outranks any number of
// good ones, which is the honest reading: he is confused *about something*.
function moodOfBeliefs(beliefs: Belief[], taughtAnything: number): Mood {
  if (!beliefs.length) return taughtAnything === 0 ? "shy" : "listening";
  if (beliefs.some((b) => b.status === "wrong")) return "confused";
  if (beliefs.some((b) => b.status === "fuzzy")) return "worried";
  return "happy";
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
// against coverage but not accuracy. Pip refusing to guess is honest, not
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
  const [syllabus, setSyllabus] = useState<SyllabusNode[]>([]);
  const [draft, setDraft] = useState("");
  const [pipThinking, setPipThinking] = useState(false);
  const [writingNotes, setWritingNotes] = useState(0); // pending extractions
  const [examStage, setExamStage] = useState<string>("");
  const [examScript, setExamScript] = useState<ExamAnswer[]>([]); // Pip's answers, live
  const [result, setResult] = useState<ExamResult | null>(null);
  const [paper, setPaper] = useState<ExamQuestion[] | null>(null);
  const [prevReport, setPrevReport] = useState<GradedAnswer[] | null>(null);
  const [tab, setTab] = useState("map");
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinConcept, setCheckinConcept] = useState("");
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [paperPending, setPaperPending] = useState(false);
  const [sealHash, setSealHash] = useState<string | null>(null);
  const [sealSeen, setSealSeen] = useState(false);
  // What the map, the notebook and the chat dots all point at: a syllabus
  // concept's id, or one off-syllabus belief's key. One selection, three views.
  const [selected, setSelected] = useState<string | null>(null);
  const [flashTurn, setFlashTurn] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  // Which answer's working is open on the report card, and the argument the
  // teacher is currently having with one of Pip's notes.
  const [showWorking, setShowWorking] = useState<number | null>(null);
  const [arguing, setArguing] = useState<number | null>(null);
  const [objection, setObjection] = useState("");
  const [disputeBusy, setDisputeBusy] = useState(false);
  const turnRef = useRef(0);
  const chatRef = useRef<HTMLDivElement>(null);
  const reportMapRef = useRef<HTMLDivElement>(null);
  // Whether the reader is parked at the bottom of the chat. New messages only
  // pull the scroll down when this is true, so scrolling up to reread an old
  // quote doesn't get yanked away by Pip's next reply.
  const stickRef = useRef(true);
  const paperTopicRef = useRef("");
  // Extraction is the slow call and Pip's reply is the fast one, so the teacher
  // can send the next sentence while the notebook is still being written. Both
  // guards below exist for that: the refs carry the newest ledger and syllabus
  // (state would still be the one from render), and the queue keeps extractions
  // in turn order so a late reply cannot overwrite the beliefs an earlier one
  // wrote.
  const ledgerRef = useRef<Belief[]>([]);
  const syllabusRef = useRef<SyllabusNode[]>([]);
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
      writeSyllabus(s.syllabus ?? []);
      setPaper(s.paper ?? null);
      setPrevReport(s.prevReport ?? null);
      setResult(s.result ?? null);
      setStartedAt(s.startedAt || Date.now());
      turnRef.current = s.turn ?? 0;
      paperTopicRef.current = s.topic;
      if (s.paper?.length && s.sealSeen) {
        setSealSeen(true);
        sealOf(s.paper, s.syllabus ?? []).then(setSealHash);
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
      syllabus,
      paper,
      prevReport,
      result,
      turn: turnRef.current,
      startedAt,
      sealSeen,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // storage full or blocked, so the app just loses refresh insurance
    }
  }, [phase, topic, transcript, ledger, syllabus, paper, prevReport, result, startedAt, sealSeen]);

  function writeLedger(next: Belief[]) {
    ledgerRef.current = next;
    setLedger(next);
  }

  function writeSyllabus(next: SyllabusNode[]) {
    syllabusRef.current = next;
    setSyllabus(next);
  }

  function enroll(t: string) {
    const subject = t.trim();
    setTopic(subject);
    setPhase("lesson");
    setStartedAt(Date.now());
    setTranscript([
      {
        role: "pupil",
        text: `Okay. I know nothing about ${subject}, and I mean nothing. Teach me.`,
      },
    ]);
    // The map and the paper are written now, before any teaching, so neither
    // can be fitted to the lesson. If this call fails the exam route writes a
    // paper at exam time instead, the map falls back to drawing only what got
    // taught, and the lesson screen never claims the seal.
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
          const map = (body.syllabus ?? []) as SyllabusNode[];
          setPaper(questions);
          writeSyllabus(map);
          setSealSeen(true);
          sealOf(questions, map).then(setSealHash);
        } else if (!ok) {
          toast.warning("The examiner's office is busy.", {
            description:
              "No sealed map this time. Pip will still sit a paper, written when he walks in.",
          });
        }
      })
      .catch(() => {})
      .finally(() => setPaperPending(false));
  }

  function loadSeedDemo() {
    setTopic(SEED_TOPIC);
    setTranscript(SEED_TRANSCRIPT);
    writeLedger(SEED_LEDGER);
    writeSyllabus(SEED_SYLLABUS);
    turnRef.current = 4;
    paperTopicRef.current = SEED_TOPIC;
    setPaper(SEED_EXAM);
    setStartedAt(Date.now() - 8 * 60 * 1000);
    setSealSeen(true); // the seed replays a session where the seal was shown
    sealOf(SEED_EXAM, SEED_SYLLABUS).then(setSealHash);
    setResult({ questions: SEED_EXAM, answers: SEED_ANSWERS, grades: SEED_GRADES });
    setPrevReport(null);
    setPhase("report");
  }

  async function teach() {
    const message = draft.trim();
    if (!message || pipThinking) return;
    stickRef.current = true;
    setDraft("");
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
          body: JSON.stringify({
            topic,
            ledger: ledgerRef.current,
            syllabus: syllabusRef.current,
            message,
            turn,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `notebook failed (${res.status})`);
        writeLedger(body.ledger as Belief[]);
      } catch (e) {
        toast.error("Pip could not write that down.", {
          description: e instanceof Error ? e.message : "The notebook call failed.",
        });
      } finally {
        setWritingNotes((n) => n - 1);
      }
    });

    try {
      const replyRes = await replyPromise;
      const body = await replyRes.json();
      if (!replyRes.ok) throw new Error(body?.error ?? `request failed (${replyRes.status})`);
      const reply = body as PupilReply;
      setTranscript((t) => [...t, { role: "pupil", text: reply.reply }]);
    } catch (e) {
      toast.error("Pip lost the thread.", {
        description: e instanceof Error ? e.message : "Say the next one.",
        action: { label: "Put it back", onClick: () => setDraft(message) },
      });
    } finally {
      setPipThinking(false);
    }
  }

  async function checkUnderstanding() {
    if (!checkinConcept.trim() || checkinBusy) return;
    setCheckinBusy(true);
    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, ledger: ledgerRef.current, concept: checkinConcept }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `request failed (${res.status})`);
      const reply = body as PupilReply;
      setTranscript((t) => [
        ...t,
        { role: "pupil", text: reply.reply, checkin: true, kind: "checkin" },
      ]);
    } catch (e) {
      toast.error("Pip could not explain that back.", {
        description: e instanceof Error ? e.message : "Try again in a moment.",
      });
    } finally {
      setCheckinBusy(false);
      setShowCheckin(false);
      setCheckinConcept("");
    }
  }

  async function sendToExam() {
    setPhase("exam");
    setExamStage("writing");
    setExamScript([]);
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
          if (msg.kind === "stage") {
            setExamStage(msg.stage);
            if (msg.questions) setPaper(msg.questions as ExamQuestion[]);
            // Pip's script arrives before the grader has read it, so the wait
            // is spent reading what your own lesson made him write.
            if (msg.answers) setExamScript(msg.answers as ExamAnswer[]);
          } else if (msg.kind === "done") {
            setResult({ questions: msg.questions, answers: msg.answers, grades: msg.grades });
            setPaper(msg.questions);
            setSelected(null);
            setPhase("report");
          } else if (msg.kind === "error") throw new Error(msg.message);
        }
      }
    } catch (e) {
      toast.error("The exam was abandoned.", {
        description: e instanceof Error ? e.message : "The exam hall caught fire.",
      });
      setPhase("lesson");
    }
  }

  // A concept and the sentences that built it are the same thing seen from two
  // sides. Selecting anywhere (map node, notebook row, chat dot) opens that
  // concept's file: what Pip believes about it, in whose words. Selecting it
  // again folds it back; the map dims to the concept's blast radius while it is
  // open, and clicking the map's background clears it.
  function focusKey(key: string | null) {
    setSelected((cur) => (key !== null && cur === key ? null : key));
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

  // On the report card the map is above the questions, so pointing a lost mark
  // at its concept means nothing unless the map is on screen to watch it land.
  function showOnMap(nodeId: string) {
    setShowWorking(null);
    setSelected(nodeId);
    reportMapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // The route Pip took to one answer, laid over the map. He cites the beliefs
  // he used, so this is his actual working and not a reconstruction of it.
  function openWorking(i: number) {
    if (showWorking === i) {
      setShowWorking(null);
      return;
    }
    setSelected(null);
    setShowWorking(i);
    reportMapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // The teacher challenges a note. Pip reads their own sentence back, or admits
  // he misread it and rewrites the note. Nothing else can move the ledger: a
  // belief you can argue away is a grade you can argue away.
  async function dispute(belief: Belief) {
    const text = objection.trim();
    if (!text || disputeBusy) return;
    setDisputeBusy(true);
    try {
      const res = await fetch("/api/dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, belief, objection: text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `request failed (${res.status})`);
      const out = body as Dispute;
      setTranscript((t) => [
        ...t,
        { role: "pupil", text: out.reply, checkin: true, kind: "dispute" },
      ]);
      if (out.verdict === "conceded" && out.statement) {
        writeLedger(
          ledgerRef.current.map((b) =>
            b.id === belief.id
              ? {
                  ...b,
                  statement: out.statement!,
                  status: out.status ?? b.status,
                  correction: (out.status ?? b.status) === "correct" ? undefined : b.correction,
                  disputed: true,
                }
              : b
          )
        );
        toast.success("Pip backed down.", {
          description: "He misread you. The note is rewritten, and the report card will say it was.",
        });
      } else {
        toast("The note stands.", { description: "He read your sentence back to you." });
      }
      setArguing(null);
      setObjection("");
    } catch (e) {
      toast.error("Pip could not argue back.", {
        description: e instanceof Error ? e.message : "Try again in a moment.",
      });
    } finally {
      setDisputeBusy(false);
    }
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
    writeSyllabus([]);
    setDraft("");
    setResult(null);
    setPaper(null);
    setPrevReport(null);
    setSelected(null);
    setShowCheckin(false);
    setCheckinConcept("");
    setPaperPending(false);
    setSealHash(null);
    setSealSeen(false);
    setExamScript([]);
    setStartedAt(0);
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
  const states = conceptStates(syllabus, ledger);
  const lit = Array.from(states.values()).filter((s) => s.state !== "unlit").length;
  const dark = syllabus.filter((n) => states.get(n.id)?.state === "unlit");
  // Concepts sitting open on the frontier: unlit, but everything they stand on
  // is taught. This is the only count the lesson screen may show, because the
  // number of concepts remaining is the spoiler.
  const openNext = Array.from(frontierOf(syllabus, states)).filter(
    (id) => states.get(id)?.state === "unlit"
  ).length;
  const openBeliefs = selected ? ledger.filter((b) => keyOfBelief(b) === selected) : [];
  const openConcept = selected ? syllabus.find((n) => n.id === selected) : undefined;
  // Things taught that the sealed map had no place for. Concept-map assessment
  // calls these extra propositions and counts them separately from gaps,
  // because they are not a mistake: they are either enrichment or drift, and
  // only the teacher knows which.
  const offMap = ledger.filter((b) => !b.nodeId || !states.has(b.nodeId));
  const offMapConcepts = Array.from(new Set(offMap.map((b) => b.concept)));
  // One answer's working: not just the beliefs Pip cited, but everything those
  // were reasoned from, oldest first. Citing "a hash table always beats a
  // sorted array" and stopping there hides the fact that he only believes it
  // because of a bad note two turns earlier. The route is the point.
  const working = useMemo(() => {
    if (showWorking == null || !result) return { steps: [] as string[], fromMarker: false };
    const cited = result.answers[showWorking]?.usedBeliefIds ?? [];
    // Pip cites the notes he used, but on a paper where most questions were
    // never covered he sometimes leans on a note without naming it. The grader
    // catches those and names the belief that cost the mark, so the route can
    // still be drawn. It is a different claim, though: that is the marker's
    // finding, not Pip's citation, and the caption has to say so.
    const culprit = result.grades[showWorking]?.culpritBeliefId;
    const roots = cited.length ? cited : culprit != null ? [culprit] : [];
    const byId = new Map(ledger.map((b) => [b.id, b]));
    const seen = new Set<number>();
    const ordered: Belief[] = [];
    const walk = (id: number) => {
      if (seen.has(id)) return;
      seen.add(id);
      const b = byId.get(id);
      if (!b) return;
      b.derivedFrom.forEach(walk); // ancestors land before what was built on them
      ordered.push(b);
    };
    roots.forEach(walk);
    return {
      steps: Array.from(new Set(ordered.map(keyOfBelief))),
      fromMarker: !cited.length && ordered.length > 0,
    };
  }, [showWorking, result, ledger]);

  const workingTrace: Trace | null =
    showWorking != null && result
      ? { steps: working.steps, target: result.questions[showWorking]?.nodeId ?? null }
      : null;
  const beliefsByTurn = new Map<number, Belief[]>();
  for (const b of ledger) {
    const list = beliefsByTurn.get(b.turn) ?? [];
    list.push(b);
    beliefsByTurn.set(b.turn, list);
  }
  let teacherCount = 0;
  const turnOfIndex = transcript.map((t) => (t.role === "teacher" ? ++teacherCount : 0));

  // Pip's face is a readout of what you just taught him, not a mood the model
  // picked. Letting the model choose meant it drew a fresh face every reply and
  // he churned through expressions for no reason the teacher could see. Now the
  // beliefs decide: teach him something wrong and he is confused, because he
  // *is*.
  const lastTurnBeliefs = beliefsByTurn.get(teacherCount) ?? [];
  const beliefMood = moodOfBeliefs(lastTurnBeliefs, ledger.length);

  // He has no clock, so he cannot tell you he has been at this an hour. The UI
  // can: past a dozen turns he starts to flag, unless the last thing he learned
  // landed, which nobody is too tired for.
  const flagging = teacherCount >= 12 && beliefMood !== "happy";
  const deskMood: Mood = pipThinking
    ? "thinking"
    : writingNotes > 0
      ? "writing"
      : flagging
        ? "tired"
        : beliefMood;

  // The map and the sealed paper both land in that one /api/paper response, so
  // until it resolves there is nothing to teach against yet: the frontier the
  // teacher would be writing into does not exist. Locking the box rather than
  // just leaving it be keeps a fast typist from firing off a line that lands a
  // half-second before the map does.
  const mapPending = paperPending && !syllabus.length;

  const mapPanel = mapPending ? (
    <MapSketch />
  ) : (
      <BeliefMap
        syllabus={syllabus}
        beliefs={ledger}
        selected={selected}
        onSelect={focusKey}
        className="h-full w-full"
      />
    );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <button
            onClick={reset}
            aria-label="Star Pupil, back to the start"
            className="flex items-center gap-2 font-semibold tracking-tight transition-opacity hover:opacity-70"
          >
            <PipFace
              mood={phase === "exam" ? "thinking" : phase === "lesson" ? deskMood : "listening"}
              frozen
              className="h-6 w-6 text-foreground"
            />
            Star Pupil
          </button>
          <span className="flex items-center gap-3 text-sm text-muted-foreground">
            {phase === "lesson" ? (
              <>
                <LessonClock since={startedAt} />
                {/* Right-aligned and its text changes as Pip writes, so without
                    a reserved width the clock next to it slides sideways. */}
                <span className="hidden text-right sm:inline sm:min-w-[15rem]">
                  teaching <span className="text-foreground">{topic}</span>
                  {" · "}
                  {writingNotes > 0 ? "Pip is writing…" : beliefCount}
                </span>
              </>
            ) : phase === "exam" ? (
              "exam in progress, no helping"
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

      <main className="mx-auto max-w-7xl px-6 py-8">
        {phase === "enroll" && (
          // items-start, never items-center: a centred row re-centres every
          // time the right-hand column changes height, which drags the headline
          // and the input up and down while the replay plays.
          <section className="grid items-start gap-10 animate-in fade-in slide-in-from-bottom-2 duration-500 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="mx-auto w-full max-w-xl">
            <PipDesk mood="listening" className="w-56 text-foreground" />
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">
              Every AI wants to teach you. This one needs a teacher.
            </h1>
            <p className="mt-3 text-muted-foreground">
              Pip knows nothing. Every sentence you say becomes a belief in his
              head, sloppy ones included. The examiner maps the subject and
              seals a paper against it before you start, but you never see the
              map. You see the next thing you could teach, and nothing past it.
              What you never reached turns up on the report card.
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
            {/* one row, no wrapping: four topics that break onto a second line
                read as a list to get through rather than a nudge to just start */}
            <div className="mt-3 flex items-center gap-1.5">
              <span className="shrink-0 text-sm text-muted-foreground">Ideas:</span>
              {SUGGESTED.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="xs"
                  className="whitespace-nowrap"
                  onClick={() => enroll(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
            <div className="mt-6 border-t pt-4">
              <Button variant="outline" onClick={loadSeedDemo}>
                Skip the typing, watch a finished report card
                <SkipForward className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
            </div>
            <EnrollDemo />
          </section>
        )}

        {/* The lesson is a room, not a document: it fits the window and never
            scrolls the page. Both columns are flex so the chat and the map
            absorb whatever height is left over, and the composer, the paper and
            the exam button stay put at the bottom where the hand expects them. */}
        {phase === "lesson" && (
          <section className="grid gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500 lg:h-[calc(100vh-9rem)] lg:min-h-[540px] lg:grid-cols-[minmax(0,1fr)_minmax(400px,460px)]">
            <div className="flex min-h-0 flex-col">
              <div className="flex shrink-0 items-center gap-2">
                <PipFace mood={deskMood} frozen className="h-7 w-7 text-foreground" />
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
                className="mt-4 flex min-h-[320px] flex-1 flex-col gap-3 overflow-y-auto rounded-md border bg-card p-4"
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
                          {t.kind === "dispute" ? "settling an argument" : "checking understanding"}
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
                                // The file opens in the sidebar, so make sure
                                // the tab showing it is the open one.
                                setTab("map");
                                setSelected(keyOfBelief(b));
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
                      <PipFace
                        mood={t.mood ?? moodOfBeliefs(beliefsByTurn.get(turnOfIndex[i - 1] ?? 0) ?? [], ledger.length)}
                        frozen
                        className="mb-0.5 h-6 w-6 shrink-0 text-foreground"
                      />
                      {bubble}
                    </div>
                  );
                })}
                {pipThinking && (
                  <div className="flex items-center gap-1.5 self-start animate-in fade-in slide-in-from-bottom-1 duration-300">
                    <PipFace mood="thinking" frozen className="h-6 w-6 shrink-0 text-foreground" />
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
              <div className="mt-3 flex shrink-0 gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      teach();
                    }
                  }}
                  disabled={mapPending}
                  placeholder={
                    mapPending
                      ? "The examiner is still sealing the paper…"
                      : "Explain something. Pip believes exactly what you say."
                  }
                  className="h-20 min-h-20 bg-card"
                />
                <Button onClick={teach} disabled={mapPending || !draft.trim() || pipThinking}>
                  <PencilLine className="h-4 w-4" aria-hidden /> Teach
                </Button>
              </div>
              <div className="mt-3 flex h-8 shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mapPending || ledger.length === 0}
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
                      placeholder="anything, even something you never taught"
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

            <aside className="flex min-h-0 flex-col">
              <PipDesk
                mood={deskMood}
                writing={writingNotes > 0}
                className="mx-auto w-40 shrink-0 text-foreground"
              />
              <Tabs value={tab} onValueChange={setTab} className="mt-2 min-h-0 flex-1">
                <div className="flex shrink-0 items-center gap-2">
                  <TabsList variant="line">
                    <TabsTrigger value="map">
                      <Waypoints className="h-3.5 w-3.5" aria-hidden /> Map
                    </TabsTrigger>
                    <TabsTrigger value="log">
                      <NotebookPen className="h-3.5 w-3.5" aria-hidden /> Notebook
                    </TabsTrigger>
                  </TabsList>
                  {tab === "map" && (syllabus.length > 0 || ledger.length > 0) && (
                    <Dialog>
                      <DialogTrigger
                        render={
                          <Button variant="ghost" size="xs" className="ml-auto">
                            <Maximize2 className="h-3 w-3" aria-hidden /> Open the map
                          </Button>
                        }
                      />
                      {/* the popup is a grid, and auto rows share the height
                          equally, which left the map in a 200px band with the
                          caption floating in space. Name the rows instead. */}
                      <DialogContent className="h-[86vh] max-w-[92vw] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[92vw]">
                        <DialogHeader>
                          <DialogTitle className="capitalize">{topic}</DialogTitle>
                          <DialogDescription>
                            Every concept a fair lesson covers, drawn before you said a word. Dashed
                            edges are the subject&rsquo;s own order. Solid edges are Pip reasoning
                            from one belief to the next.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
                          {mapPanel}
                        </div>
                        <MapLegend lit={lit} total={syllabus.length} />
                      </DialogContent>
                    </Dialog>
                  )}
                </div>

                <TabsContent value="map" className="flex min-h-0 flex-col">
                  {/* The file is an overlay on the map, not another row in the
                      column. A panel that pushes its siblings down can push the
                      exam button off the window, and on the way there it slides
                      under whatever it passes. Nothing below this moves. */}
                  <div className="relative flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-md border bg-card">
                    {mapPanel}
                    {(openConcept || openBeliefs.length > 0) && (
                      <ConceptFile
                        concept={openConcept}
                        beliefs={openBeliefs}
                        ledger={ledger}
                        onReveal={revealInLesson}
                        onClose={() => setSelected(null)}
                        arguing={arguing}
                        objection={objection}
                        busy={disputeBusy}
                        onArgue={(id) => {
                          setArguing((cur) => (cur === id ? null : id));
                          setObjection("");
                        }}
                        onObjection={setObjection}
                        onSubmit={dispute}
                      />
                    )}
                  </div>
                  <div className="mt-2 shrink-0">
                    <MapLegend lit={lit} total={syllabus.length} next={openNext} />
                  </div>
                </TabsContent>

                <TabsContent value="log" className="flex min-h-0 flex-col">
                  <div className="paper-ruled min-h-[220px] flex-1 overflow-y-auto rounded-md border pb-2 text-[17px] leading-8">
                    {ledger.length === 0 && writingNotes === 0 && (
                      <p className="pl-10 pr-3 font-hand text-muted-foreground">
                        Nothing yet. Everything you teach lands on these lines:
                        correct, fuzzy, or flat wrong.
                      </p>
                    )}
                    {ledger.map((b) => (
                      <BeliefNote
                        key={b.id}
                        belief={b}
                        open={selected === keyOfBelief(b)}
                        root={selected === keyOfBelief(b) ? rootCause(ledger, b.id) : undefined}
                        onToggle={() => focusKey(keyOfBelief(b))}
                        onReveal={() => revealInLesson(b)}
                      />
                    ))}
                    {writingNotes > 0 && (
                      <p className="animate-pulse pl-10 pr-3 font-hand text-muted-foreground">
                        Pip is writing…
                      </p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>

              <div className="mt-3 flex shrink-0 items-center justify-between gap-2 rounded-md border bg-card py-2 pl-3 pr-2">
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
                          {prevReport ? "Retake: same paper, second sitting" : "Written at enrollment, before the first lesson"}
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
                          <span className="font-mono">seal {sealHash ?? "not sealed"}</span>
                          <span className="italic">Total: {paper.length} marks · End of paper</span>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <Button
                className="mt-3 w-full shrink-0"
                size="lg"
                disabled={ledger.length < 3 || writingNotes > 0 || paperPending}
                onClick={sendToExam}
              >
                Send Pip to the exam
              </Button>
              {/* Fixed height, always rendered. A line that appears and
                  disappears under a button moves the button. */}
              <p className="mt-2 h-8 shrink-0 overflow-hidden text-center text-xs text-muted-foreground">
                {ledger.length < 3
                  ? "Teach at least three things first."
                  : openNext > 0
                    ? `${openNext} concept${openNext === 1 ? "" : "s"} open next, and more behind them.`
                    : "He can only answer from what you lit."}
              </p>
            </aside>
          </section>
        )}

        {phase === "exam" && (
          <section className="mx-auto max-w-2xl text-center animate-in fade-in duration-500">
            <PipDesk
              mood="thinking"
              writing={examStage === "sitting"}
              className="mx-auto w-64 text-foreground"
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

            {/* The script itself, on the desk. The seal is broken now, so every
                question is face up: the paper the teacher only saw two lines of
                is finally readable, and Pip's answers land on it one at a time.
                Grading is the slowest of the three calls, and it is spent
                reading what your own lesson made him write, before anybody has
                said whether it is right. */}
            {paper && examStage !== "writing" && (
              <div className="paper-ruled mt-8 rounded-md border pb-4 text-left">
                <div className="border-b px-10 py-3 text-center font-serif">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Star Pupil Examination Board
                  </p>
                  <p className="text-sm capitalize">
                    {topic}
                    <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-destructive/80">
                      seal broken
                    </span>
                  </p>
                </div>
                {paper.map((q, i) => {
                  const a = examScript[i];
                  return (
                    <div key={i} className="pb-3 pl-10 pr-4 pt-2">
                      <p className="font-serif text-sm leading-6">
                        {i + 1}. {q.q}
                      </p>
                      {a ? (
                        <p
                          className={`font-hand text-[19px] leading-8 animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards duration-500 ${
                            a.confessed ? "text-muted-foreground" : ""
                          }`}
                          style={{ animationDelay: `${i * 200}ms` }}
                        >
                          {a.answer}
                        </p>
                      ) : (
                        <Skeleton
                          className="mt-2 h-4 rounded-sm"
                          style={{ width: `${58 + ((i * 23) % 34)}%` }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {phase === "report" && result && stats && (
          <section className="mx-auto max-w-2xl animate-in fade-in slide-in-from-bottom-3 duration-700">
            <div className="rounded-md border-2 border-foreground bg-card p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <PipFace
                    mood={pct >= 0.8 ? "happy" : pct >= 0.5 ? "curious" : "worried"}
                    frozen
                    className="mt-1 h-12 w-12 shrink-0 text-foreground"
                  />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Report card
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                      Pip: {topic}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {prevScore === null
                        ? "Answered entirely from your teaching. Grade belongs to the teacher."
                        : "Retake. Same paper, same pupil, better teaching."}
                    </p>
                    {sealHash && sealSeen && (
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        seal {sealHash}, the same map and paper you saw at enrollment
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
                {syllabus.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">The map</p>
                    <p className="font-medium tabular-nums">
                      {lit}/{syllabus.length}
                    </p>
                    <p className="text-xs text-muted-foreground">concepts you lit</p>
                  </div>
                )}
              </div>

              {syllabus.length > 0 && (
                <>
                  <Separator className="my-5" />
                  <div className="animate-in fade-in fill-mode-backwards delay-500 duration-700">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      The lesson, against the map that was sealed first
                    </p>
                    <div ref={reportMapRef} className="mt-3 h-[420px] overflow-hidden rounded-md border bg-background">
                      <BeliefMap
                        syllabus={syllabus}
                        beliefs={ledger}
                        selected={selected}
                        onSelect={(k) => {
                          setShowWorking(null);
                          setSelected(k);
                        }}
                        revealMarks
                        revealAll
                        trace={workingTrace}
                        questionNodeIds={result.questions.flatMap((q) => (q.nodeId ? [q.nodeId] : []))}
                        className="h-full w-full"
                      />
                    </div>
                    <MapLegend lit={lit} total={syllabus.length} revealAll />
                    {showWorking != null && result && (
                      // Three lines reserved: the caption differs per question
                      // and the questions below it must not jump as you click
                      // from one working to the next.
                      <p className="mt-3 min-h-[4.5rem] text-sm animate-in fade-in duration-200">
                        {workingTrace && workingTrace.steps.length > 1 ? (
                          <>
                            <span className="font-medium">
                              Question {showWorking + 1}, his working.
                            </span>{" "}
                            Numbered in the order he reasoned, each one built on the
                            one before it, ending on the concept the question was set
                            on.{" "}
                            {working.fromMarker
                              ? "He named no notes for this one; the marker traced the answer back to them."
                              : "Only the last was cited: the rest are what it rests on."}
                          </>
                        ) : workingTrace?.steps.length === 1 ? (
                          <>
                            <span className="font-medium">
                              Question {showWorking + 1}, his working.
                            </span>{" "}
                            One note, standing on nothing else.{" "}
                            {workingTrace.steps[0] === workingTrace.target
                              ? "Filed exactly where the question was set."
                              : "Filed on a different concept than the question."}{" "}
                            {working.fromMarker && "He did not name it; the marker did."}
                          </>
                        ) : (
                          <>
                            <span className="font-medium">
                              Question {showWorking + 1}: no working.
                            </span>{" "}
                            He cited nothing, because nothing you taught reached this
                            question. Whatever he wrote, he made up.
                          </>
                        )}{" "}
                        <button
                          onClick={() => setShowWorking(null)}
                          className="underline decoration-dotted underline-offset-4 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          close
                        </button>
                      </p>
                    )}
                    {offMapConcepts.length > 0 && (
                      <p className="mt-3 text-sm text-muted-foreground">
                        Off the map: {offMapConcepts.join(", ")}.{" "}
                        {offMapConcepts.length === 1 ? "One thing" : `${offMapConcepts.length} things`}{" "}
                        you taught that the sealed syllabus had no place for. Enrichment or
                        drift, and only you know which.
                      </p>
                    )}
                    {dark.length > 0 && (
                      <p className="mt-3 text-sm text-muted-foreground">
                        Never taught:{" "}
                        {dark.map((n, i) => (
                          <span key={n.id}>
                            {i > 0 && ", "}
                            <button
                              onClick={() => showOnMap(n.id)}
                              className="underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
                            >
                              {n.label}
                            </button>
                          </span>
                        ))}
                        .{" "}
                        {(() => {
                          const costly = dark.filter((n) =>
                            result.questions.some((q) => q.nodeId === n.id)
                          ).length;
                          return costly > 0
                            ? `${costly} of them carried a question.`
                            : "None of them carried a question this time.";
                        })()}
                      </p>
                    )}
                  </div>
                </>
              )}

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
                  const onNode = q.nodeId ? syllabus.find((n) => n.id === q.nodeId) : undefined;
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
                      <div className="mt-1 flex flex-wrap items-center gap-x-3">
                      {onNode && (
                        <button
                          onClick={() => showOnMap(onNode.id)}
                          className="text-xs text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
                        >
                          on the map: {onNode.label}
                          {/* Only worth flagging on a mark that was lost. A
                              correct answer on an unlit concept is not a
                              contradiction (the belief that earned it was filed
                              under a neighbour), but printing "never lit" next
                              to CORRECT reads like the app contradicting
                              itself. */}
                          {states.get(onNode.id)?.state === "unlit" &&
                          (g.verdict === "blank" || g.verdict === "wrong")
                            ? " (never lit)"
                            : ""}
                        </button>
                      )}
                      {syllabus.length > 0 && (
                        <button
                          onClick={() => openWorking(i)}
                          aria-pressed={showWorking === i}
                          className={`text-xs underline decoration-dotted underline-offset-4 transition-colors ${
                            showWorking === i
                              ? "font-medium text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {showWorking === i ? "hide his working" : "show his working"}
                        </button>
                      )}
                      </div>
                      {/* A blank is Pip guessing from outside the ledger. Show the
                          guess, but greyed: it is not an answer you earned. */}
                      <p
                        className={`mt-2 font-hand text-xl leading-6 ${
                          g.verdict === "blank" ? "text-muted-foreground/70" : ""
                        }`}
                      >
                        {a?.answer ?? "(no answer)"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{g.explanation}</p>
                      {/* The grader read that answer and wanted to award it. The
                          rule took the mark back because nothing in the lesson
                          earned it. Showing both is the only way anyone can see
                          that the constraint is code and not a polite request. */}
                      {g.graderVerdict && (
                        <p className="mt-2 border-l-2 border-foreground/30 pl-3 text-xs text-muted-foreground animate-in fade-in slide-in-from-left-2 fill-mode-backwards delay-700 duration-400">
                          The grader marked this{" "}
                          <span className="line-through">{g.graderVerdict}</span>. Overruled in
                          code: Pip answered from outside the ledger, so the mark is not yours.
                        </p>
                      )}
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
                      {/* A mark can be lost to a sentence that was perfectly
                          true and simply stopped early. There is no better
                          wording to offer for that, and inventing one would be
                          scolding the teacher for something they got right, so
                          it says what actually went wrong instead. */}
                      {culprit && !(culpritRoot ?? culprit).correction && (
                        <p className="mt-2 border-l-2 border-muted-foreground/40 pl-3 text-sm text-muted-foreground animate-in fade-in slide-in-from-left-2 fill-mode-backwards delay-1000 duration-400">
                          Nothing in that sentence was wrong. It just stopped
                          before the part this question asked about.
                        </p>
                      )}
                      {/* Naming the sentence that cost the mark without saying
                          what would not have is half a report card. */}
                      {(culpritRoot ?? culprit)?.correction && (
                        <p className="mt-2 border-l-2 border-[oklch(0.72_0.13_85)] pl-3 text-sm animate-in fade-in slide-in-from-left-2 fill-mode-backwards delay-1000 duration-400">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {/* The advice is aimed at the root, not the nearest
                                mistake, so two questions poisoned by one
                                sentence get the same fix. Saying which turn it
                                belongs to is what stops that reading as a
                                repeated paragraph. */}
                            {culprit && culpritRoot && culpritRoot.id !== culprit.id
                              ? `Say instead, at the root (turn ${culpritRoot.turn})`
                              : "Say instead"}
                          </span>
                          <br />
                          <span className="font-hand text-lg leading-6">
                            {(culpritRoot ?? culprit)!.correction}
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

// One real lesson replaying itself on the enroll screen: the hash tables map
// that was sealed before that lesson started, lighting up one sentence at a
// time, ending on the two concepts the teacher got wrong. It is the finished
// demo running in the background, not a mockup, so the promise on the left is
// visibly the thing on the right.
function EnrollDemo() {
  const [step, setStep] = useState(0);
  const [loop, setLoop] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (still) return;
    const t = setInterval(() => {
      setStep((s) => {
        if (s >= SEED_LEDGER.length) {
          // A fresh mount so the concepts light for the second run too: the
          // map only flares a node the first time it comes on.
          setLoop((l) => l + 1);
          return 0;
        }
        return s + 1;
      });
    }, 1900);
    return () => clearInterval(t);
  }, [still]);

  // Held still, the replay does not play: it shows the finished lesson instead.
  const shown = still ? SEED_LEDGER : SEED_LEDGER.slice(0, step);
  const wrong = shown.filter((b) => b.status === "wrong").length;

  return (
    <div className="hidden lg:block">
      <div className="h-[440px] overflow-hidden rounded-md border bg-card">
        <BeliefMap
          key={loop}
          syllabus={SEED_SYLLABUS}
          beliefs={shown}
          selected={null}
          onSelect={() => {}}
          interactive={false}
          className="h-full w-full"
        />
      </div>
      {/* Fixed height. The sentence changes every two seconds and its length
          changes with it, so a paragraph that sizes to its text would reflow on
          a loop and push everything under it up and down forever. */}
      <p className="mt-3 h-10 text-sm text-muted-foreground">
        A real lesson, replayed. The map only shows what is teachable next.{" "}
        {shown.length === 0
          ? "Nothing taught yet, so it starts at the beginning."
          : wrong > 0
            ? `${shown.length} sentences in, and ${wrong} planted something false.`
            : `${shown.length} sentence${shown.length === 1 ? "" : "s"} in, and more of the subject has opened up.`}
      </p>
    </div>
  );
}

// How long Pip has been in this lesson. He has no clock; the room does.
function LessonClock({ since }: { since: number }) {
  // Read the clock during the first render, not in an effect: a session
  // restored from storage started long ago, and an effect would show 00:00 for
  // a second before jumping to the real elapsed time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="font-mono text-xs tabular-nums text-muted-foreground">
      {String(Math.floor(secs / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
}

// The map before the examiner has finished drawing it. Not a spinner: the shape
// of what is coming, so the wait tells you what to expect.
// While the examiner writes the syllabus and seals a paper against it, there
// is no real map to draw yet: it lands in one JSON response, not a stream of
// concepts. So this fakes the shape of the thing arriving - a small tree that
// sketches itself in, waits, and erases to sketch again - rather than a
// content-free shimmer bar. It never shows the real subject; revealing that
// before teaching starts is exactly what the frontier is built to prevent.
const SKETCH_NODES: { id: string; x: number; y: number; delay: number }[] = [
  { id: "a", x: 100, y: 18, delay: 0 },
  { id: "b", x: 52, y: 62, delay: 1.1 },
  { id: "c", x: 148, y: 62, delay: 1.5 },
  { id: "d", x: 32, y: 108, delay: 2.9 },
  { id: "e", x: 168, y: 108, delay: 3.3 },
];
const SKETCH_EDGES: { from: string; to: string; delay: number }[] = [
  { from: "a", to: "b", delay: 0.5 },
  { from: "a", to: "c", delay: 0.9 },
  { from: "b", to: "d", delay: 2.3 },
  { from: "c", to: "e", delay: 2.7 },
];

function MapSketch() {
  const byId = new Map(SKETCH_NODES.map((n) => [n.id, n]));
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6">
      <svg viewBox="0 0 200 130" className="w-full max-w-[280px] text-muted-foreground" aria-hidden>
        {SKETCH_EDGES.map((e) => {
          const from = byId.get(e.from)!;
          const to = byId.get(e.to)!;
          return (
            <line
              key={`${e.from}-${e.to}`}
              x1={from.x}
              y1={from.y + 8}
              x2={to.x}
              y2={to.y - 8}
              pathLength={1}
              className="sp-sketch-edge"
              style={{ animationDelay: `${e.delay}s`, stroke: "currentColor" }}
            />
          );
        })}
        {SKETCH_NODES.map((n) => (
          <rect
            key={n.id}
            x={n.x - 23}
            y={n.y - 8}
            width={46}
            height={16}
            rx={5}
            className="sp-sketch-node"
            style={{ animationDelay: `${n.delay}s`, stroke: "currentColor" }}
          />
        ))}
      </svg>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        The examiner is drawing the subject and sealing a paper against it.
      </p>
    </div>
  );
}

// One concept's file, expanded in place under the map: what the subject says it
// is, and everything Pip believes about it, in whose words. A concept nobody
// taught has a file too, and it is empty, which is the whole point.
function ConceptFile({
  concept,
  beliefs,
  ledger,
  onReveal,
  onClose,
  arguing,
  objection,
  busy,
  onArgue,
  onObjection,
  onSubmit,
}: {
  concept: SyllabusNode | undefined;
  beliefs: Belief[];
  ledger: Belief[];
  onReveal: (b: Belief) => void;
  onClose: () => void;
  arguing: number | null;
  objection: string;
  busy: boolean;
  onArgue: (id: number) => void;
  onObjection: (v: string) => void;
  onSubmit: (b: Belief) => void;
}) {
  const title = concept?.label ?? beliefs[0]?.concept ?? "";
  return (
    <div className="absolute inset-x-0 bottom-0 max-h-[78%] overflow-y-auto border-t bg-card p-3 shadow-[0_-8px_20px_oklch(0.26_0.015_70_/_0.1)] animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-2">
        {beliefs.length > 0 ? (
          <BeliefStatusChip status={worstOf(beliefs)} />
        ) : (
          <span className="inline-block shrink-0 rounded-[3px] border border-dashed border-muted-foreground/50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            never taught
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
        <button
          onClick={onClose}
          aria-label="fold the concept back up"
          className="px-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          {"×"}
        </button>
      </div>
      {concept?.detail && (
        <p className="mt-2 text-xs italic text-muted-foreground">{concept.detail}</p>
      )}
      {beliefs.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing in the notebook. Pip cannot answer a question about this, and
          guessing one right earns nothing.
        </p>
      ) : (
        beliefs.map((b) => {
          const root = rootCause(ledger, b.id);
          return (
            <div key={b.id} className="mt-3 border-t pt-3 first:border-t-0 first:pt-0">
              <p className="font-hand text-lg leading-6">{b.statement}</p>
              {b.disputed && (
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  rewritten after you challenged it
                </p>
              )}
              <QuoteSticky turn={b.turn} quote={b.quote} />
              {b.status !== "correct" && b.note && (
                <p className="mt-2 text-xs text-destructive">{b.note}</p>
              )}
              {root && root.id !== b.id && (
                <p className="mt-2 border-l-2 border-destructive/40 pl-2 text-xs text-destructive">
                  built on a shakier belief, turn {root.turn}: &ldquo;{root.quote}&rdquo;
                </p>
              )}
              {b.correction && (
                <p className="mt-2 border-l-2 border-[oklch(0.72_0.13_85)] pl-2 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                    Say instead
                  </span>
                  <br />
                  <span className="font-hand text-base leading-5">{b.correction}</span>
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => onReveal(b)}>
                  See it in the lesson
                </Button>
                <Button
                  variant={arguing === b.id ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => onArgue(b.id)}
                >
                  I never said that
                </Button>
              </div>
              {arguing === b.id && (
                <div className="mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <Textarea
                    // The file scrolls inside its panel, so the box can open
                    // below the fold. Focusing it brings it into view and lets
                    // the teacher start typing the objection straight away.
                    autoFocus
                    value={objection}
                    onChange={(e) => onObjection(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSubmit(b);
                      }
                    }}
                    placeholder="What did he get wrong about your sentence?"
                    className="min-h-16 bg-background text-sm"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" disabled={!objection.trim() || busy} onClick={() => onSubmit(b)}>
                      {busy ? "he's reading it back…" : "Put it to Pip"}
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      He only backs down if your words really don&rsquo;t say it.
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// A concept is only as sound as the worst thing believed about it.
function worstOf(beliefs: Belief[]): Belief["status"] {
  if (beliefs.some((b) => b.status === "wrong")) return "wrong";
  if (beliefs.some((b) => b.status === "fuzzy")) return "fuzzy";
  return "correct";
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
    // A hollow star with its left half painted gold. The clip does the work.
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

// A belief is Pip's own handwriting on the ruled page, not a coloured card: the
// ink stays black so it reads as a child's notes, and the status is carried by
// the mark in the margin. Gold star landed, red cross is wrong, dot is fuzzy.
// Tinting the whole line instead made the notebook read as a list of alerts.
function BeliefNote({
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
          {/* the ruled page's margin, left clear so the mark sits in it */}
          <span className="w-9 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 pr-3">
            <span
              className={`font-hand text-[19px] ${belief.status === "wrong" ? "text-destructive" : ""}`}
            >
              <span className="mr-1.5 inline-block w-4 text-center font-sans text-[15px]">
                {bullet}
              </span>
              {belief.concept}
            </span>
          </span>
        </span>
      </button>
      {open && (
        <div className="flex animate-in fade-in slide-in-from-top-1 duration-200">
          <span className="w-9 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 pb-2 pr-3">
            <p className="font-hand text-[17px]">{belief.statement}</p>
            <QuoteSticky turn={belief.turn} quote={belief.quote} />
            {belief.status !== "correct" && belief.note && (
              <p className="mt-1 font-hand text-[15px] text-destructive">{belief.note}</p>
            )}
            {root && root.id !== belief.id && (
              <p className="font-hand text-[15px] text-destructive/80">
                built on turn {root.turn}: &ldquo;{root.quote}&rdquo;
              </p>
            )}
            {belief.correction && (
              <p className="font-hand text-[15px] text-[oklch(0.5_0.11_80)]">
                say instead: {belief.correction}
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

// The teacher's own words, on a sticky note taped to the page. The same note in
// the map and in the notebook, so the receipt looks the same wherever it turns up.
function QuoteSticky({ turn, quote }: { turn: number; quote: string }) {
  return (
    <div className="relative mt-2 max-w-[95%] -rotate-[0.8deg] rounded-[1px] bg-[oklch(0.955_0.07_100)] p-2.5 pt-3 font-sans text-xs leading-4 text-[oklch(0.42_0.02_75)] shadow-[1px_3px_7px_oklch(0.26_0.015_70_/_0.18)]">
      <span
        aria-hidden
        className="absolute -top-1.5 left-1/2 h-3 w-12 -translate-x-1/2 rotate-[2deg] rounded-[1px] bg-[oklch(0.93_0.015_95_/_0.75)] shadow-[0_1px_2px_oklch(0.26_0.015_70_/_0.12)]"
      />
      your words, turn {turn}: &ldquo;{quote}&rdquo;
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
