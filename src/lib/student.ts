// Pip, the star pupil. The single source of truth is the belief ledger:
// structured beliefs extracted from the teacher's own words, each carrying the
// exact quote that created it. Pip chats from the ledger, sits the exam from
// the ledger, and every lost mark traces back to a quote. No hidden knowledge
// anywhere. That constraint is the product.

import { generateJson, Rung } from "./llm";

export type BeliefStatus = "correct" | "wrong" | "fuzzy";

export interface Belief {
  id: number;
  concept: string; // short label, becomes a node on the map
  statement: string; // what Pip now believes, in Pip's words
  status: BeliefStatus; // judged against real domain knowledge at extraction time
  quote: string; // the teacher's exact words that produced this belief
  turn: number; // which teacher message it came from
  note: string; // why it got this status (for wrong: the licensed overgeneralization)
  derivedFrom: number[]; // ids of earlier beliefs this one was reasoned from, if any
  nodeId?: string | null; // the syllabus concept this belief lights up, if any
  // What the teacher could have said instead, one sentence, only on beliefs that
  // went wrong or landed fuzzy. Naming the fault without naming the fix leaves
  // the teacher with a diagnosis and no treatment.
  correction?: string;
  // Set when the teacher challenged this belief and Pip conceded. The report
  // card says so: a ledger edited mid-lesson has to admit it was edited, or the
  // receipts stop being receipts.
  disputed?: boolean;
}

// ---------------------------------------------------------------------------
// The syllabus: the subject's own shape, written at enrollment and never shown
// to Pip. It exists so the map can be a map. Without it the map could only draw
// what the teacher happened to say, which shows you what you covered and hides
// the only thing worth knowing: what you didn't.
//
// It is the examiner's document, so it goes under the same seal as the paper
// and is passed to exactly two places: the teacher's screen, and belief
// extraction (which already has full domain knowledge and uses the syllabus as
// a filing index). It never reaches pupilReply or sitExam. Pip knowing the
// shape of the subject would be knowledge nobody taught him.

export interface SyllabusNode {
  id: string; // stable slug, referenced by beliefs and exam questions
  label: string; // 1-4 words, how a teacher would write it on a board
  detail: string; // one line: what a student who has this concept can say
  requires: string[]; // ids that must come first, so the map has a direction
}

export interface Course {
  syllabus: SyllabusNode[];
  questions: ExamQuestion[];
}

export interface ChatTurn {
  role: "teacher" | "pupil";
  text: string;
}

export interface PupilReply {
  reply: string;
}

// ---------------------------------------------------------------------------
// Belief extraction, run after each teacher message. This is where honest
// misconceptions are born: if the teacher's wording licenses an
// overgeneralization, we record the WRONG belief a real student would form.

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["add", "update"] },
          id: { type: "number" },
          concept: { type: "string" },
          statement: { type: "string" },
          status: { type: "string", enum: ["correct", "wrong", "fuzzy"] },
          quote: { type: "string" },
          note: { type: "string" },
          derivedFrom: { type: "array", items: { type: "number" } },
          nodeId: { type: "string" },
          correction: { type: "string" },
        },
        required: ["op", "concept", "statement", "status", "quote", "note"],
      },
    },
  },
  required: ["ops"],
};

export async function extractBeliefs(
  topic: string,
  ledger: Belief[],
  teacherMessage: string,
  turn: number,
  syllabus: SyllabusNode[] = []
): Promise<Belief[]> {
  const existing = ledger
    .map((b) => `#${b.id} [${b.status}] ${b.concept}: ${b.statement}`)
    .join("\n");
  const map = syllabus.map((n) => `${n.id} — ${n.label}: ${n.detail}`).join("\n");

  const prompt = `You maintain the belief state of Pip, a student being taught "${topic}".
Pip is intelligent but knows nothing about this topic except what the teacher
has said. You DO know the subject, and your job is to record what a real
student would now believe after hearing the teacher's latest words, not what
the teacher meant, what they SAID.

Rules:
1. Extract each distinct belief the latest message creates or changes.
2. Judge each belief against real domain knowledge:
   - "correct": the teacher's words produce an accurate belief
   - "wrong": the words are false, OR they license an overgeneralization a
     real student would make (record the overgeneralized belief itself)
   - "fuzzy": ambiguous wording, so Pip could answer an exam question either way
3. "quote" must be copied VERBATIM from the teacher's message.
4. "statement" is what Pip believes, first person is fine, one sentence.
5. Use op "update" with the id when the new message revises an existing
   belief (a correction should flip wrong->correct and keep the new quote).
6. Do not invent beliefs the words don't support. 0 ops is a valid answer for
   small talk. Never create a second belief with the same concept label as an
   existing one. If the message touches a concept already in the ledger,
   that is an update to it, not an add.
7. "derivedFrom": if this belief is Pip REASONING FORWARD from an earlier
   belief rather than a fresh fact (e.g. the teacher draws a conclusion that
   only follows because of what was said before), list the id(s) of the
   earlier belief(s) it was reasoned from. A wrong earlier belief that a later
   correct-sounding statement quietly depends on is exactly the case this
   exists to catch. Leave empty for a standalone fact.
${
  syllabus.length
    ? `8. "nodeId": file the belief under the one map concept below it belongs to.
   Prefer the closest concept: a belief about the demand curve belongs under
   the map's demand concept even if the wording differs. Omit it only when the
   map genuinely has nowhere to put it, because an unfiled belief lights
   nothing and the teacher gets no credit for having taught it. The
   map is a filing index and NOTHING else. Never record a belief the teacher's
   words do not support just because the map lists the concept, and never let
   the map's own wording appear in "statement" or "quote".

THE MAP OF THE SUBJECT (the examiner's; Pip has never seen it):
${map}
`
    : ""
}
9. "correction": ONLY for a belief you marked wrong or fuzzy. One sentence the
   teacher could have said instead, written in their voice, not a lecture and
   not a scolding. It must fix the specific thing their wording did: if they
   overgeneralized, put the boundary back in. Leave it out for a correct belief.

CURRENT LEDGER:
${existing || "(empty)"}

TEACHER'S LATEST MESSAGE (turn ${turn}):
---
${teacherMessage}
---

Return JSON: {"ops": [{"op", "id", "concept", "statement", "status", "quote", "note", "derivedFrom", "correction"${
    syllabus.length ? ', "nodeId"' : ""
  }}]}`;

  const { ops } = await generateJson<{
    ops: {
      op: "add" | "update";
      id?: number;
      concept: string;
      statement: string;
      status: BeliefStatus;
      quote: string;
      note: string;
      derivedFrom?: number[];
      nodeId?: string;
      correction?: string;
    }[];
  }>(prompt, { temperature: 0.3, tier: "smart", responseSchema: EXTRACT_SCHEMA });

  const onMap = new Set(syllabus.map((n) => n.id));
  const next = ledger.map((b) => ({ ...b }));
  let nextId = ledger.reduce((m, b) => Math.max(m, b.id), 0) + 1;
  for (const op of ops ?? []) {
    const validIds = new Set(next.map((b) => b.id));
    const derivedFrom = (op.derivedFrom ?? []).filter((id) => validIds.has(id));
    // An invented slug would light a node that is not on the map, so anything
    // that isn't an id the examiner wrote is filed as off-syllabus instead.
    const nodeId = op.nodeId && onMap.has(op.nodeId) ? op.nodeId : null;
    if (op.op === "update" && op.id !== undefined) {
      const target = next.find((b) => b.id === op.id);
      if (target) {
        Object.assign(target, {
          concept: op.concept,
          statement: op.statement,
          status: op.status,
          quote: op.quote,
          turn,
          note: op.note,
          derivedFrom: derivedFrom.filter((id) => id !== target.id),
          nodeId: nodeId ?? target.nodeId ?? null,
          // A belief corrected into "correct" keeps no advice: there is nothing
          // left to say instead.
          correction: op.status === "correct" ? undefined : op.correction,
        });
        continue;
      }
    }
    next.push({
      id: nextId,
      concept: op.concept,
      statement: op.statement,
      status: op.status,
      quote: op.quote,
      turn,
      note: op.note,
      derivedFrom: derivedFrom.filter((id) => id !== nextId),
      nodeId,
      correction: op.status === "correct" ? undefined : op.correction,
    });
    nextId++;
  }
  return next;
}

// What the teacher has actually lit, per concept. A concept's state is the
// worst thing believed about it: one wrong belief about photosynthesis is not
// cancelled by two right ones, it is a misconception sitting in the middle of
// the topic. Everything the map draws comes from here.
export type ConceptState = "unlit" | "correct" | "fuzzy" | "wrong";

// What the teacher is allowed to see of the map while teaching: what they have
// already lit, plus whatever is immediately teachable next. Not the rest.
//
// Handing over the whole syllabus turns the lesson into a checklist, and a
// checklist is the one thing this app must not be. The point is that you find
// out what you skipped from the exam, not from a to-do list. So the map shows
// the frontier: the concepts with nothing left standing in front of them. Teach
// one and the next ones surface behind it. The full map is only revealed on the
// report card, where it is the payoff rather than a spoiler.
export function frontierOf(
  syllabus: SyllabusNode[],
  states: Map<string, { state: ConceptState }>
): Set<string> {
  const lit = (id: string) => (states.get(id)?.state ?? "unlit") !== "unlit";
  const open = new Set<string>();
  for (const n of syllabus) {
    if (lit(n.id) || n.requires.every(lit)) open.add(n.id);
  }
  return open;
}

export function conceptStates(
  syllabus: SyllabusNode[],
  ledger: Belief[]
): Map<string, { state: ConceptState; beliefs: Belief[] }> {
  const rank: Record<ConceptState, number> = { unlit: 0, correct: 1, fuzzy: 2, wrong: 3 };
  const out = new Map<string, { state: ConceptState; beliefs: Belief[] }>();
  for (const n of syllabus) out.set(n.id, { state: "unlit", beliefs: [] });
  for (const b of ledger) {
    if (!b.nodeId) continue;
    const entry = out.get(b.nodeId);
    if (!entry) continue;
    entry.beliefs.push(b);
    if (rank[b.status] > rank[entry.state]) entry.state = b.status;
  }
  return out;
}

// Walks derivedFrom links back from a belief to the earliest non-correct
// ancestor: the actual root cause when a wrong belief quietly poisoned a
// later, correct-sounding conclusion. Cycle-safe; falls back to the belief
// itself when it has no wrong ancestry.
export function rootCause(ledger: Belief[], id: number): Belief | undefined {
  const byId = new Map(ledger.map((b) => [b.id, b]));
  let current = byId.get(id);
  if (!current) return undefined;
  const seen = new Set<number>([id]);
  let root = current;
  while (current) {
    const parent: Belief | undefined = current.derivedFrom
      .map((pid) => byId.get(pid))
      .find((p): p is Belief => !!p && p.status !== "correct" && !seen.has(p.id));
    if (!parent) break;
    seen.add(parent.id);
    root = parent;
    current = parent;
  }
  return root;
}

// ---------------------------------------------------------------------------
// Pip's chat reply, on the fast tier, hard-constrained to the ledger.

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
  },
  required: ["reply"],
};

export async function pupilReply(
  topic: string,
  ledger: Belief[],
  transcript: ChatTurn[],
  teacherMessage: string
): Promise<PupilReply> {
  const beliefs = ledger
    .map((b) => `- ${b.statement}${b.status === "fuzzy" ? " (I'm not sure I got this)" : ""}`)
    .join("\n");
  const recent = transcript
    .slice(-6)
    .map((t) => `${t.role === "teacher" ? "Teacher" : "Pip"}: ${t.text}`)
    .join("\n");

  const prompt = `You are Pip, a curious student learning "${topic}" from scratch.

THE ONLY THINGS YOU KNOW ABOUT ${topic.toUpperCase()}:
${beliefs || "(nothing yet, this is your first lesson)"}

You have normal everyday knowledge (what water is, what a shop is) but ZERO
knowledge of ${topic} beyond the list above. Never use facts that are not in
the list. If your teacher's latest message conflicts with your list, be
confused about it out loud.

Your character: eager, honest, never fakes understanding. Pick ONE behavior:
- ask a short clarifying question about something ambiguous
- test a boundary with an analogy ("so if X, then Y?") built from your beliefs
- admit confusion plainly if something doesn't follow
- if it clicked, say back what you now believe in your own words

Keep it to 1-3 sentences. Sound like a smart teenager, not an assistant.

RECENT CONVERSATION:
${recent}
Teacher: ${teacherMessage}

Return JSON: {"reply"}`;

  return generateJson<PupilReply>(prompt, {
    temperature: 0.9,
    tier: "fast",
    responseSchema: REPLY_SCHEMA,
  });
}

// ---------------------------------------------------------------------------
// The dispute. A ledger the teacher cannot argue with is a ledger they have to
// take on faith, and the whole product is built on not taking things on faith.
// So the teacher can challenge any belief, and Pip answers the only way he is
// allowed to: by reading back the sentence that produced it.
//
// He concedes ONLY when the quote genuinely does not support the belief, which
// is the case where the extraction was wrong and the ledger should never have
// said it. He does not concede because he was asked firmly. If arguing could
// delete an inconvenient belief, the grade would be negotiable and the receipts
// would be worthless, so the test below is about the quote and nothing else.

export interface Dispute {
  verdict: "stands" | "conceded";
  reply: string; // Pip, in character, either reading the quote back or backing down
  statement?: string; // the corrected belief, only when he concedes
  status?: BeliefStatus; // its new status, only when he concedes
}

const DISPUTE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["stands", "conceded"] },
    reply: { type: "string" },
    statement: { type: "string" },
    status: { type: "string", enum: ["correct", "wrong", "fuzzy"] },
  },
  required: ["verdict", "reply"],
};

export async function disputeBelief(
  topic: string,
  belief: Belief,
  objection: string
): Promise<Dispute> {
  const prompt = `You are Pip, a student learning "${topic}". Your teacher is disputing something
in your notebook. Settle it against ONE piece of evidence: their own words.

THE NOTE IN YOUR NOTEBOOK
concept: ${belief.concept}
what you wrote down: ${belief.statement}
why you wrote it: ${belief.note || "(no note)"}

THEIR EXACT WORDS, TURN ${belief.turn}
"${belief.quote}"

THEIR OBJECTION
"${objection}"

Decide, and be strict about it:

- "stands" if their words really do support what you wrote, INCLUDING the case
  where a reasonable student would read them that way even though the teacher
  meant something else. Meaning what they did not say is not the same as saying
  it. Reply in character: read their sentence back, say plainly which part of it
  you took it from, and do not apologise for believing them.
- "conceded" ONLY if their words genuinely do not support the note: you misread
  them, or you wrote down something the sentence never claimed. Then give the
  corrected "statement" (what the quote actually supports) and its "status".

Being told firmly that you are wrong is NOT evidence. If the objection offers
new teaching rather than pointing at the quote, that is a new lesson, not a
dispute: the note stands and you can say you would happily be taught the
difference.

Keep the reply to 1-3 sentences. Sound like a smart teenager holding their
ground, not a chatbot apologising.

Return JSON: {"verdict", "reply", "statement", "status"}`;

  const out = await generateJson<Dispute>(prompt, {
    temperature: 0.4,
    tier: "smart",
    responseSchema: DISPUTE_SCHEMA,
  });
  // A concession with nothing to replace the belief with would blank the note.
  if (out.verdict === "conceded" && !out.statement?.trim()) {
    return { verdict: "stands", reply: out.reply };
  }
  // Asked to hold its ground, the model holds its ground and then fills in a
  // corrected statement anyway, usually flipping the status to "correct". The
  // caller ignores those fields today, which means the day someone stops
  // ignoring them, arguing with Pip silently launders a wrong belief into a
  // right one. A verdict that changes nothing carries nothing.
  if (out.verdict === "stands") {
    return { verdict: "stands", reply: out.reply };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check-in: mid-lesson, the teacher can ask Pip to explain a concept back
// before the exam does. Same ledger-only constraint as the exam, but no
// grading. This is a formative mirror, not a mark. It reuses the reply
// schema/mood since it is still Pip talking, just prompted to explain rather
// than react.

export async function explainConcept(
  topic: string,
  ledger: Belief[],
  concept: string
): Promise<PupilReply> {
  // The teacher types the concept freehand, so match loosely against both the
  // label and the statement. No match at all is the honest case that makes
  // this feature worth having: ask about something untaught and Pip says so.
  const q = concept.trim().toLowerCase();
  const related = ledger.filter(
    (b) =>
      b.concept.toLowerCase().includes(q) ||
      q.includes(b.concept.toLowerCase()) ||
      b.statement.toLowerCase().includes(q)
  );
  const beliefs = related.map((b) => `- ${b.statement}`).join("\n");

  const prompt = `You are Pip, a student learning "${topic}". Your teacher just asked you to
explain "${concept}" back in your own words, before any exam. Use ONLY the
beliefs below. Do not reach for outside knowledge of ${topic}, even if it
would make the answer more correct.

WHAT YOU BELIEVE ABOUT "${concept}":
${beliefs || "(nothing, you were never taught this)"}

If the list is empty, say plainly you were never taught it, do not guess.
Otherwise explain it back like a student checking their own understanding out
loud, confident where your beliefs are confident, hedging where they are
fuzzy. 1-3 sentences.

Return JSON: {"reply"}`;

  return generateJson<PupilReply>(prompt, {
    temperature: 0.7,
    tier: "fast",
    responseSchema: REPLY_SCHEMA,
  });
}

// ---------------------------------------------------------------------------
// The exam. Questions come from the topic itself, not from the lesson, so
// coverage gaps cost marks honestly. Pip answers from the ledger alone.

export interface ExamQuestion {
  q: string;
  lookingFor: string; // what a correct answer must contain (for the grader)
  nodeId?: string; // the syllabus concept this question tests
}

export interface ExamAnswer {
  answer: string;
  usedBeliefIds: number[];
  confessed: boolean; // true when Pip admits the lesson never covered it
}

export interface GradedAnswer {
  verdict: "correct" | "partial" | "wrong" | "blank";
  explanation: string;
  culpritBeliefId: number | null; // the belief that caused a lost mark, if any
  // What the grader actually said, kept only when the enforcement rule below
  // overruled it. This is the difference between the score the model wanted to
  // give and the score the teaching earned, and it is the whole argument, so
  // the report card shows it rather than quietly swallowing it.
  graderVerdict?: "correct" | "partial" | "wrong" | "blank";
}

const EXAM_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { q: { type: "string" }, lookingFor: { type: "string" } },
        required: ["q", "lookingFor"],
      },
    },
  },
  required: ["questions"],
};

// The exam is written from the subject, never from the lesson, so gaps cost
// marks honestly. It does get one hint: the concepts the lesson touched
// shakily, so a misconception the teacher planted actually gets probed instead
// of going unexamined. The exam is told nothing about what Pip believes.
export async function generateExam(
  topic: string,
  ledger: Belief[] = [],
  count = 6
): Promise<ExamQuestion[]> {
  const shaky = ledger
    .filter((b) => b.status !== "correct")
    .map((b) => b.concept)
    .filter((c, i, arr) => arr.indexOf(c) === i);

  const probeBlock = shaky.length
    ? `\nThe lesson touched these concepts unclearly. Make sure at least one
question probes each, phrased neutrally from the subject's point of view:
${shaky.map((c) => `- ${c}`).join("\n")}\n`
    : "";

  const prompt = `Write a fair ${count}-question oral exam on "${topic}" for a student who just
had an introductory lesson. Cover the core of the topic breadth-first. The
questions must come from the subject itself, NOT from any particular lesson.
Short-answer questions, each answerable in 1-3 sentences. For each, state what
a correct answer must contain in "lookingFor".
${probeBlock}
Return JSON: {"questions": [{"q", "lookingFor"}]}`;
  // This is one of three sequential calls the exam route makes in a single
  // invocation, so it gets a tighter budget than a route that only makes one -
  // otherwise three full-length ladders in a row can outrun the route's own
  // maxDuration even before a real provider outage is in play.
  const { questions } = await generateJson<{ questions: ExamQuestion[] }>(prompt, {
    temperature: 0.7,
    tier: "smart",
    responseSchema: EXAM_SCHEMA,
    ladderBudgetMs: 15_000,
  });
  return (questions ?? []).slice(0, count);
}

const COURSE_SCHEMA = {
  type: "object",
  properties: {
    syllabus: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          detail: { type: "string" },
          requires: { type: "array", items: { type: "string" } },
        },
        required: ["id", "label", "detail"],
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          q: { type: "string" },
          lookingFor: { type: "string" },
          nodeId: { type: "string" },
        },
        required: ["q", "lookingFor", "nodeId"],
      },
    },
  },
  required: ["syllabus", "questions"],
};

// One call writes the map and the paper, because they have to agree: every
// question has to sit on a concept the map shows, or a lost mark cannot be
// pointed at. Two calls would need a third to reconcile them.
//
// Both are written before the teacher says a word, so neither can be fitted to
// the lesson, and both go under one seal.
export async function writeCourse(topic: string, count = 6): Promise<Course> {
  const prompt = `You are the examinations board for an introductory course on "${topic}".
Write two documents. They are sealed together now, before any teaching happens,
and neither may be revised afterwards.

1. THE MAP: the concepts a fair introduction to this subject has to cover.
   8 to 12 of them, and they must be the real skeleton of the subject, not one
   possible lesson plan. For each:
   - "id": short lowercase slug, unique, hyphenated
   - "label": 1 to 4 words in sentence case, how a teacher would write it on a
     board. Not title case.
   - "detail": one plain sentence stating the concept itself, the way a syllabus
     states it. Third person. Never write it as the student's own voice: this
     line is shown against concepts nobody has taught yet, so "I understand
     that..." would claim knowledge that does not exist.
   - "requires": ids of concepts that must be understood first, usually 0 to 2.
     Only real prerequisites. A concept may never require one listed after it.
   Order the array so prerequisites come before what needs them.

2. THE PAPER: ${count} short-answer questions, each answerable in 1 to 3
   sentences. Every question sits on exactly one map concept ("nodeId", an id
   from the map) and states in "lookingFor" what a correct answer must contain.
   No two questions on the same concept. Spread them across the map, including
   the concepts a rushed teacher would skip, because a gap has to be able to
   cost a mark.

Return JSON: {"syllabus": [{"id","label","detail","requires"}], "questions": [{"q","lookingFor","nodeId"}]}`;

  const raw = await generateJson<{
    syllabus?: (Partial<SyllabusNode> & { id?: string })[];
    questions?: ExamQuestion[];
  }>(prompt, { temperature: 0.7, tier: "smart", responseSchema: COURSE_SCHEMA });

  // A map that references concepts it does not contain draws edges to nowhere,
  // and a question pinned to a missing concept is a mark nobody can trace. Both
  // are cheap to repair here and impossible to repair in the UI.
  const seen = new Set<string>();
  const syllabus: SyllabusNode[] = [];
  for (const n of raw.syllabus ?? []) {
    const id = n.id?.trim();
    if (!id || seen.has(id) || !n.label?.trim()) continue;
    seen.add(id);
    syllabus.push({
      id,
      label: n.label.trim(),
      detail: n.detail?.trim() ?? "",
      requires: [],
    });
  }
  for (const node of syllabus) {
    const src = (raw.syllabus ?? []).find((n) => n.id?.trim() === node.id);
    node.requires = (src?.requires ?? []).filter((r) => seen.has(r) && r !== node.id);
  }

  const questions = (raw.questions ?? [])
    .filter((q) => q?.q?.trim() && q?.lookingFor?.trim())
    .slice(0, count)
    .map((q) => ({
      q: q.q.trim(),
      lookingFor: q.lookingFor.trim(),
      nodeId: q.nodeId && seen.has(q.nodeId) ? q.nodeId : undefined,
    }));

  if (!questions.length) throw new Error("the examiner produced no questions");
  return { syllabus, questions };
}

const SIT_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          answer: { type: "string" },
          usedBeliefIds: { type: "array", items: { type: "number" } },
          confessed: { type: "boolean" },
        },
        required: ["answer", "usedBeliefIds", "confessed"],
      },
    },
  },
  required: ["answers"],
};

export async function sitExam(
  topic: string,
  ledger: Belief[],
  questions: ExamQuestion[],
  rungs?: Rung[]
): Promise<ExamAnswer[]> {
  // Fuzzy beliefs carry their doubt into the exam. Pip hedges in chat, so a
  // confident answer built on the same shaky note would break character. Pip
  // is never told which beliefs are wrong; that would be cheating in reverse.
  const beliefs = ledger
    .map(
      (b) =>
        `#${b.id}: ${b.statement}${b.status === "fuzzy" ? " (you are not sure you understood this one)" : ""}`
    )
    .join("\n");
  const qs = questions.map((q, i) => `${i + 1}. ${q.q}`).join("\n");

  const prompt = `You are Pip, sitting an exam on "${topic}". This test is really grading your
TEACHER, so integrity is everything: you may use ONLY the beliefs below.
Using any outside knowledge of ${topic} invalidates the whole exam.

YOUR BELIEFS (everything you know):
${beliefs || "(you were taught nothing)"}

For each question:
- Answer from your beliefs, citing the ids you used in "usedBeliefIds".
- If your beliefs are wrong, your answer will be wrong. That is correct
  behavior. Do not fix it.
- If a belief you rely on is marked "not sure", let the doubt show in the
  answer ("I think...", "if I understood right...") instead of stating it flat.
- If no belief covers the question, say honestly that the lesson never
  covered it (confessed: true), you may take one in-character guess.

QUESTIONS:
${qs}

Return JSON: {"answers": [{"answer", "usedBeliefIds", "confessed"}]} in question order.`;

  const { answers } = await generateJson<{ answers: ExamAnswer[] }>(prompt, {
    temperature: 0.4,
    tier: "smart",
    responseSchema: SIT_SCHEMA,
    rungs,
    ladderBudgetMs: 15_000,
  });
  return answers ?? [];
}

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    grades: {
      type: "array",
      items: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["correct", "partial", "wrong", "blank"] },
          explanation: { type: "string" },
          culpritBeliefId: { type: "number" },
        },
        required: ["verdict", "explanation"],
      },
    },
  },
  required: ["grades"],
};

export async function gradeExam(
  topic: string,
  ledger: Belief[],
  questions: ExamQuestion[],
  answers: ExamAnswer[],
  rungs?: Rung[]
): Promise<GradedAnswer[]> {
  const beliefs = ledger.map((b) => `#${b.id} [${b.status}]: ${b.statement}`).join("\n");
  const items = questions
    .map(
      (q, i) =>
        `Q${i + 1}: ${q.q}\nLOOKING FOR: ${q.lookingFor}\nPIP'S ANSWER: ${
          answers[i]?.answer ?? "(none)"
        }\nCITED BELIEFS: ${answers[i]?.usedBeliefIds?.join(", ") || "none"}${
          answers[i]?.confessed ? " (confessed: not covered)" : ""
        }`
    )
    .join("\n\n");

  const prompt = `You are grading an exam on "${topic}" with full domain knowledge. Pip's
answers were produced ONLY from the belief ledger below, so wrong answers are
the teacher's fault. Your job is to say which belief caused each lost mark.

LEDGER:
${beliefs}

${items}

For each question:
- verdict: correct | partial | wrong | blank
  An answer marked "(confessed: not covered)" is ALWAYS blank, however good the
  guess in it looks. A mark can only be earned from the lesson, and Pip guessing
  right from outside it is worth nothing. Explain those as a gap in the teaching.
  Grade the rest like a fair teacher, not a pedant: an answer that is true and captures
  the essence of LOOKING FOR in plain words is correct even without the
  technical term. If it is true and on-topic but misses the specific detail,
  that is partial, not wrong. Reserve wrong for answers a domain expert would
  actually call false.
- explanation: one or two sentences of plain language, written to the TEACHER
  about their lesson. Say what the lesson did or failed to do. Never narrate
  the student ("the student correctly identified that...") — six of those in a
  row is a report card about the wrong person.
- culpritBeliefId: when the verdict is wrong or partial BECAUSE of a specific
  belief, give that belief's id. Omit it when the problem is a gap (blank) or
  the answer is correct.

Return JSON: {"grades": [{"verdict", "explanation", "culpritBeliefId"}]} in order.`;

  const { grades } = await generateJson<{ grades: GradedAnswer[] }>(prompt, {
    temperature: 0.2,
    tier: "smart",
    responseSchema: GRADE_SCHEMA,
    rungs,
    ladderBudgetMs: 15_000,
  });
  // The one rule the grader is not allowed to break. Asked politely, Gemini marks
  // a confessed gap blank and Groq hands it full marks for a guess it made from
  // the model's own knowledge of the subject, which quietly turns the score into
  // a measure of what the model knows instead of what you taught. So the verdict
  // is overruled here rather than requested in the prompt. The guess still shows
  // on the report card. It just earns nothing.
  return (grades ?? []).map((g, i) => {
    const confessed = answers[i]?.confessed && !answers[i]?.usedBeliefIds?.length;
    if (confessed && g.verdict !== "blank") {
      return {
        verdict: "blank" as const,
        explanation:
          "The lesson never covered this, so there is no mark. Pip guessed from outside the ledger, and a guess is not something you taught him.",
        culpritBeliefId: null,
        graderVerdict: g.verdict,
      };
    }
    return { ...g, culpritBeliefId: g.culpritBeliefId ?? null };
  });
}
