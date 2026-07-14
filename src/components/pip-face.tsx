"use client";

// Pip, drawn by Open Peeps (Pablo Stanley, CC0) via react-peeps. Two views of
// the same character: PipFace is the head-only avatar that lives in chat
// bubbles and the report card; PipSitting is the full figure, sitting
// cross-legged, exactly as the library draws it — no hand-assembled furniture.
// Every mood the model returns maps to an Open Peeps face, and both views
// blink by swapping to EyesClosed for a beat.

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

const HAIR = "MediumShort";

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
          strokeColor="currentColor"
          viewBox={{ x: "330", y: "80", width: "400", height: "400" }}
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

// Pip sitting cross-legged. `writing` wiggles the pencil (Twemoji ✏️,
// CC-BY 4.0) resting by the lap — wired to the extraction call, so Pip
// visibly takes notes exactly when the ledger is being written. The star and
// thinking dots are keyed on mood so their entrance animation replays on
// every change. viewBox is the measured bounding box of the CrossedLegs pose.
export function PipSitting({
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
      <div className="pip-bob">
        <Peep
          body="CrossedLegs"
          face={blink ? "EyesClosed" : FACE[mood]}
          hair={HAIR}
          strokeColor="currentColor"
          viewBox={{ x: "-90", y: "-40", width: "1520", height: "1560" }}
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      {/* the tilt lives on the wrapper so the writing wiggle doesn't snap it upright */}
      <span
        className="absolute bottom-0 left-[2%] block w-[19%]"
        style={{ aspectRatio: "1", transform: "rotate(-12deg)" }}
      >
        <span
          className={`block h-full w-full ${writing ? "pip-scribble" : ""}`}
          style={{
            backgroundImage: "url(/pencil.svg)",
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
          }}
        />
      </span>

      {mood === "lightbulb" && (
        <span
          key="spark"
          className="pip-pop absolute right-[8%] top-0 text-2xl leading-none text-[oklch(0.72_0.13_85)]"
        >
          ★
        </span>
      )}
      {mood === "thinking" && (
        <span key="dots" className="absolute right-[10%] -top-1 flex flex-col items-end gap-1 opacity-70">
          <span className="pip-think h-[7px] w-[7px] rounded-full bg-current" style={{ animationDelay: "0.5s" }} />
          <span className="pip-think h-[6px] w-[6px] rounded-full bg-current" style={{ animationDelay: "0.25s" }} />
          <span className="pip-think h-[5px] w-[5px] rounded-full bg-current" />
        </span>
      )}
    </div>
  );
}
