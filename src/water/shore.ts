// Beach: life on and over the beach, on two canvases of its own: crabs on the sand (`low`, under the
// white water), and now and then gulls flying over, with their shadows (`sky`, over everything).
// Flat, like the rest: each part one colour, the shadows hard.
import { groundAt, worldH, type SurfGrid } from './surf';
import { stage } from './stage';

const TAU = Math.PI * 2;
const NIGHT = [0.5, 0.6, 0.68]; // each colour by night (beach.ts: NIGHT)
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// A crab: where it is (px), which way it faces (radians), which way along its sides it's going
// (+1 to its right, -1 to its left), whether it's walking or stopped and for how long more (s),
// its legs' step (radians), its speed (px/s on a screen 800 px tall), its size (px across its
// shell, likewise) and colour.
type Crab = { x: number; y: number; face: number; dir: number; walking: boolean; until: number; gait: number; speed: number; size: number; shell: number[]; legs: number[] };
// A gull: where it is (px), its velocity (px/s), how fast it's turning (radians/s), its wingbeat
// (radians), whether it's gliding and for how long more (s), its wingspan (px on a screen 800 px
// tall).
type Gull = { x: number; y: number; vx: number; vy: number; turn: number; beat: number; gliding: boolean; until: number; span: number };

// A crab (or none), small, sits a long while on the beach, then scuttles sideways along it, facing
// the sea, back or forth, turning back where the sand ends (at the swash's reach, rock or the
// screen's edge). Gulls come over in ones, twos or threes every 30-75 s, small and high, crossing
// the screen in a long gentle curve, flapping and gliding by turns; their shadows fall well down and
// to the right of them.
export function shore(low: HTMLCanvasElement, sky: HTMLCanvasElement) {
  const ltx = low.getContext('2d')!;
  const stx = sky.getContext('2d')!;
  let w = 0;
  let h = 0;
  let u = 1; // the screen's height over 800 px
  let grid: SurfGrid | null = null;
  let crabs: Crab[] = [];
  let gulls: Gull[] = [];
  let flock = rand(8, 20); // s till the next gulls come over
  let seaward = 0; // the way down the beach (radians)

  // Sand a crab can walk on: up the beach clear of the swash, off the rocks, on the screen.
  const sand = (x: number, y: number) => {
    if (!grid || x < 12 || x > w - 12 || y < 60 || y > h - 12) return false;
    const g = groundAt(grid, (x * worldH()) / h, (y * worldH()) / h);
    return g.d < -1.5 && g.reef < 0.2;
  };
  const place = () => {
    crabs = [];
    if (!grid) return;
    const up = groundAt(grid, 0, 0).up;
    seaward = Math.atan2(-up[1], -up[0]);
    for (let i = 0; i < (Math.random() < 0.6 ? 1 : 0); i++) {
      for (let k = 0; k < 300; k++) {
        const [x, y] = [rand(0, w), rand(0, h)];
        if (!sand(x, y)) continue;
        const red = rand(0.9, 1.1);
        crabs.push({
          x,
          y,
          face: seaward + rand(-0.4, 0.4),
          dir: Math.random() < 0.5 ? 1 : -1,
          walking: false,
          until: rand(0, 2),
          gait: 0,
          speed: rand(22, 34),
          size: rand(4, 6),
          shell: [222 * red, 112, 72].map(Math.round),
          legs: [188 * red, 88, 58].map(Math.round),
        });
        break;
      }
    }
  };

  const resize = () => {
    const dpr = stage.dpr(1.5);
    w = stage.w;
    h = stage.h;
    u = (h * stage.zoom) / 800; // (the window's height, drawn smaller on a phone: see worldH())
    for (const [c, x] of [
      [low, ltx],
      [sky, stx],
    ] as const) {
      c.width = w * dpr;
      c.height = h * dpr;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    grid = null; // place them again on the new layout
    shown = true;
  };
  let shown = true; // anything drawn: once the scene's gone, they're cleared once, then left alone
  resize();

  // A crab, from above: four short legs a side (each two segments, stepping in turn as it walks),
  // its shell, a highlight on it towards the light, and two eyes. `flat`: all in one colour (its
  // shadow).
  const crab = (x: CanvasRenderingContext2D, c: Crab, rgb: (c: number[]) => string, flat?: string) => {
    const s = c.size * u;
    const f = [Math.cos(c.face), Math.sin(c.face)]; // forward
    const r = [-f[1], f[0]]; // its right
    const at = (a: number, b: number): [number, number] => [c.x + r[0] * a * s + f[0] * b * s, c.y + r[1] * a * s + f[1] * b * s];
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.strokeStyle = flat ?? rgb(c.legs);
    x.lineWidth = 0.2 * s;
    // Out to `side`, turned `a` radians towards the front.
    const out = (a: number, side: number) => [r[0] * side * Math.cos(a) + f[0] * Math.sin(a), r[1] * side * Math.cos(a) + f[1] * Math.sin(a)];
    for (const side of [1, -1])
      for (let k = 0; k < 4; k++) {
        // Out to the side, the front ones angled forward and the back ones back, splaying further
        // past the knee; each swings as it steps, the two sides out of step.
        const swing = c.walking ? 0.35 * Math.sin(c.gait + k * 1.6 + (side > 0 ? 0 : Math.PI)) : 0;
        const a = 0.55 - 0.36 * k + swing;
        const base = at(0.7 * side, 0.25 - 0.2 * k);
        const [d1, d2] = [out(a, side), out(1.5 * a + (k < 2 ? 0.2 : -0.2), side)];
        const knee = [base[0] + d1[0] * 0.45 * s, base[1] + d1[1] * 0.45 * s];
        const tip = [knee[0] + d2[0] * 0.4 * s, knee[1] + d2[1] * 0.4 * s];
        x.beginPath();
        x.moveTo(...base);
        x.lineTo(knee[0], knee[1]);
        x.lineTo(tip[0], tip[1]);
        x.stroke();
      }
    // The shell: wider than it is long, a little flattened in front.
    x.beginPath();
    x.ellipse(c.x, c.y, s, 0.74 * s, c.face + Math.PI / 2, 0, TAU);
    x.fillStyle = flat ?? rgb(c.shell);
    x.fill();
    if (flat) return;
    const lit = at(-0.25, 0.15);
    x.beginPath();
    x.ellipse(lit[0], lit[1], 0.45 * s, 0.28 * s, c.face + Math.PI / 2, 0, TAU);
    x.fillStyle = rgb(c.shell.map((v) => Math.min(255, v * 1.18 + 20)));
    x.fill();
    x.fillStyle = 'rgba(30, 20, 15, 0.9)';
    for (const side of [1, -1]) {
      const eye = at(0.28 * side, 0.68);
      x.beginPath();
      x.arc(eye[0], eye[1], 0.11 * s, 0, TAU);
      x.fill();
    }
  };

  // A gull, from above: grey wings with black tips, a white body and tail, a yellow bill. As it
  // flaps its wings sweep up and down, so seen from above they seem to shorten and lengthen.
  const gull = (x: CanvasRenderingContext2D, g: Gull, rgb: (c: number[]) => string, flat?: string) => {
    const s = 0.5 * g.span * u; // half its span
    const a = Math.atan2(g.vy, g.vx);
    const f = [Math.cos(a), Math.sin(a)];
    const r = [-f[1], f[0]];
    const reach = g.gliding ? 1 : 0.72 + 0.28 * Math.cos(g.beat);
    const at = (across: number, along: number): [number, number] => [g.x + r[0] * across * s + f[0] * along * s, g.y + r[1] * across * s + f[1] * along * s];
    for (const side of [1, -1]) {
      const k = side * reach;
      const sweep = g.gliding ? 0 : 0.06 * Math.sin(g.beat);
      // Leading edge out to the wrist, then swept back to the tip; trailing edge back in.
      const wing = [at(0.08 * side, 0.12), at(0.48 * k, 0.16 + sweep), at(1.0 * k, -0.12 + sweep), at(0.78 * k, -0.2 + sweep), at(0.42 * k, -0.18), at(0.08 * side, -0.16)];
      x.beginPath();
      for (const p of wing) x.lineTo(...p);
      x.closePath();
      x.fillStyle = flat ?? rgb([178, 186, 194]);
      x.fill();
      if (flat) continue;
      x.beginPath();
      for (const p of [at(0.72 * k, 0.04 + sweep), at(1.0 * k, -0.12 + sweep), at(0.8 * k, -0.2 + sweep)]) x.lineTo(...p);
      x.closePath();
      x.fillStyle = rgb([42, 42, 46]);
      x.fill();
    }
    // Body, from bill to tail.
    x.beginPath();
    for (const p of [at(0, 0.5), at(0.07, 0.4), at(0.1, 0.2), at(0.09, -0.15), at(0.13, -0.42), at(0, -0.38), at(-0.13, -0.42), at(-0.09, -0.15), at(-0.1, 0.2), at(-0.07, 0.4)]) x.lineTo(...p);
    x.closePath();
    x.fillStyle = flat ?? rgb([246, 246, 242]);
    x.fill();
    if (flat) return;
    x.beginPath();
    for (const p of [at(0, 0.62), at(0.03, 0.49), at(-0.03, 0.49)]) x.lineTo(...p);
    x.closePath();
    x.fillStyle = rgb([236, 196, 70]);
    x.fill();
  };

  return {
    resize,
    draw(t: number, dt: number, weight: number, day: number, g: SurfGrid) {
      if (shown) {
        ltx.clearRect(0, 0, w, h);
        stx.clearRect(0, 0, w, h);
      }
      shown = weight >= 0.003;
      low.style.visibility = shown && crabs.length ? '' : 'hidden';
      sky.style.visibility = shown && gulls.length ? '' : 'hidden'; // hidden, empty canvases cost nothing
      if (!shown) return;
      if (grid !== g) {
        grid = g;
        place();
      }
      const rgb = (c: number[]) => `rgb(${c.map((v, k) => Math.round(v * (NIGHT[k] + (1 - NIGHT[k]) * day))).join(',')})`;
      ltx.globalAlpha = stx.globalAlpha = weight;

      for (const c of crabs) {
        c.until -= dt;
        if (c.until <= 0) {
          c.walking = !c.walking;
          c.until = c.walking ? rand(0.8, 2.6) : rand(3, 15);
          if (c.walking) {
            if (Math.random() < 0.45) c.dir = -c.dir;
            c.face += 0.3 * (seaward - c.face) + rand(-0.3, 0.3); // mostly facing the sea
          }
        }
        if (c.walking) {
          const step = c.speed * u * dt;
          const side = [-Math.sin(c.face) * c.dir, Math.cos(c.face) * c.dir];
          const lead = c.size * u * 1.6;
          if (sand(c.x + side[0] * (step + lead), c.y + side[1] * (step + lead))) {
            c.x += side[0] * step;
            c.y += side[1] * step;
            c.gait += 26 * dt * stage.tempo; // its legs a blur
          } else {
            c.dir = -c.dir; // the sand ends: stop, and go back the other way
            c.walking = false;
            c.until = rand(2, 6);
          }
        }
        ltx.save();
        ltx.translate(0.2 * c.size * u, 0.3 * c.size * u);
        crab(ltx, c, rgb, 'rgba(70, 50, 25, 0.22)');
        ltx.restore();
        crab(ltx, c, rgb);
      }

      flock -= dt;
      if (flock <= 0 && !gulls.length) {
        // Across the screen in some direction, from just off one side.
        const a = rand(0, TAU);
        const [dx, dy] = [Math.cos(a), Math.sin(a)];
        const far = 0.5 * Math.hypot(w, h) + 80 * u;
        const off = rand(-0.3, 0.3) * Math.hypot(w, h);
        const n = Math.random() < 0.45 ? 1 : Math.random() < 0.65 ? 2 : 3;
        const speed = rand(110, 150) * u;
        for (let i = 0; i < n; i++) {
          const back = i * rand(25, 45) * u;
          const aside = (i ? rand(-1, 1) : 0) * 30 * u;
          gulls.push({
            x: w / 2 - dx * (far + back) - dy * (off + aside),
            y: h / 2 - dy * (far + back) + dx * (off + aside),
            vx: dx * speed * rand(0.95, 1.05),
            vy: dy * speed * rand(0.95, 1.05),
            turn: rand(-0.08, 0.08),
            beat: rand(0, TAU),
            gliding: Math.random() < 0.5,
            until: rand(0.8, 2),
            span: rand(31, 39),
          });
        }
        flock = rand(30, 75);
      }
      for (const g of gulls) {
        g.until -= dt;
        if (g.until <= 0) {
          g.gliding = !g.gliding;
          g.until = g.gliding ? rand(1, 3) : rand(0.8, 2);
          g.turn = rand(-0.08, 0.08);
        }
        if (!g.gliding) g.beat += dt * 9 * stage.tempo;
        const [c, sn] = [Math.cos(g.turn * dt), Math.sin(g.turn * dt)];
        [g.vx, g.vy] = [g.vx * c - g.vy * sn, g.vx * sn + g.vy * c];
        g.x += g.vx * dt;
        g.y += g.vy * dt;
      }
      gulls = gulls.filter((g) => Math.hypot(g.x - w / 2, g.y - h / 2) < 0.5 * Math.hypot(w, h) + 300 * u);
      // Their shadows first (on the water or sand far below), then them.
      for (const g of gulls) {
        stx.save();
        stx.translate(70 * u, 105 * u);
        gull(stx, g, rgb, 'rgba(0, 25, 40, 0.16)');
        stx.restore();
      }
      for (const g of gulls) gull(stx, g, rgb);
      ltx.globalAlpha = stx.globalAlpha = 1;
    },
  };
}
