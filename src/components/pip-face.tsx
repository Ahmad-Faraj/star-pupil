// Pip's face. The mood field was already coming back from every /api/reply
// call and going straight to /dev/null in the UI — this renders it instead of
// a text label.

export type Mood = "curious" | "confused" | "lightbulb" | "worried" | "thinking";

const MOUTH: Record<Mood, string> = {
  curious: "M 9 15 Q 12 18 15 15",
  confused: "M 9 16 Q 12 13 15 16",
  lightbulb: "M 9 14 Q 12 19 15 14",
  worried: "M 9 16.5 L 15 16.5",
  thinking: "M 9 15.5 L 15 15.5",
};

export function PipFace({ mood = "curious", className }: { mood?: Mood; className?: string }) {
  const spark = mood === "lightbulb";
  const brow = mood === "confused" || mood === "worried";
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="11" fill="var(--color-secondary)" stroke="currentColor" strokeWidth="1" />
      <circle cx="9" cy="10" r="1.3" fill="currentColor" />
      <circle cx="15" cy="10" r="1.3" fill="currentColor" />
      {brow && (
        <>
          <line x1="7.3" y1="7.6" x2="10" y2="8.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <line x1="16.7" y1="7.6" x2="14" y2="8.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </>
      )}
      <path d={MOUTH[mood]} stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {spark && (
        <text x="18" y="6" fontSize="7" fill="oklch(0.72 0.13 85)">
          ★
        </text>
      )}
    </svg>
  );
}
