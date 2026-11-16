// The stream scene's JavaScript side: where its boulders and the hollows in its bed lie, its
// current and depth (the same maths as flow() and the depth in stream.glsl: change one, change
// the other), and the bubbles riding that current, on the surface and under it, and the leaves
// floating on it. Positions are in
// cells (CELL CSS px each), y up from the window's bottom edge, as in the shader.

export const MAX_STONES = 32; // matches stream.glsl
export const MAX_POOLS = 16; // matches stream.glsl
export const CURRENT = 0.35 * (1 + 0.5 * Math.random()); // cells per second, 0-50% faster on some visits; the shader's u_current
const ALPHA = 0.8; // how much each boulder blocks the current; matches stream.glsl

export type Stones = { data: Float32Array; count: number; w?: number; h?: number }; // x, y, radius, seed per boulder; the area they're spread over, in cells

// Boulders spread at random over the whole screen (so resizing the window never moves them),
// kept apart, in a range of sizes (about 65-165 CSS px across).
export function placeStones(cell: number): Stones {
  const data = new Float32Array(MAX_STONES * 4);
  let count = 0;
  const w = Math.max(screen.width, window.innerWidth) / cell;
  const h = Math.max(screen.height, window.innerHeight) / cell;
  const want = Math.min(MAX_STONES, Math.round((w * h) / 2.5));
  for (let i = 0; i < 1000 && count < want; i++) {
    const r = 0.3 + 0.45 * Math.random() ** 2;
    const x = Math.random() * w;
    const y = Math.random() * h;
    let clear = true;
    for (let j = 0; j < count && clear; j++) clear = Math.hypot(x - data[4 * j], y - data[4 * j + 1]) > 1.8 * (r + data[4 * j + 2]);
    if (clear) data.set([x, y, r, Math.random() * 100], 4 * count++);
  }
  return { data, count };
}

// For the fish (fish.ts), kept up to date by scene.ts, all in CSS px with y down: the
// water's velocity at a point on screen (px per second), how much the stream is showing (0-1),
// its boulders, which way it runs (a unit vector), and its usual speed (px per second). And how much
// the pond and the beach are showing (0-1), for the koi and the beach's fish; how deep the beach's
// water is at a point (m) and how far its waves lift what's under them there (px), so its fish keep
// to the sea and are seen through the waves; the caustics to paint onto the fish (glints); and the
// reef's coral colonies, for its damselfish. `generation` counts rerolls of the random layout, when
// the fish are made again too.
type Point = { x: number; y: number };
export const water: { at?: (x: number, y: number) => [number, number]; depth?: (x: number, y: number) => number; lift?: (x: number, y: number) => number; glints?: ImageBitmap | HTMLCanvasElement; colonies?: (Point & { r: number })[]; share: number; pond: number; beach: number; rocks: (Point & { r: number })[]; downstream: Point; speed: number; generation: number } = {
  share: 0,
  generation: 0,
  pond: 0,
  beach: 0,
  speed: 1,
  rocks: [],
  downstream: { x: 0, y: 0 },
};

// Hollows (deeper, amount > 0) and rises (shallower, < 0) in the bed: broad smooth bumps spread
// over the whole screen, like the boulders. x, y, radius (260-660 CSS px), amount.
export function placePools(cell: number): Stones {
  const data = new Float32Array(MAX_POOLS * 4);
  const w = Math.max(screen.width, window.innerWidth) / cell;
  const h = Math.max(screen.height, window.innerHeight) / cell;
  const count = Math.min(MAX_POOLS, Math.round((w * h) / 3));
  for (let i = 0; i < count; i++) data.set([Math.random() * w, Math.random() * h, 1.2 + 1.8 * Math.random(), 1.1 * (Math.random() - 0.5)], 4 * i);
  return { data, count, w, h };
}

// depth() is the costliest part of flow(), which the bubbles and fish ask for a few thousand
// times a frame; but the bed never changes, so depthFast() reads it back from a grid sampled
// once, a tenth of a cell apart (bilinearly, so it stays smooth), and works it out in full only
// off the grid.
const GRID = 0.1;
const grids = new WeakMap<Stones, { w: number; h: number; d: Float32Array }>();
export function depthFast(stones: Stones, pools: Stones, x: number, y: number): number {
  let g = grids.get(pools);
  if (!g) {
    const w = Math.ceil((pools.w ?? 0) / GRID) + 2;
    const h = Math.ceil((pools.h ?? 0) / GRID) + 2;
    const d = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) d[j * w + i] = depth(stones, pools, i * GRID, j * GRID);
    grids.set(pools, (g = { w, h, d }));
  }
  const gx = x / GRID;
  const gy = y / GRID;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  if (i < 0 || j < 0 || i >= g.w - 1 || j >= g.h - 1) return depth(stones, pools, x, y);
  const fx = gx - i;
  const fy = gy - j;
  const at = (a: number, b: number) => g.d[(j + b) * g.w + i + a];
  return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
}

// GLSL's smoothstep, including the reversed-edge use the shader makes of it.
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Shallow water runs faster and deep water slower: the same as pace() in stream.glsl.
const pace = (depth: number) => 1 / (0.88 + 0.2 * depth);

// The water's velocity at (x, y) at time t (s), in cells per second, heading along `dir`.
// See flow() in stream.glsl for what each part is: this is the same, term for term.
export function flow(stones: Stones, pools: Stones, dir: [number, number], x: number, y: number, t: number): [number, number] {
  const [dx, dy] = dir;
  let along = CURRENT;
  let across = 0;
  for (let i = 0; i < stones.count; i++) {
    const s = stones.data;
    const sx = s[4 * i];
    const sy = s[4 * i + 1];
    const R = s[4 * i + 2];
    const seed = s[4 * i + 3];
    const qx = (x - sx) * dx + (y - sy) * dy;
    const qy = -(x - sx) * dy + (y - sy) * dx;
    if (qx < -5 * R || qx > 12 * R || Math.abs(qy) > 5 * R) continue;
    // Around it.
    const s2 = qx * qx + qy * qy;
    const R2 = R * R;
    const den = s2 * s2 + R2 * R2;
    const f = R2 / Math.sqrt(den);
    const df = (-R2 * s2) / (den * Math.sqrt(den));
    let ba = -ALPHA * CURRENT * (f + 2 * qy * qy * df);
    let bc = ALPHA * CURRENT * 2 * qx * qy * df;
    // The wake.
    const w = 1.2 * R;
    const t0 = Math.min(1, Math.max(0, (qx - 0.3 * R) / (2 * R)));
    const rise = t0 * t0 * (3 - 2 * t0);
    const decay = Math.exp(-qx / (4 * R));
    const g = 0.6 * rise * decay;
    const dg = 0.6 * decay * ((6 * t0 * (1 - t0)) / (2 * R) - rise / (4 * R));
    const th = Math.tanh(qy / w);
    ba -= CURRENT * g * (1 - th * th);
    bc += CURRENT * dg * w * th;
    // Eddies.
    const T = (6 * R) / CURRENT;
    const phase = t / T + seed;
    for (let e = 0; e < 2; e++) {
      const n = Math.floor(phase) - e;
      const age = (phase - n) * T;
      const side = 2 * (((n % 2) + 2) % 2) - 1;
      const ex = qx - (1.1 * R + 0.7 * CURRENT * age);
      const ey = qy - 0.45 * R * side;
      const core = 0.6 * R + 0.1 * age;
      const spin = -side * 1.6 * CURRENT * R * Math.exp(-age / (1.5 * T)) * smoothstep(0, 0.3 * T, age) * smoothstep(2 * T, 1.6 * T, age);
      const d2 = ex * ex + ey * ey + 1e-5;
      const fe = (spin / 6.2831 / d2) * (1 - Math.exp(-d2 / (core * core)));
      ba -= ey * fe;
      bc += ex * fe;
    }
    const win = (1 - smoothstep(3.5 * R, 5 * R, -qx)) * (1 - smoothstep(9 * R, 12 * R, qx)) * (1 - smoothstep(3.5 * R, 5 * R, Math.abs(qy)));
    along += ba * win;
    across += bc * win;
  }
  const k = pace(depthFast(stones, pools, x, y));
  return [(dx * along - dy * across) * k, (dy * along + dx * across) * k];
}

// How deep the water is at (x, y), 0 shallow to 1 deep: the same as in stream.glsl's shade().
export function depth(stones: Stones, pools: Stones, x: number, y: number): number {
  let d = 0.6;
  for (let i = 0; i < pools.count; i++) {
    const r = pools.data[4 * i + 2];
    d += pools.data[4 * i + 3] * Math.exp(-((x - pools.data[4 * i]) ** 2 + (y - pools.data[4 * i + 1]) ** 2) / (r * r));
  }
  for (let i = 0; i < stones.count; i++) {
    const R = stones.data[4 * i + 2];
    d -= 0.6 * Math.exp((-0.25 * ((x - stones.data[4 * i]) ** 2 + (y - stones.data[4 * i + 1]) ** 2)) / (R * R));
  }
  return smoothstep(0.1, 0.9, d);
}

// How hard the water is spinning at (x, y) at time t (its vorticity, anticlockwise > 0), per
// second: high in the eddies and the shear beside and behind each boulder, ~0 in the open current.
function curl(stones: Stones, pools: Stones, dir: [number, number], x: number, y: number, t: number): number {
  const h = 0.05;
  const dvdx = flow(stones, pools, dir, x + h, y, t)[1] - flow(stones, pools, dir, x - h, y, t)[1];
  const dudy = flow(stones, pools, dir, x, y + h, t)[0] - flow(stones, pools, dir, x, y - h, t)[0];
  return (dvdx - dudy) / (2 * h);
}

// Bubbles carried by the current, each living a few seconds, growing in and shrinking away, then
// turning up again somewhere else: mostly where the water is turbulent, a few anywhere.
// - On the surface: near-white, their shadows on the bed further off where the water is deeper.
// - Under water: churned up even more strictly where it's turbulent. They float
//   up slowly but the current stirs them down again, harder where it runs faster, and they drift
//   slower the nearer the bed they are. The deeper they are, the bluer, fainter and smaller they
//   look, and the closer their shadow sits under them; they pop when they reach the surface.
// And maple leaves, twenty-odd on a desktop screen, red through orange and yellow to green:
// carried by the current, turning with the water's spin (half its vorticity, as anything small
// afloat does) plus a slow turn of their own. Each drifts in over the upstream edge and goes off
// the downstream one, and a new one comes in. They go on their own canvas (`below`), under the
// foam but over the fish.
export function bubbles(canvas: HTMLCanvasElement, below: HTMLCanvasElement, stones: Stones, pools: Stones, dir: [number, number], cell: number) {
  const ctx = canvas.getContext('2d')!;
  const lctx = below.getContext('2d')!;
  const area = window.innerWidth * window.innerHeight;
  const top = Math.min(1200, Math.round(area / 3000)); // the first `top` are on the surface
  const n = top + Math.min(800, Math.round(area / 5000));
  const [x, y, z, age, life, size, rate, phase] = Array.from({ length: 8 }, () => new Float32Array(n));
  const spawn = (i: number, t: number, start = 0) => {
    const w = window.innerWidth / cell;
    const h = window.innerHeight / cell;
    // Try spots at random, keeping one with a chance that grows with how much harder than usual
    // the water spins there (about a quarter of a boulder field passes 0.5/s, and 1.1/s is a sure
    // thing); calm water still gets a few (`calm`).
    const calm = i < top ? 0.2 : 0.05;
    for (let k = 0; k < 8; k++) {
      x[i] = Math.random() * w;
      y[i] = Math.random() * h;
      if (Math.random() < calm + 1.2 * Math.max(0, Math.abs(curl(stones, pools, dir, x[i], y[i], t)) - 0.3)) break;
    }
    life[i] = 4 + 6 * Math.random();
    age[i] = start * life[i];
    size[i] = 1.6 + 3 * Math.random() ** 2; // radius, CSS px: mostly small
    z[i] = 0; // depth below the surface, as a fraction of the water's depth there
    if (i < top) return;
    life[i] += 4;
    z[i] = 0.3 + 0.6 * Math.random();
    rate[i] = 0.3 + 0.5 * Math.random(); // how quickly the churn turns it over
    phase[i] = Math.random() * 6.283;
  };
  for (let i = 0; i < n; i++) spawn(i, performance.now() / 1000, Math.random()); // already mid-life, so they don't all pop in together

  const leaves = Array.from({ length: Math.max(3, Math.round(area / 60000)) }, () => ({ x: 0, y: 0, turn: 0, spin: 0, size: 0, hue: 0, sat: 0, light: 0, path: new Path2D(), shown: new Path2D(), shadow: [0, 0] }));
  const EDGE = 0.12; // cells: how far off screen a leaf comes in (it leaves a little further off)
  const place = (l: (typeof leaves)[number], anywhere: boolean) => {
    const w = window.innerWidth / cell;
    const h = window.innerHeight / cell;
    l.x = Math.random() * w;
    l.y = Math.random() * h;
    if (!anywhere) {
      // Back upstream from a random spot to just past the edge it would have come in over, so
      // they come in spread evenly across the current.
      const [dx, dy] = dir;
      const back = Math.min(dx > 0 ? l.x / dx : dx < 0 ? (l.x - w) / dx : Infinity, dy > 0 ? l.y / dy : dy < 0 ? (l.y - h) / dy : Infinity) + EDGE;
      l.x -= dx * back;
      l.y -= dy * back;
    }
    l.turn = Math.random() * 6.283;
    l.spin = 0.3 * (Math.random() - 0.5); // radians per second
    l.size = 17 + 8 * Math.random(); // CSS px per unit of mapleLeaf(): about 27-40 px across
    l.hue = 4 + 76 * Math.random() ** 1.6; // mostly reds and oranges, fewer yellows, a few olive greens
    l.sat = 50 + 12 * Math.random();
    l.light = 43 + 10 * Math.random();
    l.path = mapleLeaf();
  };
  for (const l of leaves) place(l, true);
  let dpr = 1;
  let shown = true; // anything drawn: once the scene's gone, they're cleared once, then left alone

  return {
    resize() {
      shown = true;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const c of [ctx, lctx]) {
        c.canvas.width = window.innerWidth * dpr;
        c.canvas.height = window.innerHeight * dpr;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    },
    // t: seconds, as the shader's u_time; dt: seconds since the last draw (0 to just redraw).
    draw(t: number, dt: number, weight: number, day: number) {
      if (shown) {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        lctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
      shown = weight >= 0.003;
      ctx.canvas.style.visibility = lctx.canvas.style.visibility = shown ? '' : 'hidden'; // hidden, an idle canvas costs nothing
      if (!shown) return;
      const w = window.innerWidth / cell;
      const h = window.innerHeight / cell;
      const shadows = new Path2D();
      const surface = new Path2D();
      const under = [new Path2D(), new Path2D(), new Path2D()]; // shallow, mid, deep
      for (let i = 0; i < n; i++) {
        age[i] += dt;
        if (age[i] > life[i] || z[i] < 0 || x[i] < -0.1 || x[i] > w + 0.1 || y[i] < -0.1 || y[i] > h + 0.1) spawn(i, t);
        if (dt) {
          // A midpoint step, so they follow the eddies round instead of spiralling out of them.
          const [ax, ay] = flow(stones, pools, dir, x[i], y[i], t);
          const [bx, by] = flow(stones, pools, dir, x[i] + (ax * dt) / 2, y[i] + (ay * dt) / 2, t);
          const pace = 1 - 0.45 * z[i] * z[i]; // slower towards the bed
          x[i] += bx * dt * pace;
          y[i] += by * dt * pace;
          if (i >= top) {
            const churn = Math.sin(t * rate[i] + phase[i]) + 0.5 * Math.sin(t * rate[i] * 2.3 + phase[i] * 1.7);
            z[i] = Math.min(1, z[i] + (0.1 * (Math.hypot(bx, by) / CURRENT) * churn - 0.06) * dt);
          }
        }
        const r = size[i] * (1 - 0.35 * z[i]) * Math.min(1, age[i] / 0.6, (life[i] - age[i]) / 0.6);
        if (r <= 0.1) continue;
        const sx = x[i] * cell;
        const sy = window.innerHeight - y[i] * cell;
        // Its shadow, down and to the right like the boulders', further off the higher above the bed.
        const lift = (1 - z[i]) * depthFast(stones, pools, x[i], y[i]);
        shadows.moveTo(sx + 2 + 8 * lift + r, sy + 3 + 11 * lift);
        shadows.arc(sx + 2 + 8 * lift, sy + 3 + 11 * lift, r, 0, Math.PI * 2);
        const path = i < top ? surface : under[Math.max(0, Math.min(2, Math.floor(z[i] * 3)))]; // (it pops next frame if it just rose past 0)
        path.moveTo(sx + r, sy);
        path.arc(sx, sy, r, 0, Math.PI * 2);
      }
      for (const l of leaves) {
        if (l.x < -2 * EDGE || l.x > w + 2 * EDGE || l.y < -2 * EDGE || l.y > h + 2 * EDGE) place(l, false);
        if (dt) {
          const [ax, ay] = flow(stones, pools, dir, l.x, l.y, t);
          const [bx, by] = flow(stones, pools, dir, l.x + (ax * dt) / 2, l.y + (ay * dt) / 2, t);
          l.x += bx * dt;
          l.y += by * dt;
          l.turn += (0.5 * curl(stones, pools, dir, l.x, l.y, t) + l.spin) * dt;
        }
        // Up on the surface, its shadow falls a little further off than the fish's.
        const lift = depthFast(stones, pools, l.x, l.y);
        l.shadow = [10 + 35 * lift, 14 + 49 * lift];
        l.shown = new Path2D();
        l.shown.addPath(l.path, new DOMMatrix().translate(l.x * cell, window.innerHeight - l.y * cell).rotate((-l.turn * 180) / Math.PI).scale(l.size));
      }
      ctx.globalAlpha = weight * 0.25;
      ctx.fillStyle = 'rgb(15, 35, 45)';
      ctx.fill(shadows);
      // Near-white by day, a dim moonlit blue-grey at night; under water, bluer and fainter with depth.
      const white = [140 + 115 * day, 165 + 90 * day, 190 + 65 * day];
      const blue = [50 + 30 * day, 90 + 70 * day, 140 + 75 * day];
      const alpha = weight * (0.55 + 0.35 * day);
      for (let band = 2; band >= 0; band--) {
        const k = 0.35 + 0.65 * ((band + 0.5) / 3);
        ctx.globalAlpha = alpha * (1 - 0.3 * k);
        ctx.fillStyle = `rgb(${white.map((c, j) => c + (blue[j] - c) * k).join()})`;
        ctx.fill(under[band]);
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${white.join()})`;
      ctx.fill(surface);
      // The leaves, darker and duller at night, each with a soft shadow (whose offset and blur
      // ignore the canvas's scale, hence dpr).
      lctx.globalAlpha = weight;
      lctx.shadowColor = 'rgba(10, 30, 40, 0.4)';
      lctx.shadowBlur = 4 * dpr;
      for (const l of leaves) {
        lctx.shadowOffsetX = l.shadow[0] * dpr;
        lctx.shadowOffsetY = l.shadow[1] * dpr;
        lctx.fillStyle = `hsl(${l.hue} ${l.sat * (0.55 + 0.45 * day)}% ${l.light * (0.45 + 0.55 * day)}%)`;
        lctx.fill(l.shown);
      }
    },
  };
}

// A flat maple leaf, about 1.6 units across and centred on (0, 0), stem down: five plain pointed
// lobes, every leaf a little different.
function mapleLeaf(): Path2D {
  const p = new Path2D();
  const jig = (k: number) => 1 + k * (Math.random() - 0.5);
  const to = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    p.lineTo(r * Math.sin(a), 0.35 - r * Math.cos(a)); // degrees clockwise from the top
  };
  p.moveTo(-0.03, 0.47);
  to(-168, 0.12);
  [-120, -60, 0, 60, 120].forEach((deg, k) => {
    const a = deg + 8 * (Math.random() - 0.5);
    const L = [0.62, 0.9, 1, 0.9, 0.62][k] * jig(0.16);
    if (k) to(deg - 30, 0.46 * jig(0.2)); // the cut between this lobe and the last
    to(a - 20, 0.68 * L);
    to(a, L);
    to(a + 20, 0.68 * L);
  });
  to(168, 0.12);
  p.lineTo(0.03, 0.47);
  p.lineTo(0.015, 0.97); // the stem
  p.lineTo(-0.015, 0.97);
  p.closePath();
  return p;
}
