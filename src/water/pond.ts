// The pond scene's water lilies: pads in loose clumps and a few on their own, some flowering,
// floating over the koi. Each is held by its stem, so it only rocks and turns a little on the water
// rather than drifting off. Placed at random once a visit over the whole screen (so resizing the
// window never moves them) and drawn each frame on their own canvas over the fish, with a hard
// shadow on the bed far below. It rains on the pond, lightly and steadily: each drop is seen falling
// for a moment, then sends a ring out across the water (under the pads), shadowed on the bed too.
// CSS px, y down.
import { stage } from './stage';

type Lily = { x: number; y: number; r: number; turn: number; phase: number; path: Path2D; hsl: [number, number, number]; flower?: Flower };
type Drop = { x: number; y: number; at: number; size: number; ripple: boolean }; // at: when it hits the water, s
type Flower = { dx: number; dy: number; r: number; petals: Path2D; inner: Path2D; middle: Path2D; outer: [number, number, number]; heart: [number, number, number] };

const rand = (a: number, b: number) => a + (b - a) * Math.random();
const TAU = Math.PI * 2;
const FALL = 0.2; // s a drop is seen falling
const LIFE = 1.4; // s its ring lasts

// A pad, 1 unit across its radius: a near-round leaf with a narrow wedge cut to its middle.
function pad(): Path2D {
  const p = new Path2D();
  const notch = rand(0.25, 0.45);
  const [a, b] = [rand(0, TAU), rand(0, TAU)];
  p.moveTo(0, 0);
  for (let i = 0; i <= 48; i++) {
    const t = notch / 2 + (i / 48) * (TAU - notch);
    const k = 1 + 0.03 * Math.sin(3 * t + a) + 0.02 * Math.sin(5 * t + b);
    p.lineTo(k * Math.cos(t), k * Math.sin(t));
  }
  p.closePath();
  return p;
}

// A water lily, 1 unit across its radius: a ring of pointed petals, a smaller ring inside it,
// and a golden middle.
function flower(r: number): Flower {
  const petal = (p: Path2D, a: number, len: number, width: number) => {
    const [c, s] = [Math.cos(a), Math.sin(a)];
    p.moveTo(0, 0);
    p.quadraticCurveTo(0.5 * len * c - width * s, 0.5 * len * s + width * c, len * c, len * s);
    p.quadraticCurveTo(0.5 * len * c + width * s, 0.5 * len * s - width * c, 0, 0);
  };
  const [petals, inner, middle] = [new Path2D(), new Path2D(), new Path2D()];
  const n = Math.round(rand(8, 11));
  const turn = rand(0, TAU);
  for (let i = 0; i < n; i++) petal(petals, turn + (i / n) * TAU, 1, 0.32);
  const m = Math.round(rand(6, 8));
  for (let i = 0; i < m; i++) petal(inner, turn + ((i + 0.5) / m) * TAU, 0.68, 0.26);
  middle.arc(0, 0, 0.22, 0, TAU);
  // Pink, white or yellow, the inner petals a shade deeper.
  const [outer, heart] = (
    [
      [[335, 55, 82], [335, 60, 72]],
      [[45, 30, 95], [45, 45, 86]],
      [[48, 75, 74], [44, 80, 64]],
      [[320, 50, 74], [320, 58, 64]],
    ] as [number, number, number][][]
  )[Math.floor(Math.random() * 4)];
  return { dx: rand(-0.3, 0.3), dy: rand(-0.3, 0.3), r, petals, inner, middle, outer, heart };
}

export function lilies(canvas: HTMLCanvasElement, cell: number) {
  const ctx = canvas.getContext('2d')!;
  const W = Math.max(stage.sw, stage.w);
  const H = Math.max(stage.sh, stage.h);
  const all: Lily[] = [];
  const add = (x: number, y: number, r: number) => {
    if (!all.every((l) => Math.hypot(l.x - x, l.y - y) > 0.85 * (l.r + r))) return;
    // Mostly fresh greens, a few older ones yellowing.
    const hsl: [number, number, number] = Math.random() < 0.12 ? [rand(60, 75), rand(40, 50), rand(44, 50)] : [rand(95, 125), rand(32, 46), rand(34, 44)];
    all.push({ x, y, r, turn: rand(0, TAU), phase: rand(0, TAU), path: pad(), hsl, flower: r > 20 && Math.random() < 0.2 ? flower(r * rand(0.45, 0.6)) : undefined });
  };
  // About one clump (150-350 CSS px across) for every six cells of screen, and two pads on their own
  // for each.
  const clumps = Math.max(2, Math.round((W * H) / (6 * cell * cell)));
  for (let i = 0; i < clumps; i++) {
    const [cx, cy] = [rand(0, W), rand(0, H)];
    const R = cell * rand(0.35, 0.8);
    const want = all.length + Math.round((R * R) / 2200);
    for (let k = 0; k < 200 && all.length < want; k++) {
      const [a, d] = [rand(0, TAU), R * Math.sqrt(Math.random())];
      add(cx + d * Math.cos(a), cy + d * Math.sin(a), rand(16, 46));
    }
  }
  for (let i = 0; i < 2 * clumps; i++) add(rand(0, W), rand(0, H), rand(14, 34));

  let drops: Drop[] = [];
  let [then, due] = [0, 0]; // the last frame's time; drops owed
  let dpr = 1;
  let shown = false;
  const colour = ([h, s, l]: [number, number, number], day: number, keep = 0.35) => `hsl(${h} ${s * (0.6 + 0.4 * day)}% ${l * (keep + (1 - keep) * day)}%)`;
  return {
    resize() {
      dpr = stage.dpr(2);
      canvas.width = stage.w * dpr;
      canvas.height = stage.h * dpr;
      shown = true;
    },
    // t: seconds; weight: how much the pond is showing (0-1).
    draw(t: number, weight: number, day: number) {
      if (shown) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      shown = weight >= 0.003;
      canvas.style.visibility = shown ? '' : 'hidden'; // hidden, an idle canvas costs nothing
      if (!shown) return;
      // About one drop a second for every 50,000 CSS px² of window. One landing on a pad makes no ring.
      const [w, h] = [stage.w, stage.h];
      due += (Math.min(Math.max(t - then, 0), 0.1) * w * h) / 50000;
      then = t;
      for (; due >= 1; due--) {
        const [x, y] = [rand(0, w), rand(0, h)];
        drops.push({ x, y, at: t + FALL, size: rand(0.7, 1.2), ripple: all.every((l) => Math.hypot(l.x - x, l.y - y) > 0.9 * l.r) });
      }
      drops = drops.filter((d) => t < d.at + LIFE);
      // Where each is now: rocking a few px and turning a few degrees, each in its own time.
      const at = all.map((l) => {
        const a = l.turn + 0.06 * Math.sin(0.35 * t + l.phase);
        const [x, y] = [l.x + 2.5 * Math.sin(0.27 * t + l.phase), l.y + 2.5 * Math.cos(0.31 * t + 1.7 * l.phase)];
        return new DOMMatrix([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), x, y]);
      });
      ctx.globalAlpha = weight;
      // The shadows, all together (so where two overlap it's no darker), then the pads, then the flowers.
      const shadows = new Path2D();
      all.forEach((l, i) => shadows.addPath(l.path, new DOMMatrix().translate(34, 48).multiply(at[i]).scale(l.r)));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(4, 18, 14, 0.3)';
      ctx.fill(shadows);
      // The rain's rings, spreading and fading: their shadows on the bed (offset like the pads'), then
      // the rings themselves.
      ctx.lineWidth = 1.2;
      for (const [dx, dy, a, rgb] of [[34, 48, 0.35, '4, 18, 14'], [0, 0, 0.5 * (0.4 + 0.6 * day), '222, 240, 232']] as const) {
        for (const d of drops) {
          const age = t - d.at;
          if (age < 0 || !d.ripple) continue;
          ctx.beginPath();
          ctx.arc(d.x + dx, d.y + dy, d.size * (3 + 30 * age), 0, TAU);
          ctx.strokeStyle = `rgba(${rgb}, ${a * (1 - age / LIFE) ** 1.5})`;
          ctx.stroke();
        }
      }
      all.forEach((l, i) => {
        ctx.setTransform(new DOMMatrix().scale(dpr).multiply(at[i]).scale(l.r));
        ctx.fillStyle = colour(l.hsl, day);
        ctx.fill(l.path);
      });
      all.forEach((l, i) => {
        const f = l.flower;
        if (!f) return;
        ctx.setTransform(new DOMMatrix().scale(dpr).multiply(at[i]).translate(f.dx * l.r, f.dy * l.r).scale(f.r));
        ctx.fillStyle = colour(f.outer, day, 0.5);
        ctx.fill(f.petals);
        ctx.fillStyle = colour(f.heart, day, 0.5);
        ctx.fill(f.inner);
        ctx.fillStyle = colour([46, 90, 56], day, 0.5);
        ctx.fill(f.middle);
      });
      // The falling drops, over everything. Looking down on the rain, a drop closes in on where it
      // lands from the side away from the middle of the view, so it's seen as a short streak
      // pointing out from there.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(222, 240, 232, ${0.5 * (0.4 + 0.6 * day)})`;
      ctx.beginPath();
      for (const d of drops) {
        const high = (d.at - t) / FALL; // 1 when first seen, 0 on the water
        if (high <= 0) continue;
        const [ox, oy] = [0.08 * (d.x - w / 2), 0.08 * (d.y - h / 2)];
        ctx.moveTo(d.x + ox * high, d.y + oy * high);
        ctx.lineTo(d.x + ox * (high + 0.4), d.y + oy * (high + 0.4));
      }
      ctx.stroke();
    },
  };
}
