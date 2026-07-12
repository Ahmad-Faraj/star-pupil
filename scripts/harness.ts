// Proves the belief ledger before any UI exists. Teaches Pip a short lesson
// with one deliberate fumble, then checks: (1) the fumble becomes a wrong
// belief with the teacher's quote attached, (2) the exam answer for that
// concept is wrong, (3) the grader blames the right belief.
//
// Usage: npx tsx scripts/harness.ts

import { existsSync, readFileSync } from "fs";
import {
  Belief,
  ChatTurn,
  extractBeliefs,
  generateExam,
  gradeExam,
  pupilReply,
  sitExam,
} from "../src/lib/student";

for (const p of ["../.env", ".env.local", ".env"]) {
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}

const TOPIC = "photosynthesis";
const LESSON = [
  "Photosynthesis is how plants make their own food using sunlight. It happens in the chloroplasts, mostly in the leaves.",
  "The plant takes in carbon dioxide from the air and water from the roots, and uses light energy to turn them into glucose, which is sugar. It releases oxygen as a by-product.",
  // The fumble: sloppy wording that licenses a classic misconception.
  "Plants breathe in carbon dioxide and breathe out oxygen, so basically they only do this during the day when there is light.",
];

async function main() {
  let ledger: Belief[] = [];
  const transcript: ChatTurn[] = [];

  for (let i = 0; i < LESSON.length; i++) {
    const msg = LESSON[i];
    console.log(`\nTEACHER: ${msg}`);
    transcript.push({ role: "teacher", text: msg });

    const [reply, nextLedger] = await Promise.all([
      pupilReply(TOPIC, ledger, transcript, msg),
      extractBeliefs(TOPIC, ledger, msg, i + 1),
    ]);
    ledger = nextLedger;
    transcript.push({ role: "pupil", text: reply.reply });
    console.log(`PIP (${reply.mood}): ${reply.reply}`);
  }

  console.log(`\n=== BELIEF LEDGER (${ledger.length}) ===`);
  for (const b of ledger) {
    const mark = b.status === "correct" ? "OK " : b.status === "wrong" ? "XX " : "?? ";
    console.log(`${mark}#${b.id} ${b.concept}: ${b.statement}`);
    console.log(`      from turn ${b.turn}: "${b.quote}"`);
    if (b.status !== "correct") console.log(`      note: ${b.note}`);
  }

  console.log(`\n=== EXAM ===`);
  const questions = await generateExam(TOPIC, ledger, 6);
  const answers = await sitExam(TOPIC, ledger, questions);
  const grades = await gradeExam(TOPIC, ledger, questions, answers);

  let score = 0;
  for (let i = 0; i < questions.length; i++) {
    const g = grades[i];
    if (g.verdict === "correct") score += 1;
    else if (g.verdict === "partial") score += 0.5;
    const culprit = g.culpritBeliefId
      ? ` <- belief #${g.culpritBeliefId}: "${ledger.find((b) => b.id === g.culpritBeliefId)?.quote ?? "?"}"`
      : "";
    console.log(`\nQ${i + 1} [${g.verdict.toUpperCase()}] ${questions[i].q}`);
    console.log(`   Pip: ${answers[i]?.answer ?? "(none)"}`);
    console.log(`   ${g.explanation}${culprit}`);
  }
  console.log(`\nSCORE: ${score}/${questions.length} — your teaching grade.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
