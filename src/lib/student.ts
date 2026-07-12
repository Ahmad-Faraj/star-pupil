// Pip, the star pupil. The single source of truth is the belief ledger:
// structured beliefs extracted from the teacher's own words, each carrying the
// exact quote that created it. Pip chats from the ledger, sits the exam from
// the ledger, and every lost mark traces back to a quote. No hidden knowledge
// anywhere — that constraint is the product.

import { generateJson } from "./llm";

export type BeliefStatus = "correct" | "wrong" | "fuzzy";

export interface Belief {
  id: number;
  concept: string; // short label, becomes a node on the map
  statement: string; // what Pip now believes, in Pip's words
  status: BeliefStatus; // judged against real domain knowledge at extraction time
  quote: string; // the teacher's exact words that produced this belief
  turn: number; // which teacher message it came from
  note: string; // why it got this status (for wrong: the licensed overgeneralization)
}

export interface ChatTurn {
  role: "teacher" | "pupil";
  text: string;
}

export interface PupilReply {
  reply: string;
  mood: "curious" | "confused" | "lightbulb" | "worried";
}

// ---------------------------------------------------------------------------
// Belief extraction — runs after each teacher message. This is where honest
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
  turn: number
): Promise<Belief[]> {
  const existing = ledger
    .map((b) => `#${b.id} [${b.status}] ${b.concept}: ${b.statement}`)
    .join("\n");

  const prompt = `You maintain the belief state of Pip, a student being taught "${topic}".
Pip is intelligent but knows nothing about this topic except what the teacher
has said. You DO know the subject, and your job is to record what a real
student would now believe after hearing the teacher's latest words — not what
the teacher meant, what they SAID.

Rules:
1. Extract each distinct belief the latest message creates or changes.
2. Judge each belief against real domain knowledge:
   - "correct": the teacher's words produce an accurate belief
   - "wrong": the words are false, OR they license an overgeneralization a
     real student would make (record the overgeneralized belief itself)
   - "fuzzy": ambiguous wording — Pip could answer an exam question either way
3. "quote" must be copied VERBATIM from the teacher's message.
4. "statement" is what Pip believes, first person is fine, one sentence.
5. Use op "update" with the id when the new message revises an existing
   belief (a correction should flip wrong->correct and keep the new quote).
6. Do not invent beliefs the words don't support. 0 ops is a valid answer for
   small talk.

CURRENT LEDGER:
${existing || "(empty)"}

TEACHER'S LATEST MESSAGE (turn ${turn}):
---
${teacherMessage}
---

Return JSON: {"ops": [{"op", "id", "concept", "statement", "status", "quote", "note"}]}`;

  const { ops } = await generateJson<{
    ops: {
      op: "add" | "update";
      id?: number;
      concept: string;
      statement: string;
      status: BeliefStatus;
      quote: string;
      note: string;
    }[];
  }>(prompt, { temperature: 0.3, tier: "smart", responseSchema: EXTRACT_SCHEMA });

  const next = ledger.map((b) => ({ ...b }));
  let nextId = ledger.reduce((m, b) => Math.max(m, b.id), 0) + 1;
  for (const op of ops ?? []) {
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
        });
        continue;
      }
    }
    next.push({
      id: nextId++,
      concept: op.concept,
      statement: op.statement,
      status: op.status,
      quote: op.quote,
      turn,
      note: op.note,
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Pip's chat reply — fast tier, hard-constrained to the ledger.

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    mood: { type: "string", enum: ["curious", "confused", "lightbulb", "worried"] },
  },
  required: ["reply", "mood"],
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
${beliefs || "(nothing yet — this is your first lesson)"}

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

Return JSON: {"reply", "mood"} (mood: curious | confused | lightbulb | worried)`;

  return generateJson<PupilReply>(prompt, {
    temperature: 0.9,
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
had an introductory lesson. Cover the core of the topic breadth-first — the
questions must come from the subject itself, NOT from any particular lesson.
Short-answer questions, each answerable in 1-3 sentences. For each, state what
a correct answer must contain in "lookingFor".
${probeBlock}
Return JSON: {"questions": [{"q", "lookingFor"}]}`;
  const { questions } = await generateJson<{ questions: ExamQuestion[] }>(prompt, {
    temperature: 0.7,
    tier: "smart",
    responseSchema: EXAM_SCHEMA,
  });
  return (questions ?? []).slice(0, count);
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
  questions: ExamQuestion[]
): Promise<ExamAnswer[]> {
  const beliefs = ledger.map((b) => `#${b.id}: ${b.statement}`).join("\n");
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
- If no belief covers the question, say honestly that the lesson never
  covered it (confessed: true) — you may take one in-character guess.

QUESTIONS:
${qs}

Return JSON: {"answers": [{"answer", "usedBeliefIds", "confessed"}]} in question order.`;

  const { answers } = await generateJson<{ answers: ExamAnswer[] }>(prompt, {
    temperature: 0.4,
    tier: "smart",
    responseSchema: SIT_SCHEMA,
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
  answers: ExamAnswer[]
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
the teacher's fault — your job is to say which belief caused each lost mark.

LEDGER:
${beliefs}

${items}

For each question:
- verdict: correct | partial | wrong | blank (blank = confessed, no real answer)
- explanation: one or two sentences, plain language
- culpritBeliefId: when the verdict is wrong or partial BECAUSE of a specific
  belief, give that belief's id. Omit it when the problem is a gap (blank) or
  the answer is correct.

Return JSON: {"grades": [{"verdict", "explanation", "culpritBeliefId"}]} in order.`;

  const { grades } = await generateJson<{ grades: GradedAnswer[] }>(prompt, {
    temperature: 0.2,
    tier: "smart",
    responseSchema: GRADE_SCHEMA,
  });
  return (grades ?? []).map((g) => ({ ...g, culpritBeliefId: g.culpritBeliefId ?? null }));
}
