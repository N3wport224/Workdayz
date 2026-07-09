import { PNG } from "pngjs";
import { mkdirSync, writeFileSync } from "fs";

// Simple procedural icon: rounded indigo square, white circle, white
// checkmark — no external assets or font rendering needed.

const BG = [37, 99, 235]; // #2563eb
const FG = [255, 255, 255];

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

function generateIcon(size) {
  const png = new PNG({ width: size, height: size });
  const cornerRadius = size * 0.22;
  const center = size / 2;
  const circleRadius = size * 0.34;
  const strokeWidth = Math.max(1.6, size * 0.07);

  // Checkmark points, in icon-space fractions of size.
  const p1 = [size * 0.33, size * 0.52];
  const p2 = [size * 0.46, size * 0.65];
  const p3 = [size * 0.68, size * 0.38];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;

      // Rounded-square mask for the background.
      const insideRoundedSquare = isInsideRoundedSquare(x + 0.5, y + 0.5, size, cornerRadius);
      if (!insideRoundedSquare) {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
        continue;
      }

      let color = BG;
      const distFromCenter = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      const onCircleRing = Math.abs(distFromCenter - circleRadius) < strokeWidth / 2;

      const distToCheck = Math.min(
        distToSegment(x + 0.5, y + 0.5, p1[0], p1[1], p2[0], p2[1]),
        distToSegment(x + 0.5, y + 0.5, p2[0], p2[1], p3[0], p3[1]),
      );
      const onCheck = distToCheck < strokeWidth / 2;

      if (onCircleRing || onCheck) color = FG;

      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = 255;
    }
  }

  return png;
}

function isInsideRoundedSquare(x, y, size, r) {
  const half = size / 2;
  const dx = Math.max(0, Math.abs(x - half) - (half - r));
  const dy = Math.max(0, Math.abs(y - half) - (half - r));
  return dx * dx + dy * dy <= r * r;
}

mkdirSync("icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = generateIcon(size);
  const buffer = PNG.sync.write(png);
  writeFileSync(`icons/icon${size}.png`, buffer);
  console.log(`wrote icons/icon${size}.png`);
}
