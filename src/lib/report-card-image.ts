// Renders the report card to a canvas and triggers a PNG download. Plain
// Canvas 2D, no dependency. This only needs to look like the on-screen card,
// not be pixel-identical to it.

const PAPER = "#f9f7f0";
const INK = "#3a352b";
const MUTED = "#8a8272";
const GOLD = "#c9a13f";
const RED = "#a8402f";

export type StarFill = "full" | "half" | "empty";

export interface ReportCardImageInput {
  topic: string;
  grade: string;
  score: number;
  total: number;
  stars: StarFill[];
  worstQuote?: { turn: number; quote: string };
  face?: "proud" | "okay" | "worried";
  seal?: string; // paper fingerprint shown at enrollment
}

export function downloadReportCard(input: ReportCardImageInput) {
  const w = 900;
  const h = 560;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, w - 40, h - 40);

  ctx.fillStyle = MUTED;
  ctx.font = "600 18px Georgia, serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("REPORT CARD", 118, 90);

  ctx.fillStyle = INK;
  ctx.font = "600 34px Georgia, serif";
  // The giant grade letter starts at w-240; a long topic must stop short of it.
  ctx.fillText(fitText(ctx, `Pip: ${input.topic}`, w - 240 - 118 - 24), 118, 135);

  drawPipFace(ctx, 82, 108, 26, input.face ?? "okay");

  ctx.font = "700 120px Georgia, serif";
  ctx.fillText(input.grade, w - 240, 170);

  ctx.font = "500 22px Georgia, serif";
  ctx.fillStyle = MUTED;
  ctx.fillText(`${input.score}/${input.total}`, w - 240, 205);

  ctx.font = "28px Georgia, serif";
  input.stars.forEach((fill, i) => {
    const x = 56 + i * 36;
    ctx.fillStyle = GOLD;
    if (fill === "full") {
      ctx.fillText("★", x, 180);
    } else {
      ctx.fillText("☆", x, 180);
      if (fill === "half") {
        // A partial mark: the left half of the star filled in gold.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 180 - 30, ctx.measureText("★").width / 2, 38);
        ctx.clip();
        ctx.fillText("★", x, 180);
        ctx.restore();
      }
    }
  });

  ctx.strokeStyle = "#ddd6c5";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(56, 210);
  ctx.lineTo(w - 56, 210);
  ctx.stroke();

  if (input.worstQuote) {
    ctx.fillStyle = RED;
    ctx.font = "600 16px Georgia, serif";
    ctx.fillText(`Traced to your lesson, turn ${input.worstQuote.turn}:`, 56, 260);
    ctx.font = "italic 20px Georgia, serif";
    wrapText(ctx, `"${input.worstQuote.quote}"`, 56, 295, w - 112, 28);
  }

  ctx.fillStyle = MUTED;
  ctx.font = "16px Georgia, serif";
  ctx.fillText("Made with Star Pupil: the report card grades you", 56, h - 40);
  if (input.seal) {
    ctx.font = "13px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`paper seal ${input.seal}`, w - 56, h - 40);
    ctx.textAlign = "left";
  }

  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `star-pupil-${input.topic.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  a.click();
}

// Pip's face, same child as the SVG avatar: round head, dot eyes, a mouth
// that carries the verdict.
function drawPipFace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  face: "proud" | "okay" | "worried"
) {
  ctx.save();
  ctx.fillStyle = "#efe9da";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.2, r * 0.1, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.3, cy - r * 0.2, r * 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 2.2;
  ctx.beginPath();
  const my = cy + r * 0.35;
  const mw = r * 0.55;
  if (face === "proud") {
    ctx.moveTo(cx - mw, my - r * 0.08);
    ctx.quadraticCurveTo(cx, my + r * 0.3, cx + mw, my - r * 0.08);
  } else if (face === "okay") {
    ctx.moveTo(cx - mw, my);
    ctx.quadraticCurveTo(cx, my + r * 0.12, cx + mw, my);
  } else {
    ctx.moveTo(cx - mw, my + r * 0.1);
    ctx.quadraticCurveTo(cx, my - r * 0.15, cx + mw, my + r * 0.1);
  }
  ctx.stroke();

  if (face === "proud") {
    ctx.fillStyle = GOLD;
    ctx.font = `600 ${Math.round(r * 0.7)}px Georgia, serif`;
    ctx.fillText("★", cx + r * 0.75, cy - r * 0.75);
  }
  ctx.restore();
}

// Truncates with an ellipsis to fit maxWidth under the current ctx.font.
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t.trimEnd() + "…";
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(" ");
  let line = "";
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}
