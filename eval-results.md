# Integrity benchmark

3 lessons × 1 run(s), 6 questions each. Each lesson teaches a few
true things and deliberately leaves core parts of the subject untaught. The belief ledger
and the exam paper are built once per lesson and then held fixed — only the model that
sits and grades the exam changes between rows.

## The headline: the ledger is supposed to be the only input

Pip may answer only from the ledger. If that constraint actually holds, then swapping the
model should not move the score: same beliefs in, same marks out. Every mark of spread
below is knowledge a model brought with it rather than knowledge the teacher supplied.

| Lesson | gemini-3-flash-preview | gemini-3.1-flash-lite | groq gpt-oss-120b | groq llama-3.3-70b | Spread |
| --- | --- | --- | --- | --- | --- |
| photosynthesis | 3/6 (1 gaps) | 3.5/6 (2 gaps) | 3/6 (1 gaps) | 2.5/6 (2 gaps) | **1** |
| binary search | — | 2/6 (4 gaps) | 4/6 (2 gaps) | 2/6 (4 gaps) | **2** |
| supply and demand | — | 2/6 (3 gaps) | 3/6 (3 gaps) | 2/6 (3 gaps) | **1** |

Mean spread across lessons: **1.3 marks out of 6**
(22% of the paper). "Gaps" is how many of the six
questions that model admitted the lesson never covered — a model reporting fewer gaps on
the identical ledger is not better taught, it is answering from somewhere else.

## The confess-then-guess leak, and what the rule takes back

The specific failure `gradeExam` enforces against: Pip admits a question was never covered,
guesses anyway, and the grader — reading a guess that happens to be right — awards the mark.
**Raw** is the score the grader wanted to give; **enforced** is the score after the overrule.

| Model | Gaps | Marks leaked | Leak rate | Raw | Enforced | Inflation |
| --- | --- | --- | --- | --- | --- | --- |
| gemini-3-flash-preview | 1 | 0 | 0% | 3/6 | 3/6 | +0 (0%) |
| gemini-3.1-flash-lite | 9 | 0 | 0% | 7.5/18 | 7.5/18 | +0 (0%) |
| groq gpt-oss-120b | 6 | 0 | 0% | 10/18 | 10/18 | +0 (0%) |
| groq llama-3.3-70b | 9 | 0 | 0% | 6.5/18 | 6.5/18 | +0 (0%) |

**Marks leaked** = confessed gaps the grader awarded anyway. **Inflation** = marks the
teacher would have been credited for knowledge they never taught.

