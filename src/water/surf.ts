// Surf: the seabed under the Beach scene and what it does to the swell crossing it, worked out once
// per layout (each visit, reroll and resize) on a coarse grid, so that each frame only has to look
// it up (see beach.ts and beach.glsl).
//
// The seabed: a beach, facing any way on the screen and taking up a fifth or so of it. Its water's
// edge bows into a gentle bay or bulge, wanders irregularly (three octaves of it), is scalloped with
// cusps, and may have a rocky headland or two jutting out: steep on one side with a long curving bay
// in its lee, the shape headland-bay beaches take (two make a pocket beach), its rock running on
// out under the water as a reef the waves wrap round. Offshore its depth grows as
// distance^(2/3) (an equilibrium beach profile), with up to two sandbars running along it, bent into
// crescents, with gaps for rip channels and a trough on their landward side, and now and then a reef:
// a craggy mound rising off the bottom. It's all worked out in the beach's own frame: u along the
// shore, v towards it (m from the middle of the screen).
//
// The swell comes in from offshore, long and straight, at up to 54 degrees off head-on (60% of the
// way to running along the beach), and the seabed does the rest.
// - Waves slow in shallow water, so their crests swing round towards the shallows (refraction). How
//   long a crest takes to reach each point is found by solving the eikonal equation |grad S| = k,
//   with k the local wavenumber from the dispersion relation, by a few fast sweeps over the grid;
//   its gradient is the way the waves run there.
// - Then, point by point in the order the waves reach them, each takes its wave height from just
//   upstream along its ray: taller as the water shallows (shoaling) and where rays converge, until a
//   wave stands taller than 0.78 of the depth and breaks. From there on it is white water, its height
//   held to that limit, until the water deepens again (a trough behind a bar, a channel) and it
//   reforms, to break again nearer the shore.
// - How it breaks depends on the slope it breaks on (the Iribarren number): a steep bar or reef face
//   throws a plunging lip, a gentle slope spills.
// All of it for three wave sizes, so each wave in a set can blend between them.
import { stage } from './stage';
const TAU = Math.PI * 2;
const G = 9.81;
export const WORLD_H = 260; // m of sea from the top of the screen to the bottom (on a laptop's)
// ... and on this one: more on a phone, where the scene is drawn smaller (stage.ts), so its waves,
// particles and rocks shrink with the fish and the rest.
export const worldH = () => WORLD_H / stage.zoom;
const STEP = 4; // m between grid points
const GAMMA = 0.78; // a wave breaks once it is taller than this much of the depth
export const SIZES = [0.7, 1, 1.35]; // the wave sizes it is worked out for, times the swell's height
// How it's drawn (beach.glsl has the same: change both together).
export const TILT = 0.6; // screen px up per px of height: the 3/4 view
export const LIFT = 10; // heights drawn this many times taller than they are, to read from above
export const LIP = 22; // m a plunging lip runs, throwing and landing, before it's a bore
const rand = (a: number, b: number) => a + Math.random() * (b - a);

type Bar = { r: number; height: number; width: number; crescent: number; len: number; phase: number };
type Reef = { x: number; y: number; radius: number; top: number; lumps: [number, number, number] };
type Head = { x: number; out: number; steep: number; tail: number; side: number }; // x: along the shore (0-1); out, steep (width on its steep side), tail (on its long side): m; side: which side is steep
export type Surf = {
  facing: number; // the way up the beach, from the sea (radians, screen axes, y down)
  land: number; // how much of the screen, across the beach, is beach (0-1)
  bend: [number, number, number, number, number]; // the water's edge: m it bows towards the land per (100 m along it)^2 (a bay); then its wander: m, m long, and two phases
  heads: Head[];
  angle: number; // the swell, radians off head-on to the beach
  period: number; // s
  height: number; // m, a typical wave's height offshore
  seed: number;
  steep: number; // the beach profile's A: depth = A x^(2/3)
  cusps: [number, number, number]; // m high, m apart, phase: scallops along the water's edge
  bars: Bar[];
  rips: { x: number; width: number }[]; // x: along the shore, across the screen (0-1); width: m
  reefs: Reef[]; // x: along the shore (0-1); y: out from it, of the sea on screen (0-1)
};

// What buildSurf() needs of the swell, and of where the shore lies (the beach's Surf has it all; the
// reef has its own: reef.ts).
export type Swell = Pick<Surf, 'facing' | 'land' | 'angle' | 'period' | 'height' | 'seed'>;

// The beach's frame on a screen W by H m: its middle (m from the top left), the way up the beach (n)
// and along it (t), how far the screen reaches either way in it, and where the water's edge runs
// (v, before its bends) and how much sea there is in front of it.
export function shoreFrame(s: Pick<Surf, 'facing' | 'land'>, W: number, H: number) {
  const n = [Math.cos(s.facing), Math.sin(s.facing)];
  const t = [-n[1], n[0]];
  const [cx, cy] = [W / 2, H / 2];
  const corners = [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ].map(([x, y]) => [(x - cx) * t[0] + (y - cy) * t[1], (x - cx) * n[0] + (y - cy) * n[1]]);
  const [umin, umax] = [Math.min(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[0]))];
  const [vmin, vmax] = [Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[1]))];
  const shore = vmax - s.land * (vmax - vmin);
  return { cx, cy, n, t, umin, umax, vmin, vmax, shore, sea: shore - vmin };
}
export type Frame = ReturnType<typeof shoreFrame>;
// A seabed: at (u, v) in the frame, depth (m; negative on land), how much reef or rock there is
// (0-1), and m out from the water's edge.
export type Bed = (f: Frame, u: number, v: number) => [number, number, number];

// The random part: new every visit and reroll.
export function placeSurf(): Surf {
  const bars: Bar[] = [];
  const count = Math.floor(rand(0, 2.99)); // none, one or two
  for (let i = 0; i < count; i++)
    bars.push({ r: i ? rand(110, 165) : rand(45, 80), height: rand(1.2, 2.4), width: rand(10, 22), crescent: rand(0, 18), len: rand(140, 320), phase: rand(0, TAU) });
  return {
    facing: rand(0, TAU),
    land: rand(0.15, 0.25),
    bend: [rand(-4, 4), rand(2, 12), rand(160, 380), rand(0, TAU), rand(0, TAU)],
    heads: (() => {
      const count = Math.random() < 0.5 ? 0 : Math.random() < 0.7 ? 1 : 2;
      const xs = count === 2 ? [rand(0.05, 0.3), rand(0.7, 0.95)] : [rand(0.15, 0.85)];
      return xs.slice(0, count).map((x, i) => ({ x, out: rand(25, 60), steep: rand(18, 35), tail: rand(60, 140), side: count === 2 ? (i ? 1 : -1) : Math.random() < 0.5 ? -1 : 1 }));
    })(),
    angle: rand(-0.94, 0.94),
    period: rand(9, 12),
    height: rand(1, 1.8),
    seed: rand(0, 100),
    steep: rand(0.13, 0.2),
    cusps: [rand(0, 2.5), rand(25, 45), rand(0, TAU)],
    bars,
    rips: Array.from({ length: bars.length ? Math.floor(rand(0, 3.99)) : 0 }, () => ({ x: rand(0.05, 0.95), width: rand(8, 18) })),
    reefs: Array.from({ length: Math.random() < 0.55 ? Math.floor(rand(1, 2.99)) : 0 }, () => ({
      x: rand(0.15, 0.85),
      y: rand(0.35, 0.8),
      radius: rand(15, 40),
      top: rand(-0.8, 0.6), // above the water (a rock stack) more often than not
      lumps: [rand(0, TAU), rand(0, TAU), rand(0, TAU)],
    })),
  };
}

// Depth (m; negative on the beach), how much is reef or rock (0-1), and how far out from the water's
// edge it is (m; negative up the beach) at (u, v) in the beach's frame.
export function seabed(s: Surf, f: Frame, u: number, v: number): [number, number, number] {
  const x = u - f.umin; // m along the shore from the screen's first corner
  const W = f.umax - f.umin;
  const [bow, wander, length, a, b] = s.bend;
  const L = (TAU * u) / length;
  let edge = f.shore + bow * (u / 100) ** 2 + wander * (Math.sin(L + a) + 0.5 * Math.sin(2.3 * L + b) + 0.25 * Math.sin(5.1 * L + a + b)) / 1.75;
  edge += s.cusps[0] * Math.sin((TAU * u) / s.cusps[1] + s.cusps[2]);
  // Headlands: how far each juts out here, and how much of it is rock (its core, out to sea and some
  // way back behind the beach).
  let rock = 0;
  const plain = edge;
  for (const hd of s.heads) {
    const du = x - hd.x * W;
    const jut = hd.out * Math.exp(-((du / (du * hd.side > 0 ? hd.steep : hd.tail)) ** 2));
    edge -= jut;
    rock = Math.max(rock, Math.min(1, Math.max(0, (jut / hd.out - 0.3) / 0.3)));
  }
  const r = edge - v; // m offshore
  if (r <= 0) {
    // On land the rock gives way to the beach behind it along a ragged line.
    const ragged = 22 + 9 * Math.sin(u / 11 + a) + 5 * Math.sin(u / 4.7 + b);
    return [r * 0.08, rock * (1 - Math.min(1, Math.max(0, (v - plain - ragged) / 12))), r];
  }
  rock *= Math.exp(-r / 42); // the point's reef, running out under the water
  let d = s.steep * Math.pow(r, 2 / 3);
  for (const bar of s.bars) {
    let open = 1; // 0 in a rip channel
    for (const rip of s.rips) open = Math.min(open, 1 - Math.exp(-(((x - rip.x * W) / rip.width) ** 2)));
    const rb = bar.r + bar.crescent * Math.sin((TAU * x) / bar.len + bar.phase);
    d -= bar.height * open * Math.exp(-(((r - rb) / bar.width) ** 2));
    d += 0.4 * bar.height * Math.exp(-(((r - rb + 1.8 * bar.width) / (1.2 * bar.width)) ** 2)); // the trough behind it
  }
  if (r > 20) d = Math.max(d, 0.25); // a bar's crest stays under water: no sand islands offshore
  d = Math.min(d, d + (-0.4 - d) * rock); // the point's rock, standing out of the water: the waves break against it and wrap round
  let reef = rock;
  for (const o of s.reefs) {
    const dx = x - o.x * W;
    const dy = v - (f.shore - o.y * f.sea);
    const a = Math.atan2(dy, dx);
    const lumpy = 1 + 0.22 * Math.sin(3 * a + o.lumps[0]) + 0.12 * Math.sin(5 * a + o.lumps[1]) + 0.08 * Math.sin(8 * a + o.lumps[2]);
    const e = (dx * dx + dy * dy) / (o.radius * lumpy) ** 2;
    const q = Math.exp(-e * e); // flat-topped and steep-sided, so a stack stands well out of the water
    if (d > o.top) d += (o.top - d) * q; // rising to `top` m below the surface (above it, if negative)
    reef = Math.max(reef, q);
  }
  return [d, reef, r];
}

// The wavenumber (radians per m) for waves of angular frequency w in water d m deep (Eckart's
// approximation to the dispersion relation, within a few per cent), and their group velocity (m/s).
const wavenumber = (w: number, d: number) => {
  const k0 = (w * w) / G;
  return k0 / Math.sqrt(Math.tanh(k0 * Math.max(d, 0.3)));
};
const groupVelocity = (w: number, k: number, d: number) => {
  const kd2 = Math.min(2 * k * Math.max(d, 0.3), 20);
  return (0.5 * (1 + kd2 / Math.sinh(kd2)) * w) / k;
};

export type SurfGrid = ReturnType<typeof buildSurf>;

// The grid over the seabed `bed`, in the shore's frame (rows run along the shore, offshore first), on
// a screen w by h px: it reaches a little past the screen on every side, and well past it out to
// sea, so the swell starts out in deep, even water and edges stay off screen.
export function buildSurf(s: Swell, w: number, h: number, bed: Bed) {
  const f = shoreFrame(s, (w * worldH()) / h, worldH());
  const [su, sv] = [f.umax - f.umin, f.vmax - f.vmin];
  const x0 = f.umin - 0.2 * su - 30; // u of the first point
  const y0 = f.vmin - 0.35 * sv - 20; // v of the first row
  const nx = Math.ceil((1.4 * su + 60) / STEP) + 1;
  const ny = Math.ceil((1.35 * sv + 28) / STEP) + 1;
  const N = nx * ny;
  const depth = new Float32Array(N);
  const reef = new Float32Array(N);
  const offshore = new Float32Array(N); // m out from the water's edge
  const k = new Float32Array(N);
  const omega = TAU / s.period;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const [d, r, out] = bed(f, x0 + i * STEP, y0 + j * STEP);
      depth[j * nx + i] = d;
      reef[j * nx + i] = r;
      offshore[j * nx + i] = out;
      k[j * nx + i] = wavenumber(omega, d);
    }

  // Arrival: S, in wave periods (so a crest is where S - t / period is a whole number). The swell
  // enters as a plane wave along the first row, and down both sides as it would cross depth
  // contours running along the shore (Snell's law: its wavenumber along the shore stays the same, ku,
  // and the rest goes into heading inshore), so an oblique swell needs no great margin to come in
  // from; fast sweeping (Godunov upwind) fills in the rest.
  const S = new Float32Array(N).fill(Infinity);
  let kOut = 0; // the wavenumber out in the deep, along the first row
  for (let i = 0; i < nx; i++) kOut += k[i] / nx;
  const ku = kOut * Math.sin(s.angle);
  for (let i = 0; i < nx; i++) S[i] = (ku * (x0 + i * STEP)) / TAU;
  for (const i of [0, nx - 1])
    for (let j = 1; j < ny; j++) {
      const p = j * nx + i;
      S[p] = S[p - nx] + (Math.sqrt(Math.max(k[p] * k[p] - ku * ku, 1e-6)) * STEP) / TAU;
    }
  const relax = (i: number, j: number) => {
    const p = j * nx + i;
    const a = Math.min(i > 0 ? S[p - 1] : Infinity, i < nx - 1 ? S[p + 1] : Infinity);
    const b = Math.min(S[p - nx], j < ny - 1 ? S[p + nx] : Infinity);
    const f = (k[p] / TAU) * STEP;
    const v = Math.abs(a - b) >= f ? Math.min(a, b) + f : (a + b + Math.sqrt(2 * f * f - (a - b) ** 2)) / 2;
    if (v < S[p]) S[p] = v;
  };
  for (let round = 0; round < 2; round++) {
    for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) relax(i, j);
    for (let j = 1; j < ny; j++) for (let i = nx - 1; i >= 0; i--) relax(i, j);
    for (let j = ny - 1; j >= 1; j--) for (let i = 0; i < nx; i++) relax(i, j);
    for (let j = ny - 1; j >= 1; j--) for (let i = nx - 1; i >= 0; i--) relax(i, j);
  }

  // Which way the waves run (unit vectors, grid axes) and how fast the rays spread (their divergence).
  const dirX = new Float32Array(N);
  const dirY = new Float32Array(N);
  const at = (i: number, j: number) => S[Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const gx = at(i + 1, j) - at(i - 1, j);
      const gy = at(i, j + 1) - at(i, j - 1);
      const m = Math.hypot(gx, gy) || 1;
      dirX[j * nx + i] = gx / m;
      dirY[j * nx + i] = gy / m;
    }
  const spread = new Float32Array(N);
  for (let j = 1; j < ny - 1; j++)
    for (let i = 1; i < nx - 1; i++) {
      const p = j * nx + i;
      spread[p] = (dirX[p + 1] - dirX[p - 1] + dirY[p + nx] - dirY[p - nx]) / (2 * STEP);
    }

  // Heights and breaking, point by point in order of arrival, each from one step upstream along
  // its ray. For each wave size: its height (m), how far it has run since it broke (m; 0 unbroken),
  // its white water (0-1, fading as it reforms), and how it broke (the Iribarren number).
  const H = SIZES.map(() => new Float32Array(N));
  const since = SIZES.map(() => new Float32Array(N));
  const foam = SIZES.map(() => new Float32Array(N));
  const xi = SIZES.map(() => new Float32Array(N));
  const spreading = new Float32Array(N); // log of how far apart the rays have spread
  const done = new Uint8Array(N);
  const L0 = (G * s.period * s.period) / TAU; // deep-water wavelength
  const cgDeep = G / (2 * omega);
  for (let i = 0; i < nx; i++) {
    const cg = groupVelocity(omega, k[i], depth[i]);
    SIZES.forEach((size, c) => (H[c][i] = s.height * size * Math.sqrt(cgDeep / cg)));
    done[i] = 1;
  }
  // Measured from the middle of the grid, to keep the numbers small for the texture's half floats.
  const middle = S[(ny >> 1) * nx + (nx >> 1)];
  for (let p = 0; p < N; p++) S[p] -= middle;
  const order = new Uint32Array(N).map((_, p) => p).sort((p, q) => S[p] - S[q]);
  const corners = [0, 1, nx, nx + 1];
  for (const p of order) {
    if (done[p] || !Number.isFinite(S[p])) continue;
    const i = p % nx;
    const j = (p / nx) | 0;
    const ux = Math.min(nx - 1.001, Math.max(0, i - dirX[p]));
    const uy = Math.min(ny - 1.001, Math.max(0, j - dirY[p]));
    const bi = Math.floor(ux);
    const bj = Math.floor(uy);
    const fx = ux - bi;
    const fy = uy - bj;
    const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    let total = 0;
    const base = bj * nx + bi;
    for (let n = 0; n < 4; n++) if (!done[base + corners[n]]) weights[n] = 0;
    for (const wt of weights) total += wt;
    const up = (field: Float32Array) => {
      if (total < 1e-4) return field[p - nx]; // nothing upstream yet: the point above
      let v = 0;
      for (let n = 0; n < 4; n++) v += weights[n] * field[base + corners[n]];
      return v / total;
    };
    const d = depth[p];
    const dUp = up(depth);
    const kUp = wavenumber(omega, dUp);
    const cg = groupVelocity(omega, k[p], d);
    const cgUp = groupVelocity(omega, kUp, dUp);
    spreading[p] = Math.min(2.5, Math.max(-0.7, up(spreading) + spread[p] * STEP)); // rays focus at most 1.4x
    const grow = Math.sqrt(cgUp / cg) * Math.exp((up(spreading) - spreading[p]) / 2);
    // The bottom's slope up along the ray (central differences: smoother than one step upstream).
    const dx = depth[Math.min(i + 1, nx - 1) + j * nx] - depth[Math.max(i - 1, 0) + j * nx];
    const dy = depth[i + Math.min(j + 1, ny - 1) * nx] - depth[i + Math.max(j - 1, 0) * nx];
    const slope = Math.max(0.005, -(dx * dirX[p] + dy * dirY[p]) / (2 * STEP));
    for (let c = 0; c < SIZES.length; c++) {
      let height = up(H[c]) * grow;
      let run = up(since[c]);
      let white = up(foam[c]);
      let type = up(xi[c]);
      if (d <= 0.05) {
        height = 0; // up the beach
      } else if (height > GAMMA * d) {
        if (run === 0) type = slope / Math.sqrt(height / L0);
        run += STEP;
        height = GAMMA * d;
        white = 1;
      } else if (run > 0) {
        white *= Math.exp(-STEP / 30); // reforming
        if (white < 0.05) [run, white] = [0, 0];
      }
      H[c][p] = height;
      since[c][p] = run;
      foam[c][p] = white;
      xi[c][p] = type;
    }
    done[p] = 1;
  }
  // Soften the break's edges with a few metres' blur, so that neighbouring points that only just did
  // or didn't break (a wave right at the limit) don't leave hard-edged blocks of white water (how it
  // broke is averaged over where it did); the heights too, so that where rays converge behind a reef
  // the wave peaks over a stretch of water rather than in a sliver.
  const blur = (f: Float32Array) => {
    const tmp = new Float32Array(N);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          let sum = 0;
          for (let o = -2; o <= 2; o++) sum += f[j * nx + Math.min(nx - 1, Math.max(0, i + o))];
          tmp[j * nx + i] = sum / 5;
        }
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          let sum = 0;
          for (let o = -2; o <= 2; o++) sum += tmp[Math.min(ny - 1, Math.max(0, j + o)) * nx + i];
          f[j * nx + i] = sum / 5;
        }
    }
    return f;
  };
  for (let c = 0; c < SIZES.length; c++) {
    const weighted = blur(xi[c].map((x, p) => x * foam[c][p]));
    blur(foam[c]);
    blur(since[c]);
    blur(H[c]);
    for (let p = 0; p < N; p++) xi[c][p] = weighted[p] / Math.max(foam[c][p], 1e-3);
  }
  return { nx, ny, x0, y0, step: STEP, frame: f, depth, reef, offshore, S, dirX, dirY, H, since, foam, xi };
}

// The grid as beach.glsl takes it: four tiles stacked, as half floats (RGBA): the crests' arrival,
// the depth, the reef and how far out from the water's edge it is; then for each wave size its
// height, how far it has run since breaking, its white water and its Iribarren number.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const half = (v: number) => {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 112; // exponent, rebiased from 127 to 15
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7bff; // the largest half
  return sign | (e << 10) | ((x >>> 13) & 0x3ff);
};
export function packSurf(g: SurfGrid) {
  const n = g.nx * g.ny;
  const out = new Uint16Array(n * 16);
  const put = (tile: number, p: number, ...v: number[]) => v.forEach((x, c) => (out[(tile * n + p) * 4 + c] = half(x)));
  for (let p = 0; p < n; p++) {
    put(0, p, g.S[p], g.depth[p], g.reef[p], Math.max(-500, Math.min(500, g.offshore[p])));
    for (let c = 0; c < SIZES.length; c++) put(c + 1, p, g.H[c][p], g.since[c][p], g.foam[c][p], Math.min(g.xi[c][p], 8));
  }
  return out;
}

// Each wave's size, about 0.7 to 1.3, in sets of about seven: n counts the waves.
export const waveSize = (n: number, seed: number) => 1 + 0.18 * Math.sin(2.39996 * n + seed) + 0.14 * Math.sin(0.8976 * n + 1.7 * seed);

// The cross-section of a wave, +1 at its crest and -1 in its trough, at th (radians from the crest,
// negative ahead of it), when it is `ratio` of the way to breaking (height / 0.78 depth): a smooth
// swell offshore; nearer breaking, its crest peaks, its troughs flatten out and lengthen, and its
// face steepens while its back stretches out.
export function profile(th: number, ratio: number) {
  const near = Math.min(1, Math.max(0, ratio));
  const phi = th - 0.6 * near * near * (1 - Math.cos(th));
  return 2 * Math.pow(0.5 + 0.5 * Math.cos(phi), 1 + 3 * near * near) - 1;
}

// A grid field at (x, y) m in the beach's frame (bilinear).
const sample = (g: SurfGrid, f: Float32Array, x: number, y: number) => {
  const u = Math.min(g.nx - 1.001, Math.max(0, (x - g.x0) / g.step));
  const v = Math.min(g.ny - 1.001, Math.max(0, (y - g.y0) / g.step));
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fx = u - i;
  const fy = v - j;
  const p = j * g.nx + i;
  return (f[p] * (1 - fx) + f[p + 1] * fx) * (1 - fy) + (f[p + g.nx] * (1 - fx) + f[p + g.nx + 1] * fx) * fy;
};

// The ground at (sx, sy) m from the screen's top left: how deep the water is (m; less than 0 up the
// beach and on rock standing out of it), how much reef or rock there is, and the way up the beach.
export function groundAt(g: SurfGrid, sx: number, sy: number) {
  const { cx, cy, n, t } = g.frame;
  const x = (sx - cx) * t[0] + (sy - cy) * t[1];
  const y = (sx - cx) * n[0] + (sy - cy) * n[1];
  return { d: sample(g, g.depth, x, y), reef: sample(g, g.reef, x, y), up: n };
}

// The surf at (sx, sy) m from the screen's top left at t s (beach.glsl: surfAt): where it is in its
// wave (th, radians from the crest, negative ahead of it), that wave's height, run since breaking,
// white water and Iribarren number (blended between the sizes it's worked out for by this wave's
// size), the depth, the way the waves run (screen axes), its shape (+1 at the crest) and its height
// drawn (m, LIFT times the real thing).
export function surfAt(g: SurfGrid, s: Pick<Swell, 'period' | 'seed'>, sx: number, sy: number, t: number) {
  const { cx, cy, n: nn, t: tt } = g.frame;
  const x = (sx - cx) * tt[0] + (sy - cy) * tt[1];
  const y = (sx - cx) * nn[0] + (sy - cy) * nn[1];
  const ph = t / s.period - sample(g, g.S, x, y) + 0.04 * Math.sin(x * 0.05 + t * 0.1 + s.seed);
  const n = Math.floor(ph + 0.5);
  const f = ph - n;
  const sm = (a: number, b: number, v: number) => {
    const k = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  let size = waveSize(n, s.seed);
  size += (0.5 * (size + waveSize(n + 1, s.seed)) - size) * sm(0.35, 0.5, f);
  size += (0.5 * (waveSize(n, s.seed) + waveSize(n - 1, s.seed)) - size) * (1 - sm(-0.5, -0.35, f));
  const c = Math.min(2, Math.max(0, size < 1 ? (size - 0.7) / 0.3 : 1 + (size - 1) / 0.35));
  const c0 = Math.min(1, Math.floor(c));
  const pick = (fields: Float32Array[]) => sample(g, fields[c0], x, y) * (1 - (c - c0)) + sample(g, fields[c0 + 1], x, y) * (c - c0);
  const H = pick(g.H);
  const d = sample(g, g.depth, x, y);
  const th = Math.PI * 2 * f;
  const shape = profile(th, H / Math.max(GAMMA * d, 0.05));
  const du = sample(g, g.dirX, x, y);
  const dv = Math.sqrt(Math.max(0, 1 - du * du));
  const dirX = du * tt[0] + dv * nn[0];
  const dirY = du * tt[1] + dv * nn[1];
  return { th, H, run: pick(g.since), foam: pick(g.foam), xi: pick(g.xi), d, dirX, dirY, shape, z: LIFT * 0.5 * H * shape };
}

// Debug (newtab.html?scene=beach&flow): the seabed in bands of depth (a line every metre; sand on the
// beach, the reef in rust), the crests as they come in, coloured by what the typical wave is doing
// there (white swell, yellow spilling, orange plunging, cyan reforming), the way the waves run, and
// where each size of wave first breaks (green small, yellow typical, red big).
export function drawSurfDebug(ctx: CanvasRenderingContext2D, g: SurfGrid, s: Surf, t: number, h: number, ms: number) {
  const px = h / worldH(); // px per m
  const image = new ImageData(g.nx, g.ny);
  for (let p = 0; p < g.nx * g.ny; p++) {
    const d = g.depth[p];
    let c: number[];
    if (d <= 0) c = [214, 196, 150];
    else {
      const v = Math.min(1, d / 12);
      c = [40 + 120 * (1 - v), 90 + 130 * (1 - v), 140 + 90 * (1 - v)];
      if (d % 1 < 0.12) c = c.map((x) => x * 0.8);
      const r = g.reef[p];
      c = c.map((x, n) => x + ([190, 110, 80][n] - x) * r * 0.8);
    }
    image.data.set([c[0], c[1], c[2], 255], p * 4);
  }
  const off = new OffscreenCanvas(g.nx, g.ny);
  off.getContext('2d')!.putImageData(image, 0, 0);
  // Drawn in the beach's frame: (u, v) m to screen px.
  const { cx, cy, n: nn, t: tt } = g.frame;
  ctx.save();
  ctx.transform(px * tt[0], px * tt[1], px * nn[0], px * nn[1], px * cx, px * cy);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, g.x0, g.y0, g.nx * g.step, g.ny * g.step);
  const X = (i: number) => g.x0 + i * g.step;
  const Y = (j: number) => g.y0 + j * g.step;

  // The crests: where S - t / period is a whole number (marching squares).
  const phase = t / s.period;
  const colours = ['#ffffff', '#ffe066', '#ff8a3d', '#5ce1e6'];
  const paths = colours.map(() => new Path2D());
  const state = (p: number) => (g.since[1][p] > 0 && g.foam[1][p] > 0.5 ? (g.xi[1][p] > 0.5 ? 2 : 1) : g.foam[1][p] > 0.05 ? 3 : 0);
  for (let j = 0; j < g.ny - 1; j++)
    for (let i = 0; i < g.nx - 1; i++) {
      const p = j * g.nx + i;
      const v = [g.S[p], g.S[p + 1], g.S[p + g.nx + 1], g.S[p + g.nx]].map((x) => x - phase);
      if (!v.every(Number.isFinite)) continue;
      const lo = Math.ceil(Math.min(...v));
      const hi = Math.floor(Math.max(...v));
      for (let n = lo; n <= hi; n++) {
        const pts: [number, number][] = [];
        const corner = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ];
        for (let e = 0; e < 4; e++) {
          const a = v[e] - n;
          const b = v[(e + 1) % 4] - n;
          if ((a < 0) !== (b < 0)) {
            const f = a / (a - b);
            const [ai, aj] = corner[e];
            const [bi, bj] = corner[(e + 1) % 4];
            pts.push([X(ai + (bi - ai) * f), Y(aj + (bj - aj) * f)]);
          }
        }
        if (pts.length >= 2) {
          const path = paths[state(p)];
          path.moveTo(...pts[0]);
          path.lineTo(...pts[1]);
        }
      }
    }
  ctx.lineWidth = 2.5 / px;
  colours.forEach((c, n) => {
    ctx.strokeStyle = c;
    ctx.stroke(paths[n]);
  });
  // The way the waves run.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1 / px;
  ctx.beginPath();
  for (let j = 0; j < g.ny; j += 6)
    for (let i = 0; i < g.nx; i += 6) {
      const p = j * g.nx + i;
      if (g.depth[p] <= 0) continue;
      ctx.moveTo(X(i), Y(j));
      ctx.lineTo(X(i + 3 * g.dirX[p]), Y(j + 3 * g.dirY[p]));
    }
  ctx.stroke();
  // Where each size first breaks.
  ['#5cd65c', '#ffe066', '#ff4d4d'].forEach((c, size) => {
    ctx.fillStyle = c;
    for (let p = 0; p < g.nx * g.ny; p++) {
      const run = g.since[size][p];
      if (run > 0 && run <= g.step * 1.5 && g.foam[size][p] > 0.99) ctx.fillRect(X(p % g.nx) - 1.5 / px, Y((p / g.nx) | 0) - 1.5 / px, 3 / px, 3 / px);
    }
  });
  ctx.restore();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(8, h - 120, 330, 52);
  ctx.fillStyle = '#fff';
  ctx.font = '12px system-ui';
  ctx.fillText(`bars ${s.bars.length}, rips ${s.rips.length}, reefs ${s.reefs.length}; ${s.height.toFixed(1)} m, ${s.period.toFixed(1)} s`, 16, h - 100);
  ctx.fillText(`grid ${g.nx}x${g.ny}, built in ${ms.toFixed(0)} ms`, 16, h - 82);
}
