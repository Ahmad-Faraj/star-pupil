"use client";

// Pip, drawn by Open Peeps (Pablo Stanley, CC0) via react-peeps: a nerdy kid
// with round glasses and messy hair. Two views of the same character: PipFace
// is the head-only avatar that lives in chat bubbles and the report card;
// PipDesk seats the PointingUp bust behind a simple desk — hand up like he
// knows the answer — with the notebook and pencil (Twemoji ✏️, CC-BY 4.0)
// kept on the far side of the desk so nothing crowds his face. Every mood the
// model returns maps to an Open Peeps face, and both views blink by swapping
// to EyesClosed for a beat.

import { useEffect, useState } from "react";
import Peep, { FaceType } from "react-peeps";

export type Mood = "curious" | "confused" | "lightbulb" | "worried" | "thinking";

const FACE: Record<Mood, FaceType> = {
  curious: "Cheeky",
  confused: "Concerned",
  lightbulb: "SmileBig",
  worried: "ConcernedFear",
  thinking: "Solemn",
};

const HAIR = "ShortMessy";
const GLASSES = "GlassRoundThick";

// Blink by face-swap: true for ~140ms every few seconds.
function useBlink(): boolean {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    let inner: ReturnType<typeof setTimeout>;
    const outer = setInterval(() => {
      setClosed(true);
      inner = setTimeout(() => setClosed(false), 140);
    }, 4600);
    return () => {
      clearInterval(outer);
      clearTimeout(inner);
    };
  }, []);
  return closed;
}

export function PipFace({ mood = "curious", className }: { mood?: Mood; className?: string }) {
  const blink = useBlink();
  return (
    <span className={`relative inline-block ${className ?? ""}`} aria-hidden>
      <span className="block h-full w-full overflow-hidden rounded-full border bg-card">
        <Peep
          body="Shirt"
          face={blink ? "EyesClosed" : FACE[mood]}
          hair={HAIR}
          accessory={GLASSES}
          strokeColor="currentColor"
          viewBox={{ x: "310", y: "40", width: "440", height: "440" }}
          style={{ width: "100%", height: "100%" }}
        />
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

// Pip at his desk, hand raised. `writing` wiggles the pencil on the notebook —
// wired to the extraction call, so Pip visibly takes notes exactly when the
// ledger is being written. The star and thinking dots are keyed on mood so
// their entrance animation replays on every change. The bust crop ends at the
// waist, which is exactly what the desk slab hides.
export function PipDesk({
  mood = "curious",
  writing = false,
  className,
}: {
  mood?: Mood;
  writing?: boolean;
  className?: string;
}) {
  const blink = useBlink();
  return (
    <div className={`relative ${className ?? ""}`} aria-hidden>
      <div className="pip-bob relative ml-auto mr-[2%] w-[72%]" style={{ marginBottom: "10%" }}>
        <Peep
          body="PointingUp"
          face={blink ? "EyesClosed" : FACE[mood]}
          hair={HAIR}
          accessory={GLASSES}
          strokeColor="currentColor"
          viewBox={{ x: "-60", y: "-90", width: "1100", height: "1010" }}
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      {/* the desk in front of Pip: slab, splayed legs, notebook, pencil —
          drawn after the figure so the slab overlaps his waist */}
      <svg viewBox="0 0 120 44" className="absolute inset-x-0 bottom-0">
        <rect x="5" y="28" width="110" height="3.4" rx="1.7" fill="var(--color-card)" stroke="currentColor" strokeWidth="1.2" />
        <line x1="17" y1="31.6" x2="13.5" y2="43" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="103" y1="31.6" x2="106.5" y2="43" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <g transform="rotate(3 33 22)">
          <rect x="14" y="15.5" width="39" height="13.5" rx="1" fill="var(--color-card)" stroke="currentColor" strokeWidth="1" />
          <line x1="18" y1="20.5" x2="49" y2="20.5" stroke="oklch(0.885 0.02 240)" strokeWidth="0.8" />
          <line x1="18" y1="24.5" x2="49" y2="24.5" stroke="oklch(0.885 0.02 240)" strokeWidth="0.8" />
        </g>
        <g className={writing ? "pip-scribble tb-fill" : undefined}>
          <image href="/pencil.svg" width="12" height="12" x="26" y="11" transform="rotate(-28 32 17)" />
        </g>
      </svg>

      {mood === "lightbulb" && (
        <span
          key="spark"
          className="pip-pop absolute right-[4%] top-0 text-2xl leading-none text-[oklch(0.72_0.13_85)]"
        >
          ★
        </span>
      )}
      {mood === "thinking" && (
        <span key="dots" className="absolute right-[6%] -top-1 flex flex-col items-end gap-1 opacity-70">
          <span className="pip-think h-[7px] w-[7px] rounded-full bg-current" style={{ animationDelay: "0.5s" }} />
          <span className="pip-think h-[6px] w-[6px] rounded-full bg-current" style={{ animationDelay: "0.25s" }} />
          <span className="pip-think h-[5px] w-[5px] rounded-full bg-current" />
        </span>
      )}
    </div>
  );
}
