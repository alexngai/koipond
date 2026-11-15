// The reef scene's coral: shelf coral cascading down in tiers of overlapping plates, highest in the
// middle, with a few small ones on the sand between. Placed at random once a visit over the whole
// screen (so resizing the window never moves them) and drawn once onto a canvas that the floor
// shader (ocean.glsl's u_reef) lays over the sand: there the water tints it, bright in the
// shallows and bluer the deeper it lies. Flat, like the stream's boulders: a solid fill per plate,
// paler the higher it is, and a hard shadow down and to the right that falls on the tiers below.
// CSS px, y up from the window's bottom edge, as in the shader.

type Plate = { x: number; y: number; lift: number; path: Path2D; color: string }; // lift: px above the sand

const rand = (a: number, b: number) => a + (b - a) * Math.random();
const TAU = Math.PI * 2;

// A plate: a lumpy disc r px out, gently scalloped round its edge.
function plate(r: number): Path2D {
  const p = new Path2D();
  const [a, b, c] = [rand(0, TAU), rand(0, TAU), rand(0, TAU)];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * TAU;
    const k = r * (1 + 0.1 * (Math.sin(2 * t + a) + 0.6 * Math.sin(3 * t + b)) + 0.035 * Math.sin(7 * t + c));
    p.lineTo(k * Math.cos(t), k * Math.sin(t));
  }
  p.closePath();
  return p;
}

// [hue, saturation, lightness]: soft magenta, violet, periwinkle, gold, ochre, coral pink, lime.
const COLOURS = [[322, 28, 54], [278, 24, 56], [230, 24, 60], [42, 36, 52], [30, 30, 50], [352, 32, 58], [82, 26, 48]];

// One colony R px across: a plate on top, then rings of plates around and below it, each tier
// overlapping the one above, with gaps so the edge is ragged.
function cascade(cx: number, cy: number, R: number): Plate[] {
  const tiers = Math.max(1, Math.round(R / 45));
  const step = R / (tiers + 0.5);
  const [h, s, l] = COLOURS[Math.floor(Math.random() * COLOURS.length)];
  // Its colour shifts smoothly across it, so it's varied but of a piece: a way from its top to its
  // edge, and a way round it (warmer one side, cooler the other), and each plate a touch more.
  const [drift, swing, facing] = [rand(-30, 30), rand(12, 24), rand(0, TAU)];
  const out: Plate[] = [];
  for (let t = tiers; t >= 0; t--) {
    const ring = t ? Math.max(1, Math.round((TAU * t) / 1.2)) : 1;
    const turn = rand(0, TAU);
    for (let k = 0; k < ring; k++) {
      if (t && Math.random() < 0.2) continue;
      const a = turn + (k / ring) * TAU + rand(-0.3, 0.3);
      const d = t * step * rand(0.85, 1.1);
      const height = tiers - t + rand(-0.3, 0.3); // in tiers
      out.push({
        x: cx + d * Math.cos(a) + rand(-0.25, 0.25) * step,
        y: cy + d * Math.sin(a) + rand(-0.25, 0.25) * step,
        lift: 5 + 6 * height,
        path: plate(step * rand(0.8, 1.1)),
        color: `hsl(${h + (drift * t) / tiers + (swing * t * Math.cos(a - facing)) / tiers + rand(-6, 6)} ${s + rand(-5, 5)}% ${l - 8 + (12 * height) / tiers + rand(-2, 2)}%)`,
      });
    }
  }
  return out.sort((a, b) => a.lift - b.lift); // lower tiers first, so the ones above cover them
}

// About one colony (150-400 CSS px across) for every seven cells of screen, kept apart, and four
// small ones (50-110 px) on the sand for each.
export function placeReef(cell: number): Plate[] {
  const W = Math.max(screen.width, window.innerWidth);
  const H = Math.max(screen.height, window.innerHeight);
  const spots: [number, number, number][] = [];
  const place = (R: number) => {
    let [x, y] = [rand(0, W), rand(0, H)];
    for (let k = 0; k < 50 && spots.some(([u, v, q]) => Math.hypot(u - x, v - y) < 1.1 * (q + R)); k++) [x, y] = [rand(0, W), rand(0, H)];
    spots.push([x, y, R]);
  };
  const colonies = Math.max(2, Math.round((W * H) / (7 * cell * cell)));
  for (let i = 0; i < colonies; i++) place(cell * rand(0.35, 0.9));
  for (let i = 0; i < 4 * colonies; i++) place(cell * rand(0.12, 0.25));
  return spots.flatMap(([x, y, R]) => cascade(x, y, R));
}

// The reef on a w x h px canvas, transparent where there's only sand.
export function drawReef(plates: Plate[], w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  for (const p of plates) {
    ctx.setTransform(1, 0, 0, 1, p.x + 0.6 * p.lift, h - p.y + 0.8 * p.lift);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fill(p.path);
    ctx.setTransform(1, 0, 0, 1, p.x, h - p.y);
    ctx.fillStyle = p.color;
    ctx.fill(p.path);
  }
  return canvas;
}
