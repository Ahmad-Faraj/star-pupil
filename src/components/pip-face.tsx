"use client";

// Pip, drawn by Open Peeps (Pablo Stanley, CC0). Rather than let react-peeps
// stamp out a whole <svg> per figure, we reach for its individual pieces and
// compose the scene ourselves. That buys the two things a stamped Peep cannot
// do: Pip's head is its own <g> (Open Peeps hides the skull inside the *hair*
// piece, so hair+face+glasses rotate together above a torso that stays put),
// and the desk is drawn in the same coordinate space as the body, so the slab
// genuinely overlaps his waist instead of being a separate image parked on top.
//
// Expressions change the way animators change them: behind a blink. Cutting
// one Open Peeps face to another mid-shot pops, and cross-fading two sets of
// eyes ghosts. Closing the eyes for ~120ms and opening them on the new face
// hides the cut completely and reads as Pip reacting.
//
// The pencil is Twemoji ✏️ (CC-BY 4.0).

import { Children, useEffect, useRef, useState, type ReactElement } from "react";
import { Face, type FaceType } from "react-peeps";
import Pose from "react-peeps/lib/peeps/pose";
import FacePiece from "react-peeps/lib/peeps/face";
import HairPiece from "react-peeps/lib/peeps/hair";
import AccessoryPiece from "react-peeps/lib/peeps/accessories";

// What Pip can be feeling. The first six come back from the model with his
// reply; the last four are states the UI knows about and he doesn't (he can't
// tell you he's been at this for twenty minutes, but we can).
export type Mood =
  | "curious"
  | "confused"
  | "lightbulb"
  | "worried"
  | "happy"
  | "shy"
  | "thinking"
  | "writing"
  | "listening"
  | "tired";

// Chosen off a contact sheet of all 33 faces, not off their names: Awe is the
// only one whose eyes actually blow open the way a penny dropping looks, and
// Cheeky's raised brow reads "I have a question" where Smile just reads polite.
const FACE: Record<Mood, FaceType> = {
  curious: "Cheeky",
  confused: "Concerned",
  lightbulb: "Awe",
  worried: "Solemn",
  happy: "CheersNM",
  shy: "Cute",
  thinking: "CalmNM",
  writing: "Driven",
  listening: "SmileNM",
  tired: "Tired",
};

// GlassRoundThick's rims land exactly on the eyeline and swallow the brows.
// Tired and Concerned both collapse into the same squint behind them. The thin
// round frames keep the nerd read and let the face through.
const HAIR = "ShortMessy";
const GLASSES = "GlassRound";
const BUST = "ButtonShirt"; // a collared school shirt, the polite one
const INK = "currentColor";
const SKIN = "var(--color-card)";

// How far Pip's head leans, in degrees, and how much he sinks, in Peep units.
// Thinking tips him away from you; a penny dropping snaps him upright and up;
// tired lets his head fall forward over the desk.
const POSTURE: Partial<Record<Mood, { tilt: number; drop: number }>> = {
  thinking: { tilt: -4, drop: 6 },
  lightbulb: { tilt: 1, drop: -14 },
  confused: { tilt: 5, drop: 4 },
  worried: { tilt: 3, drop: 6 },
  shy: { tilt: -3, drop: 4 },
  tired: { tilt: 8, drop: 30 },
  writing: { tilt: 3, drop: 10 },
};

// Blinking and leaning are driven from JS, so the reduced-motion media query in
// globals.css cannot reach them: it only silences the keyframes. Pip has to be
// told to hold still himself.
function useStillness(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return still;
}

// ---------------------------------------------------------------------------
// Blinking, the hard way, because the easy way is a lie.
//
// Every Open Peeps face is ONE filled path, so the obvious blink (swap in the
// "EyesClosed" face for 120ms) does not close Pip's eyes: it replaces his whole
// face, mouth and all, several times a minute. Sitting still you would watch his
// smile flicker to a different smile forever. That is a bug, not a blink.
//
// But that one path is built of subpaths, one per feature, laid out in a fixed
// order: brows, eyes, nose, mouth. So we can operate. Drop the face's own eye
// subpaths, graft on EyesClosed's two lids, and keep everything else. His brows
// stay put, which matters more than the eyes do: the brows are where Open Peeps
// keeps the emotion (tired's droop, concerned's arch). Only the eyes close.
//
// Three things about that path have to survive the operation. Skip any one of
// them and the blink redraws Pip as a different, misaligned boy several times a
// minute, which is worse than not blinking at all:
//
//   - its TRANSFORM. Each face is drawn around its own origin and then moved
//     into place by a translate on the path itself, and no two faces share one
//     (Concerned 61,70; SmileNM 59,52). Read the "d" alone and the rebuilt face
//     lands ~60 units up and to the left: the mouth climbs into the glasses.
//   - its FILL RULE, which is evenodd. That is what hollows out the open mouth
//     and the whites of the eyes. Drop it and they fill in solid black.
//   - the LIDS' own transform, which matches no face's.
//
// With all three honoured the lids already land nearly on each face's eyes, and
// dx/dy below is the last few units of nudge. They were measured by rasterising
// each face's eye subpaths and the lids and comparing the ink, not by eye.
type EyeSurgery = { eyes: number[]; dx: number; dy: number };

const BLINK: Partial<Record<FaceType, EyeSurgery>> = {
  SmileNM: { eyes: [2, 3], dx: 12, dy: 3 },
  Cheeky: { eyes: [2, 3], dx: -3, dy: 11 },
  Concerned: { eyes: [2, 3], dx: 5, dy: 8 },
  Tired: { eyes: [2, 3], dx: -2, dy: 5 },
  Driven: { eyes: [2, 3], dx: 5, dy: 0 },
  CalmNM: { eyes: [2, 3], dx: -2, dy: 8 },
  Awe: { eyes: [2, 3, 4, 5, 6, 7], dx: -6, dy: 9 },
  // Cute and CheersNM are absent on purpose: Pip's eyes are already shut in
  // both, and you cannot blink eyes that are closed. Solemn is absent because
  // its right brow and right eye are drawn as ONE subpath, so removing the eye
  // would take the brow with it and leave his face lopsided.
};

// A face as react-peeps actually draws it: one path, carrying its own placement.
type Drawn = { d: string; transform: string };

function drawn(face: FaceType): Drawn {
  const piece = Face[face] as (p: { strokeColor: string }) => ReactElement<{
    children?: ReactElement<{ d?: string; transform?: string }>[];
  }>;
  const paths = Children.toArray(piece({ strokeColor: INK }).props.children) as ReactElement<{
    d?: string;
    transform?: string;
  }>[];
  return {
    d: paths.map((p) => p.props.d ?? "").join(" "),
    transform: paths[0]?.props.transform ?? "",
  };
}

// The subpaths are all absolute (every one starts with M), which is what makes
// splitting on the move command safe.
const subpaths = (d: string) => d.split(/(?=M)/).filter((s) => s.trim().length > 3);

const EYES_CLOSED = drawn("EyesClosed");
const LIDS = subpaths(EYES_CLOSED.d)
  .filter((_, i) => i === 1 || i === 2)
  .join(" ");

// The face with its eyes shut but everything else left alone.
function BlinkedFace({ face }: { face: FaceType }) {
  const cut = BLINK[face];
  if (!cut) return <FacePiece piece={face} strokeColor={INK} backgroundColor={SKIN} />;
  const src = drawn(face);
  const kept = subpaths(src.d)
    .filter((_, i) => !cut.eyes.includes(i))
    .join(" ");
  return (
    <g fill={INK} fillRule="evenodd">
      <path d={kept} transform={src.transform} />
      {/* nudge, then the lids' own placement: translate(dx dy) then the lids */}
      <path d={LIDS} transform={`translate(${cut.dx} ${cut.dy}) ${EYES_CLOSED.transform}`} />
    </g>
  );
}

// Real eyes do not blink on a metronome. Wait 2.6 to 7s, and one time in five
// blink twice. That alone is most of the difference between a face that is
// idling and a face that is switched off.
function useIdleBlink(suspended: boolean) {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (suspended) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const shut = (ms: number) => {
      setClosed(true);
      timers.push(setTimeout(() => setClosed(false), ms));
    };
    const schedule = () => {
      timers.push(
        setTimeout(
          () => {
            shut(120);
            if (Math.random() < 0.2) timers.push(setTimeout(() => shut(110), 300));
            schedule();
          },
          2600 + Math.random() * 4400
        )
      );
    };
    schedule();
    // Reopen the eyes on the way out. Suspending mid-blink would otherwise
    // clear the timer that was going to lift the lid, and leave him asleep.
    return () => {
      timers.forEach(clearTimeout);
      setClosed(false);
    };
  }, [suspended]);
  return closed;
}

// Two blinks, for two different jobs.
//
// An IDLE blink is the eyes-only surgery above: the mouth must survive, or Pip
// looks like he is changing his mind every four seconds.
//
// A blink that MASKS AN EXPRESSION CHANGE is the whole EyesClosed face. That is
// the point of it: the closed frame is identical no matter which face is coming
// or going, so the cut happens where nobody can see it, and the mouth is meant
// to be changing then anyway.
function useExpression(mood: Mood): {
  face: FaceType;
  posture: { tilt: number; drop: number };
  blinking: boolean;
} {
  const still = useStillness();
  const [shown, setShown] = useState<Mood>(mood);
  const [swapping, setSwapping] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current || still) {
      first.current = false;
      setShown(mood);
      return;
    }
    setSwapping(true);
    const swap = setTimeout(() => setShown(mood), 120);
    const open = setTimeout(() => setSwapping(false), 200);
    return () => {
      clearTimeout(swap);
      clearTimeout(open);
    };
  }, [mood, still]);

  const idle = useIdleBlink(swapping || still);
  const posture = POSTURE[shown] ?? { tilt: 0, drop: 0 };
  return {
    face: swapping ? "EyesClosed" : FACE[shown],
    posture,
    blinking: idle && !swapping,
  };
}

// Pip's head, lifted straight out of react-peeps' own layout: hair at 225,0
// (the skull is in there), face at +159,+186, glasses at +47,+241. Rotating
// this group pivots on his neck, so the body below it never moves.
function Head({
  face,
  tilt,
  drop,
  blinking = false,
}: {
  face: FaceType;
  tilt: number;
  drop: number;
  blinking?: boolean;
}) {
  return (
    <g className="pip-head" transform={`translate(0 ${drop}) rotate(${tilt} 420 470)`}>
      <g transform="translate(225 0)">
        <HairPiece piece={HAIR} strokeColor={INK} backgroundColor={SKIN} />
        <g transform="translate(159 186)">
          {blinking ? (
            <BlinkedFace face={face} />
          ) : (
            <FacePiece piece={face} strokeColor={INK} backgroundColor={SKIN} />
          )}
        </g>
        <g transform="translate(47 241)">
          <AccessoryPiece piece={GLASSES} strokeColor={INK} backgroundColor={SKIN} />
        </g>
      </g>
    </g>
  );
}

// The head-only avatar, for chat bubbles and the report card. Same rig, cropped
// to the head, so the Pip in the bubble is the same Pip who is sitting at the
// desk, and he blinks and reacts there too.
// `frozen` holds a face still: no blinking, no swap. The chat bubbles use it.
// A bubble avatar is a record of the face Pip made when he said that line, not
// a live character, and a dozen of them each running their own randomised blink
// means the page never settles.
export function PipFace({
  mood = "listening",
  frozen = false,
  className,
}: {
  mood?: Mood;
  frozen?: boolean;
  className?: string;
}) {
  const live = useExpression(mood);
  const face = frozen ? FACE[mood] : live.face;
  const blinking = frozen ? false : live.blinking;
  return (
    <span className={`relative inline-block ${className ?? ""}`} aria-hidden>
      <span className="block h-full w-full overflow-hidden rounded-full border bg-card">
        {/* the collar is in shot on purpose: it is the same button shirt he is
            wearing at the desk, so the bubble and the scene are one character */}
        <svg viewBox="315 45 435 435" className="h-full w-full">
          <Pose piece={BUST} strokeColor={INK} backgroundColor={SKIN} />
          <Head face={face} tilt={0} drop={0} blinking={blinking} />
        </svg>
      </span>
      {mood === "lightbulb" && (
        <span
          key={mood}
          className="pip-pop absolute -right-1 -top-1 text-[oklch(0.72_0.13_85)]"
          style={{ fontSize: "0.55em", lineHeight: 1 }}
        >
          ★
        </span>
      )}
    </span>
  );
}

// Pip's desk. Everything below is drawn in Open Peeps' own units so the ink
// weight matches his: his outlines are filled shapes about 14 units across, so
// the desk is stroked at 13 to 15 and never looks like it came from a different pen.
export function PipDesk({
  mood = "listening",
  writing = false,
  className,
}: {
  mood?: Mood;
  writing?: boolean;
  className?: string;
}) {
  const active: Mood = writing ? "writing" : mood;
  const { face, posture, blinking } = useExpression(active);
  const lit = active === "lightbulb";

  return (
    <div className={className} aria-hidden>
      {/* clipped, not overflow-visible: the desk surface deliberately runs past
          the frame, and without the clip it paints over whatever sits below */}
      <svg viewBox="-280 55 1400 1010" className="h-auto w-full">
        <defs>
          {/* The throw runs down the cone's own axis (userSpaceOnUse, from the
              bulb to where the beam meets the page) rather than down the
              bounding box, which is what left the light puddled at the shade
              and the page in the dark. It fades out at the desk, so the beam
              has a direction and an end. */}
          <linearGradient id="pip-throw" gradientUnits="userSpaceOnUse" x1="74" y1="640" x2="430" y2="1000">
            <stop offset="0%" stopColor="oklch(0.85 0.13 85)" stopOpacity="0.42" />
            <stop offset="70%" stopColor="oklch(0.85 0.13 85)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="oklch(0.85 0.13 85)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="pip-bulb">
            <stop offset="0%" stopColor="oklch(0.9 0.14 88)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="oklch(0.9 0.14 88)" stopOpacity="0" />
          </radialGradient>
          {/* the pool the beam actually leaves on the open page */}
          <radialGradient id="pip-pool">
            <stop offset="0%" stopColor="oklch(0.88 0.13 86)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="oklch(0.88 0.13 86)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g fill="none" stroke={INK} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round">
          {/* ---- the light goes down first, so Pip and the desk sit inside it.
                  The cone leaves the shade's mouth on the mouth's own normal and
                  lands on the notebook. Light that points at nothing is why the
                  lamp read as a flag on a stick. */}
          <g className={lit ? "pip-lamp-flare" : "pip-lamp"} stroke="none">
            <path d="M179 577 L-32 754 L40 946 L720 946 Z" fill="url(#pip-throw)" />
            <circle cx="74" cy="666" r="180" fill="url(#pip-bulb)" />
          </g>

          {/* ---- Pip: torso first, head last so it can lean out over the desk */}
          <g className="pip-breathe" stroke="none">
            <Pose piece={BUST} strokeColor={INK} backgroundColor={SKIN} />
            <Head face={face} tilt={posture.tilt} drop={posture.drop} blinking={blinking} />
          </g>

          {/* ---- the desk. Only the surface and its front edge are drawn, and
                  both run off the sides of the frame: a desk you can see the
                  whole of is a table in an empty room, and it steals the shot
                  from Pip. What makes it read as a desk is what is on it. */}
          <rect x="-300" y="946" width="1440" height="200" fill="var(--color-card)" stroke="none" />
          <path d="M-300 950 L1140 946" strokeWidth="15" />
          <path d="M-300 1006 L1140 1002" strokeWidth="8" stroke="oklch(0.86 0.015 85)" />

          {/* ---- the study lamp: weighted base, a real elbow, and a cone with an
                  open mouth and a bulb in it, aimed down the page */}
          <ellipse cx="-150" cy="932" rx="112" ry="26" fill="var(--color-card)" strokeWidth="14" />
          <path d="M-150 918 L-134 720" />
          <circle cx="-134" cy="720" r="19" fill={INK} stroke="none" />
          <path d="M-134 720 L-10 566" strokeWidth="13" />
          <g transform="rotate(50 -10 566)">
            {/* A cone needs its opening drawn, or it is a wedge. The flat
                trapezoid read as a paper plane. Order is the whole trick: the
                mouth ellipse goes down first and the cone body is painted over
                it, hiding its back half. Draw the ellipse on top instead and
                you get an eyeball. The body is an open path so its fill closes
                the shape while its stroke leaves the mouth unlined. */}
            <ellipse cx="100" cy="566" rx="20" ry="100" fill="var(--color-card)" strokeWidth="13" />
            <path d="M100 466 L-8 530 L-8 602 L100 666" fill="var(--color-card)" strokeWidth="14" />
            <ellipse cx="106" cy="566" rx="12" ry="62" fill="oklch(0.88 0.14 88)" stroke="none" />
          </g>

          {/* ---- the open notebook, ruled, lying where the light falls */}
          <g transform="rotate(-2.5 320 880)">
            <path d="M40 950 L78 786 L560 786 L598 950 Z" fill="var(--color-card)" strokeWidth="13" />
            <path d="M318 786 L318 950" strokeWidth="9" />
            <g stroke="oklch(0.86 0.03 240)" strokeWidth="7">
              <path d="M102 832 L298 832" />
              <path d="M92 878 L298 878" />
              <path d="M82 924 L298 924" />
              <path d="M338 832 L534 832" />
              <path d="M338 878 L544 878" />
              <path d="M338 924 L554 924" />
            </g>
          </g>

          {/* the pool of light the beam leaves on the page. It has to be laid
              down *over* the notebook: the page is filled with card, which
              painted straight over the beam underneath it. */}
          <g className={lit ? "pip-lamp-flare" : "pip-lamp"} stroke="none">
            <ellipse cx="300" cy="880" rx="290" ry="140" fill="url(#pip-pool)" />
          </g>

          {/* The pencil, lying across the right-hand page. Twemoji draws it on a
              45° diagonal already, so it needs winding back the other way to
              actually lie down. Left upright it looked stabbed into the fold. */}
          <g className={writing ? "pip-scribble tb-fill" : undefined}>
            <image href="/pencil.svg" x="352" y="822" width="124" height="124" transform="rotate(-52 414 884)" />
          </g>

          {/* the mug that is keeping him going, still steaming */}
          <path d="M812 812 L838 946 L948 946 L974 812 Z" fill="var(--color-card)" strokeWidth="13" />
          <path d="M970 834 Q1034 858 960 904" strokeWidth="12" />
          <g className="pip-steam" stroke="oklch(0.7 0.02 85)" strokeWidth="9" strokeLinecap="round">
            <path d="M874 770 Q850 738 874 706 Q898 674 874 642" />
            <path d="M928 776 Q906 748 928 720" />
          </g>
        </g>

        {/* ---- what Pip is thinking, floating over the scene */}
        {active === "lightbulb" && (
          <g key="star" className="pip-pop tb-fill" fill="oklch(0.72 0.13 85)" stroke="none">
            <path d="M900 180 L935 268 L1028 275 L957 336 L979 427 L900 377 L821 427 L843 336 L772 275 L865 268 Z" />
          </g>
        )}
        {(active === "thinking" || active === "writing") && (
          <g key="dots" fill={INK} stroke="none" opacity="0.65">
            <circle cx="905" cy="300" r="30" className="pip-think" style={{ animationDelay: "0.5s" }} />
            <circle cx="835" cy="360" r="23" className="pip-think" style={{ animationDelay: "0.25s" }} />
            <circle cx="784" cy="410" r="16" className="pip-think" />
          </g>
        )}
      </svg>
    </div>
  );
}
