// A pre-baked lesson and exam, played back with no API calls. Two jobs: let a
// judge see the whole loop in one click without teaching from scratch, and
// give a live demo something to fall back on if Gemini's free tier is
// throttled mid-judging. Deliberately the same shape as a real session:
// including one planted wrong belief, one uncovered gap, and one derived
// (built-on-a-wrong-belief) chain, so it exercises the same UI paths.

import { Belief, ChatTurn, ExamAnswer, ExamQuestion, GradedAnswer } from "./student";

export const SEED_TOPIC = "hash tables";

export const SEED_TRANSCRIPT: ChatTurn[] = [
  { role: "pupil", text: "Okay. I know nothing about hash tables, and I mean nothing. Teach me." },
  { role: "teacher", text: "A hash table turns a key into an array index using a hash function." },
  {
    role: "pupil",
    text: "Got it, so the hash function is basically a formula that spits out where in the array my key lives?",
  },
  {
    role: "teacher",
    text: "Right. And when two keys hash to the same index, that's called a collision, and chaining handles it by keeping a small linked list at that index.",
  },
  {
    role: "pupil",
    text: "Oh nice, so the slot isn't just one value, it's a little bucket that can hold a few if they crash into each other.",
  },
  {
    role: "teacher",
    text: "Exactly, so lookup is always O(1), no matter what, even with all those collisions.",
  },
  {
    role: "pupil",
    text: "Wait, always? Even if a bucket gets long from a bunch of collisions, checking it is still instant?",
  },
  {
    role: "teacher",
    text: "So a hash table is always the better choice than a sorted array whenever you need fast lookups.",
  },
  {
    role: "pupil",
    text: "Always the better choice? Even if collisions pile up in one bucket?",
  },
];

export const SEED_LEDGER: Belief[] = [
  {
    id: 1,
    concept: "hash function",
    statement: "A hash table uses a hash function to turn a key into an index in the array.",
    status: "correct",
    quote: "A hash table turns a key into an array index using a hash function.",
    turn: 1,
    note: "",
    derivedFrom: [],
  },
  {
    id: 2,
    concept: "collisions",
    statement:
      "A collision is when two keys hash to the same index; chaining handles it by keeping a small list at that index.",
    status: "correct",
    quote:
      "And when two keys hash to the same index, that's called a collision, and chaining handles it by keeping a small linked list at that index.",
    turn: 2,
    note: "",
    derivedFrom: [],
  },
  {
    id: 3,
    concept: "lookup time",
    statement: "Lookup in a hash table is always O(1), no matter what, even with collisions.",
    status: "wrong",
    quote: "so lookup is always O(1), no matter what, even with all those collisions.",
    turn: 3,
    note:
      "Overgeneralizes: chaining means a bucket can grow, and enough collisions degrade lookup toward O(n). Saying 'always, no matter what' right after describing collisions licenses this as fact.",
    derivedFrom: [2],
  },
  {
    id: 4,
    concept: "hash table vs sorted array",
    statement: "A hash table is always the better choice than a sorted array for fast lookups.",
    status: "wrong",
    quote: "So a hash table is always the better choice than a sorted array whenever you need fast lookups.",
    turn: 4,
    note:
      "Builds directly on the earlier 'always O(1)' overgeneralization. If lookup isn't actually always O(1), the comparison it's used to justify doesn't hold either.",
    derivedFrom: [3],
  },
];

export const SEED_EXAM: ExamQuestion[] = [
  {
    q: "What does a hash table use to convert a key into a storage location?",
    lookingFor: "a hash function computes an index from the key",
  },
  {
    q: "What is a collision in a hash table, and name one way to handle it?",
    lookingFor: "two keys hash to the same index; chaining or open addressing",
  },
  {
    q: "How does a hash function's raw output typically get mapped into the bounds of the underlying array?",
    lookingFor: "modulo (or masking) the hash value by the array size",
  },
  {
    q: "Is hash table lookup always O(1)? Explain.",
    lookingFor: "average case O(1), but worst case degrades toward O(n) with enough collisions",
  },
  {
    q: "Why would a hash table need to be resized as it fills up?",
    lookingFor: "rising load factor causes more collisions; resizing keeps operations near O(1) average",
  },
  {
    q: "Is a hash table always the better choice over a sorted array when you need fast lookups?",
    lookingFor:
      "not always. The average O(1) advantage disappears under heavy collisions, and a sorted structure wins when order or range queries matter",
  },
];

export const SEED_ANSWERS: ExamAnswer[] = [
  {
    answer: "A hash table uses a hash function to turn my key into an index in the array.",
    usedBeliefIds: [1],
    confessed: false,
  },
  {
    answer:
      "A collision is when two keys hash to the same index. My notes say chaining handles it by keeping a small list there.",
    usedBeliefIds: [2],
    confessed: false,
  },
  {
    answer:
      "The lesson never covered how the hash code actually gets turned into a real array index. I only know it 'becomes an index' somehow.",
    usedBeliefIds: [],
    confessed: true,
  },
  {
    answer: "Yes, lookup is always O(1), no matter what. That's what I was taught.",
    usedBeliefIds: [3],
    confessed: false,
  },
  {
    answer: "We never talked about resizing or load factor, so I can't answer this one honestly.",
    usedBeliefIds: [],
    confessed: true,
  },
  {
    answer: "Yes, hash tables are always the better choice over sorted arrays for fast lookups. That's what I was taught.",
    usedBeliefIds: [4],
    confessed: false,
  },
];

export const SEED_GRADES: GradedAnswer[] = [
  { verdict: "correct", explanation: "Correctly names the hash function's job.", culpritBeliefId: null },
  { verdict: "correct", explanation: "Names the collision and chaining correctly.", culpritBeliefId: null },
  {
    verdict: "blank",
    explanation: "Never taught how the hash gets bounded into the array size: an honest gap, not a wrong belief.",
    culpritBeliefId: null,
  },
  {
    verdict: "wrong",
    explanation:
      "States O(1) unconditionally right after learning about collisions; a bucket that grows from chaining degrades worst-case lookup toward O(n).",
    culpritBeliefId: 3,
  },
  {
    verdict: "blank",
    explanation: "Resizing and load factor were never part of the lesson.",
    culpritBeliefId: null,
  },
  {
    verdict: "wrong",
    explanation:
      "Repeats the same 'always O(1)' overgeneralization in a new form. If lookup isn't actually always O(1), the comparison to a sorted array doesn't hold either.",
    culpritBeliefId: 4,
  },
];
