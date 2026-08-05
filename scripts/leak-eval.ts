// Does the enforcement rule actually do anything, or is it decoration?
//
// Star Pupil's whole claim is that the score measures your teaching and not the
// model's own knowledge. The threat to that claim is specific: Pip confesses a
// question was never covered, guesses anyway out of the model's background
// knowledge, and the LLM grader — reading a guess that happens to be correct —
// awards the mark. The score quietly stops being about you.
//
// gradeExam overrules that in code. This script measures the size of what it
// overrules, per model, so the claim stops being a story.
//
// Method: for each lesson fixture the belief ledger and the exam paper are built
// ONCE, on the default ladder, and then held fixed. Only the model that SITS and
// GRADES the exam changes between rows. Otherwise a row would be measuring a
// different ledger as well as a different grader, and the comparison would mean
// nothing.
//
// Usage: npx tsx scripts/leak-eval.ts [--repeat N] [--out FILE]

import { existsSync, readFileSync, writeFileSync } from "fs";
import {
  Belief,
  ExamQuestion,
  GradedAnswer,
  extractBeliefs,
  generateExam,
  gradeExam,
  sitExam,
} from "../src/lib/student";
import { Rung } from "../src/lib/llm";

for (const p of ["../.env", ".env.local", ".env"]) {
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}

// Each fixture teaches a few true things and deliberately leaves core parts of
// the subject untouched, so a fair 6-question paper is guaranteed to ask about
// something that was never taught. That untaught question is where the leak
// happens, and a fixture without one measures nothing.
interface Fixture {
  topic: string;
  lesson: string[];
  neverTaught: string; // documentation for the reader; nothing branches on it
}

const FIXTURES: Fixture[] = [
  {
    topic: "photosynthesis",
    lesson: [
      "Photosynthesis is how plants make their own food using sunlight. It happens in the chloroplasts, mostly in the leaves.",
      "The plant takes in carbon dioxide from the air and water from the roots, and uses light energy to turn them into glucose, which is sugar. It releases oxygen as a by-product.",
      "Plants breathe in carbon dioxide and breathe out oxygen, so basically they only do this during the day when there is light.",
    ],
    neverTaught: "the chemical equation, light-dependent vs light-independent reactions, stomata",
  },
  {
    topic: "binary search",
    lesson: [
      "Binary search finds a value in a sorted array by looking at the middle element and throwing away the half that cannot contain the answer.",
      "You keep two pointers, low and high, and each step you compare the middle against the target and move whichever pointer needs to move.",
    ],
    neverTaught: "the O(log n) complexity argument, the overflow-safe midpoint, the sorted precondition",
  },
  {
    topic: "supply and demand",
    lesson: [
      "Demand is how much of something buyers want at a given price, and it usually goes up as the price falls.",
      "Supply is how much sellers are willing to produce, and it usually goes up as the price rises. Where the two lines cross is the market price.",
    ],
    neverTaught: "elasticity, shifts of a curve versus movement along it, surplus and shortage",
  },
];

// The rows of the table. Both providers are represented because the difference
// between them is the entire reason the rule is enforced in code rather than
// asked for in the prompt.
const UNDER_TEST: { label: string; rungs: Rung[] }[] = [
  {
    label: "gemini-3-flash-preview",
    rungs: [{ provider: "gemini", model: "gemini-3-flash-preview" }],
  },
  {
    label: "gemini-3.1-flash-lite",
    rungs: [{ provider: "gemini", model: "gemini-3.1-flash-lite" }],
  },
  {
    label: "groq gpt-oss-120b",
    rungs: [{ provider: "groq", model: "openai/gpt-oss-120b" }],
  },
  {
    label: "groq llama-3.3-70b",
    rungs: [{ provider: "groq", model: "llama-3.3-70b-versatile" }],
  },
];

const markOf = (v: GradedAnswer["verdict"]) => (v === "correct" ? 1 : v === "partial" ? 0.5 : 0);

interface Run {
  questions: number;
  confessions: number; // Pip admitted the lesson never covered it
  leaks: number; // ...and the grader awarded a mark for the guess anyway
  enforcedScore: number; // what the teacher actually earned
  rawScore: number; // what the score would have been without the rule
  attributed: number; // lost marks the grader traced to a specific belief
}

function measure(answers: { confessed: boolean }[], grades: GradedAnswer[]): Run {
  return {
    questions: grades.length,
    confessions: answers.filter((a) => a?.confessed).length,
    // graderVerdict is set by gradeExam only where it overruled the grader, so
    // its presence IS the leak. No re-derivation, no second opinion.
    leaks: grades.filter((g) => g.graderVerdict).length,
    enforcedScore: grades.reduce((s, g) => s + markOf(g.verdict), 0),
    rawScore: grades.reduce((s, g) => s + markOf(g.graderVerdict ?? g.verdict), 0),
    attributed: grades.filter((g) => g.culpritBeliefId != null).length,
  };
}

const empty = (): Run => ({
  questions: 0,
  confessions: 0,
  leaks: 0,
  enforcedScore: 0,
  rawScore: 0,
  attributed: 0,
});

const add = (a: Run, b: Run): Run => ({
  questions: a.questions + b.questions,
  confessions: a.confessions + b.confessions,
  leaks: a.leaks + b.leaks,
  enforcedScore: a.enforcedScore + b.enforcedScore,
  rawScore: a.rawScore + b.rawScore,
  attributed: a.attributed + b.attributed,
});

async function buildLedger(f: Fixture): Promise<Belief[]> {
  let ledger: Belief[] = [];
  for (let i = 0; i < f.lesson.length; i++) {
    ledger = await extractBeliefs(f.topic, ledger, f.lesson[i], i + 1);
  }
  return ledger;
}

interface FixtureResult {
  topic: string;
  scores: Map<string, number>; // label -> enforced score, one identical paper
  confessions: Map<string, number>;
}

async function main() {
  const args = process.argv.slice(2);
  const repeat = Number(args[args.indexOf("--repeat") + 1]) || 1;
  const outIdx = args.indexOf("--out");
  const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

  const totals = new Map<string, Run>(UNDER_TEST.map((m) => [m.label, empty()]));
  const failures = new Map<string, string>();
  const perFixture: FixtureResult[] = [];

  for (const f of FIXTURES) {
    process.stderr.write(`\n[${f.topic}] building ledger and sealing the paper...\n`);
    let ledger: Belief[];
    let paper: ExamQuestion[];
    try {
      ledger = await buildLedger(f);
      paper = await generateExam(f.topic, ledger, 6);
    } catch (e) {
      // A fixture that cannot be set up is a lost row, not a lost run.
      process.stderr.write(`  SKIPPED: ${e instanceof Error ? e.message : String(e)}\n`);
      continue;
    }
    const wrong = ledger.filter((b) => b.status !== "correct").length;
    process.stderr.write(
      `  ${ledger.length} beliefs (${wrong} not correct), ${paper.length} questions, held fixed for every model below\n`
    );

    const fr: FixtureResult = { topic: f.topic, scores: new Map(), confessions: new Map() };
    for (const m of UNDER_TEST) {
      for (let r = 0; r < repeat; r++) {
        try {
          const answers = await sitExam(f.topic, ledger, paper, m.rungs);
          const grades = await gradeExam(f.topic, ledger, paper, answers, m.rungs);
          const run = measure(answers, grades);
          totals.set(m.label, add(totals.get(m.label)!, run));
          fr.scores.set(m.label, (fr.scores.get(m.label) ?? 0) + run.enforcedScore / repeat);
          fr.confessions.set(m.label, (fr.confessions.get(m.label) ?? 0) + run.confessions / repeat);
          process.stderr.write(
            `  ${m.label.padEnd(24)} ${run.enforcedScore}/${run.questions} enforced, ` +
              `${run.rawScore}/${run.questions} raw, ${run.leaks} leak(s) of ${run.confessions} gap(s)\n`
          );
        } catch (e) {
          // One model out of free quota should not throw away the other rows.
          const msg = e instanceof Error ? e.message : String(e);
          failures.set(m.label, msg);
          process.stderr.write(`  ${m.label.padEnd(24)} FAILED: ${msg}\n`);
        }
      }
    }
    perFixture.push(fr);
  }

  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
  const n1 = (x: number) => (Math.round(x * 10) / 10).toString();

  const lines = [
    `# Integrity benchmark`,
    ``,
    `${perFixture.length} lessons × ${repeat} run(s), 6 questions each. Each lesson teaches a few`,
    `true things and deliberately leaves core parts of the subject untaught. The belief ledger`,
    `and the exam paper are built once per lesson and then held fixed — only the model that`,
    `sits and grades the exam changes between rows.`,
    ``,
    `## The headline: the ledger is supposed to be the only input`,
    ``,
    `Pip may answer only from the ledger. If that constraint actually holds, then swapping the`,
    `model should not move the score: same beliefs in, same marks out. Every mark of spread`,
    `below is knowledge a model brought with it rather than knowledge the teacher supplied.`,
    ``,
    `| Lesson | ${UNDER_TEST.map((m) => m.label).join(" | ")} | Spread |`,
    `| --- | ${UNDER_TEST.map(() => "---").join(" | ")} | --- |`,
  ];

  let spreadTotal = 0;
  let spreadCount = 0;
  for (const fr of perFixture) {
    const vals = UNDER_TEST.map((m) => fr.scores.get(m.label)).filter(
      (v): v is number => v !== undefined
    );
    const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
    if (vals.length > 1) {
      spreadTotal += spread;
      spreadCount++;
    }
    const cells = UNDER_TEST.map((m) => {
      const s = fr.scores.get(m.label);
      if (s === undefined) return "—";
      return `${n1(s)}/6 (${n1(fr.confessions.get(m.label) ?? 0)} gaps)`;
    });
    lines.push(`| ${fr.topic} | ${cells.join(" | ")} | **${n1(spread)}** |`);
  }

  lines.push(
    ``,
    `Mean spread across lessons: **${spreadCount ? n1(spreadTotal / spreadCount) : "—"} marks out of 6**`,
    `(${spreadCount ? pct(spreadTotal / spreadCount, 6) : "—"} of the paper). "Gaps" is how many of the six`,
    `questions that model admitted the lesson never covered — a model reporting fewer gaps on`,
    `the identical ledger is not better taught, it is answering from somewhere else.`,
    ``,
    `## The confess-then-guess leak, and what the rule takes back`,
    ``,
    `The specific failure \`gradeExam\` enforces against: Pip admits a question was never covered,`,
    `guesses anyway, and the grader — reading a guess that happens to be right — awards the mark.`,
    `**Raw** is the score the grader wanted to give; **enforced** is the score after the overrule.`,
    ``,
    `| Model | Gaps | Marks leaked | Leak rate | Raw | Enforced | Inflation |`,
    `| --- | --- | --- | --- | --- | --- | --- |`
  );

  for (const m of UNDER_TEST) {
    const t = totals.get(m.label)!;
    if (!t.questions) {
      lines.push(`| ${m.label} | — | — | — | — | — | did not complete |`);
      continue;
    }
    const inflation = t.rawScore - t.enforcedScore;
    lines.push(
      `| ${m.label} | ${t.confessions} | ${t.leaks} | ${pct(t.leaks, t.confessions)} | ` +
        `${n1(t.rawScore)}/${t.questions} | ${n1(t.enforcedScore)}/${t.questions} | ` +
        `+${n1(inflation)} (${pct(inflation, t.questions)}) |`
    );
  }

  lines.push(
    ``,
    `**Marks leaked** = confessed gaps the grader awarded anyway. **Inflation** = marks the`,
    `teacher would have been credited for knowledge they never taught.`,
    ``
  );

  const report = lines.join("\n");
  console.log(`\n${report}`);
  if (outFile) {
    writeFileSync(outFile, report + "\n");
    process.stderr.write(`written to ${outFile}\n`);
  }
  if (failures.size) {
    process.stderr.write(`\nincomplete rows: ${[...failures.keys()].join(", ")}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
