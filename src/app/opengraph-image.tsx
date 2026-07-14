import { ImageResponse } from "next/og";

export const alt = "Star Pupil: the report card grades you";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const paper = "#f8f6ef";
const ink = "#3b362c";
const gold = "#c9a03d";

function GoldStar({ size: s }: { size: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24">
      <path
        d="M12 2l2.9 6.26 6.6 1.04-5 4.87 1.18 6.88L12 17.77l-5.68 3.28 1.18-6.88-5-4.87 6.6-1.04L12 2z"
        fill={gold}
      />
    </svg>
  );
}

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: paper,
          color: ink,
          padding: "72px 84px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 14 }}>
            <GoldStar size={54} />
            <GoldStar size={54} />
            <GoldStar size={54} />
            <svg width={54} height={54} viewBox="0 0 24 24">
              <path
                d="M12 2l2.9 6.26 6.6 1.04-5 4.87 1.18 6.88L12 17.77l-5.68 3.28 1.18-6.88-5-4.87 6.6-1.04L12 2z"
                fill="none"
                stroke="#d8d2c2"
                strokeWidth={1.5}
              />
            </svg>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 44,
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: -2,
            }}
          >
            <span>Teach an AI student.</span>
            <span>It sits the exam alone.</span>
            <span style={{ color: gold }}>The report card grades you.</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            borderTop: `3px solid ${ink}`,
            paddingTop: 28,
          }}
        >
          <span style={{ fontSize: 44, fontWeight: 700 }}>Star Pupil</span>
          <span style={{ fontSize: 26, color: "#847c6b" }}>
            if you can&apos;t teach it, you never learned it
          </span>
        </div>
      </div>
    ),
    size
  );
}
