// Renders the report card to a canvas and triggers a PNG download. Plain
// Canvas 2D, no dependency — this only needs to look like the on-screen card,
// not be pixel-identical to it.

const PAPER = "#f9f7f0";
const INK = "#3a352b";
const MUTED = "#8a8272";
const GOLD = "#c9a13f";
const RED = "#a8402f";

export interface ReportCardImageInput {
  topic: string;
  grade: string;
  score: number;
  total: number;
  starsFilled: boolean[];
  worstQuote?: { turn: number; quote: string };
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
  ctx.fillText("REPORT CARD", 56, 90);

  ctx.fillStyle = INK;
  ctx.font = "600 34px Georgia, serif";
  ctx.fillText(`Pip — ${input.topic}`, 56, 135);

  ctx.font = "700 120px Georgia, serif";
  ctx.fillText(input.grade, w - 240, 170);

  ctx.font = "500 22px Georgia, serif";
  ctx.fillStyle = MUTED;
  ctx.fillText(`${input.score}/${input.total}`, w - 240, 205);

  ctx.font = "28px Georgia, serif";
  ctx.fillStyle = GOLD;
  const starsText = input.starsFilled.map((f) => (f ? "★" : "☆")).join(" ");
  ctx.fillText(starsText, 56, 180);

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
  ctx.fillText("Made with Star Pupil — the report card grades you", 56, h - 40);

  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `star-pupil-${input.topic.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  a.click();
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
