# Star Pupil — demo video script & shot list

**Target:** 2:40–2:50 · voice-only VO over screencast · your voice, never AI TTS
**Topic:** photosynthesis (live teaching session, real API)
**Look:** light mode, 1440p browser, no bookmarks bar / extensions, one aesthetic held throughout.

---

## The locked teaching lines (paste these — don't improvise)

Type these verbatim so takes are clean and the fumble reliably lands. Keep them in a
scratch file and paste, don't type live. The extraction model is live, so **retake until
the report traces the red belief cleanly** — these lines are *designed* to induce it, but
the exact ledger varies per run.

1. **(gold)** `Photosynthesis is how a plant makes its own food: it takes in sunlight, water, and carbon dioxide and turns them into sugar and oxygen.`
2. **(gold)** `The sunlight gets captured by a green pigment called chlorophyll, which is also what makes leaves green.`
3. **(the fumble — say it deadpan)** `Plants breathe in carbon dioxide at night.`
   - This licenses the overgeneralization "photosynthesis happens at night." Pip should
     ask something like *"So photosynthesis happens at night, when it takes the CO₂ in?"*
     and a **red** node appears.
4. *(Optional 4th good line if you want a cleaner B/C instead of a D):*
   `Chlorophyll sits inside tiny structures in the leaf cells called chloroplasts.`

**Deliberately never taught** (so the exam shows honest *blanks*, i.e. coverage gaps):
the chemical equation / balancing, light-dependent vs light-independent reactions, the
role of the roots/stomata. Leave them out — the blanks are a feature.

On the dry run, check the map before you start teaching: at least two concepts should
still be dark at the end **and carry a mark** (the node reads `never taught · 1 mark`
on the report card). That is what makes the coverage story visible rather than stated.

Teach 3–4 lines total, then **Send Pip to the exam.**

---

## Shot list (word-for-word VO)

VO is written to ~2.5 words/sec with breathing room. Cut every "Pip is thinking…" wait
in the edit — jump-cut or 4× speed-ramp. Motion = what the auto-zoom does.

| # | Time | On screen | VO (say exactly) | Caption / motion |
|---|------|-----------|------------------|------------------|
| 1 | 0:00–0:10 | Enroll screen. Pip at his desk on the left, the replay map lighting up on the right | "Every AI product wants to teach *you* something. I built one that needs *you* to teach *it*. This is Pip, and right now he knows nothing." | slow push-in on Pip, then a beat on the map behind him |
| 2 | 0:10–0:32 | Type `photosynthesis`, **Start the lesson**. Skeleton map, then the first concepts arrive, dark. Seal hash lands in the paper card | "Before I say a word, the examiner maps the subject and seals an exam against it. I don't get to see that map. I only see what I could teach next, because being handed the whole syllabus would just turn this into a checklist. That hash is the receipt: I can't teach to a test I've never seen." | hold on the map as it draws itself, then zoom the `seal ····` hash |
| 3 | 0:32–0:56 | Paste line 1, then line 2. Concepts turn **gold** and new ones surface behind them; "in the notebook" dots appear; Pip asks a clarifying question | "Now I teach, and I watch it land. Say it clearly and the concept lights gold, and the next part of the subject opens up behind it. And when I'm vague, he pushes back, exactly like a real student." | zoom the map as concepts light and new ones appear; hold on Pip's clarifying reply |
| 4 | 0:56–1:20 | Paste line 3 (the fumble). Pip's boundary-testing reply. A concept goes **red**; click it, the file opens with the quote and **Say instead** | "Here's the whole idea. I'm going to say one sloppy thing, on purpose. Watch. There it is, a misconception forming in real time, quoting my own words back as the source. I did that. He just believed me. And underneath, the sentence I should have said." | **hold + zoom hard on the red concept**, then the "your words, turn N" quote, then Say instead |
| 5 | 1:20–1:36 | Click **I never said that**, type "I never said it happens at night", Pip reads the sentence back and the note stands | "So I argue with him. And he loses nothing, because the only evidence he's allowed is my own sentence. He'll back down when he genuinely misread me. He will not back down because I insisted." | hold on his reply in the chat, then the toast "The note stands" |
| 6 | 1:36–1:50 | **Send Pip to the exam**. Stages run, the seal breaks, his handwriting fills the paper live | "Lesson over. He sits it alone, on the paper that was sealed before I opened my mouth, and he can only answer from what I actually taught him." | zoom the seal-match line, then the answers landing one by one |
| 7 | 1:50–2:14 | Report card: grade + stars, then the **wrong** answer and its red trace: *"Traced to your lesson, turn N"* | "And here's what no other demo has. He got this one wrong, and it traces straight back to the exact sentence I fumbled. This report card was never grading Pip. It's grading me." | stars first, then **slow zoom onto the traced quote** — hero shot, let it breathe |
| 8 | 2:14–2:32 | Click **show his working**: the map numbers the concepts he reasoned through, ending on the question's concept. Then the dark concepts and the two stats | "I can even see his working. That's the route he took through my lesson to get it wrong: one thing I said, and everything I built on top of it. Everything still dark is a mark he could never have earned, and the two scores split it: how much of the subject I covered, and how much of that I got right." | follow the numbered route 1 → 2 → 3, then pull out to the dark concepts, then the stats |
| 9 | 2:32–2:46 | Pull back to full app / end card | "Under the hood every message writes a structured belief ledger, and he can only answer from it, so he genuinely can't know anything you didn't teach. Star Pupil. If you can't teach it, you never learned it." | lower-third caption: **"Gemini 3 Flash · Groq fallback · live belief ledger"**; end card: app URL + repo |

---

## End card (last 3s, static)

```
Star Pupil
If you can't teach it, you never learned it.
[live URL]   ·   [github repo]
```

---

## Recording protocol

1. `npm run dev`, full-screen browser, light mode, hide chrome. Do the whole run once as a
   dry run and confirm line 3 produces a **red** belief and the report **traces** it.
2. Record screen **silently**, multiple full takes; keep the take with the cleanest red trace.
3. Record VO **separately** (Audacity / phone in a quiet room, mic close). Never narrate while clicking.
4. Cut the LLM wait times. Add captions (burn-in). One quiet music bed at −20 dB under VO.
5. Export 1080p/60. Upload to **YouTube · Public · "Not for Kids"**, 2+ days before the deadline.
6. **Fallback for live judging (not the video):** the "Skip the typing, watch a finished
   report card" seed (hash tables) needs no API — keep it as your on-stage safety net.

## Accuracy guardrails (do not misstate to judges)

- Model stack is **Gemini 3 Flash (primary) with a Groq fallback ladder** — not Claude.
- The map **and** the paper are sealed at **enrollment**, before teaching. One hash covers the
  concepts, the questions and the mark scheme, so none of the three can be fitted to the lesson.
- The teacher **never sees the full map** during the lesson, only the concepts that are teachable
  next. The whole thing, including what was never reached, is revealed on the report card.
- Pip **never sees the map**. It goes to the teacher's screen and to belief extraction, and
  nowhere near his chat or his exam: knowing the shape of the subject would be knowledge nobody
  taught him.
- Pip answers **from the belief ledger only**; it's a structured extraction, not "prompt to act confused."
- "Show his working" is **his own citations**, expanded through the beliefs they were built on.
  Where he named nothing and the marker traced it instead, the caption says so.
- Arguing **cannot move a grade**. He concedes only when the quote doesn't support the note, and
  a concession is stamped on the report card.
