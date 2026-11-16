// Beach (and reef): particles in the water, riding the swell (the water itself is beach.glsl, or
// ocean.glsl), on their own canvases. Both read the surf worked out from the seabed (surf.ts), which
// for the beach this builds, once per layout and size, for scene.ts to hand the shader too.
import { buildSurf, drawSurfDebug, seabed, surfAt, LIFT, LIP, TILT, WORLD_H, type Surf, type SurfGrid, type Swell } from './surf';
import { blobs } from './goo';

const TAU = Math.PI * 2;
const GAP = 13; // px between particles' spots at rest (on a screen 800 px tall)
const DRIFT = 0.6; // m/s they drift shorewards
// The layers at each spot: how far down they are (m, drawn), how much of the surface's loop they go
// round (water's loops shrink with depth), and their looks: radius (px at the bottom and top of
// their loop), opacity (likewise), and four light tints by day (each spot takes one): white, aqua,
// pale blue and seafoam. Light, so that wherever they are they're a lighter fleck of the water
// there, never a darker one: the deeper the fainter. By night each is moonlit (NIGHT).
const LAYERS = [
  { down: 0, loop: 1, r: [1.0, 3.8], a: [0.16, 0.9], tints: [[246, 252, 252], [220, 248, 244], [226, 238, 252], [238, 252, 232]] },
  { down: 1.2, loop: 0.62, r: [0.9, 1.9], a: [0.08, 0.32], tints: [[226, 246, 244], [208, 240, 240], [220, 236, 250], [226, 248, 232]] },
  { down: 2.4, loop: 0.38, r: [0.8, 1.4], a: [0.05, 0.18], tints: [[210, 240, 238], [196, 234, 236], [206, 228, 244], [212, 242, 224]] },
];
const NIGHT = [0.5, 0.6, 0.68];
const BINS = 8; // opacity steps each layer is drawn in: fine enough not to see
const SPRAY = 0.95; // s a droplet of spray flies
const fract = (x: number) => x - Math.floor(x);

// The particles, after the CodePen this scene began from: at each spot, one in each layer of the
// water, each going round its loop as the waves pass (forward over a crest, back through the trough:
// a trochoid), the surface's loops about half the wave's drawn height across so neighbouring ones
// overlap, the deeper ones smaller and fainter, lifted less by the 3/4 tilt so they slide against
// the surface's; in shallow water the loops flatten into long ellipses. Each grows and brightens
// smoothly towards the top of its loop. All drift slowly shorewards.
// - Out where the waves are a long way from breaking, the surface's are faint and small: flecks
//   taking the colour of the water they're over. They whiten and grow as a wave nears breaking.
// - Once it has broken the foam shader carries the white water, so they're fewer and smaller: a
//   sparse bubble or two in the white water, and less of them elsewhere.
// - Where it has just broken, each crest as it passes throws out spray: small droplets, as many as
//   the break is strong (a big wave, plunging, just broken: up to eight from each spot; a small one
//   spilling, two or three), flung out hard, fanning out about the way the wave runs, arcing up and
//   falling back (seen through the tilt) over SPRAY s, faster and higher the stronger it is. As a
//   plunging lip throws, the surface's at its crest are flung ahead with it.
// The surface's are drawn on their own canvas, `goo`, and fused (goo.ts) where they bunch up (on the
// crests near breaking) into blobs of foam on `fused`, beneath it; the deeper ones, the spray and the
// brightest surface ones' hard shadows on `canvas` beneath that.
// With `debug` (newtab.html?scene=beach&flow) it draws the surf model instead.
// `source`: the beach's layout, to build its grid from, or a function handing over a grid built
// elsewhere (the reef's: scene.ts), as it is when the particles are drawn. `tilt`: how far a
// height lifts things up the screen (the beach's 3/4 view; 0 seen straight down, as the reef is).
export function spray(canvas: HTMLCanvasElement, goo: HTMLCanvasElement, fused: HTMLCanvasElement, surf: Swell, source: Surf | (() => SurfGrid | null), tilt = TILT, debug = false) {
  const ctx = canvas.getContext('2d')!;
  const gtx = goo.getContext('2d')!;
  const foam = blobs(fused);
  let w = 0;
  let h = 0;
  let u = 1; // the screen's height over 800 px
  // Spots at rest, in the beach's frame (m): along the shore, towards it; a size; where the deeper
  // layers sit about it (m), so they don't stack exactly under the surface's; a tint; and a seed.
  let spots: { u: number; v: number; r: number; jx: number; jy: number; tint: number; seed: number }[] = [];
  let grid: SurfGrid | null = null;
  let built = 0; // ms the grid took
  // Where the rocks standing out of the water hide what's behind them (beach.glsl's ROCK_PASS, read
  // back by scene.ts): alpha, a row of `w` px at a time from the bottom of the window.
  let rocks: { w: number; data: Uint8Array } | null = null;
  let shown = true; // anything drawn: once the scene's gone, they're cleared once, then left alone and hidden (costing nothing)
  const hidden = (x: number, y: number) => {
    if (!rocks || x < 0 || x >= rocks.w || y < 0 || y >= h) return false;
    return rocks.data[(Math.floor(h - y) * rocks.w + Math.floor(x)) * 4 + 3] > 127;
  };
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (grid && w === window.innerWidth && h === window.innerHeight) return;
    w = window.innerWidth;
    h = window.innerHeight;
    u = h / 800;
    for (const [c, x] of [
      [canvas, ctx],
      [goo, gtx],
    ] as const) {
      c.width = w * dpr;
      c.height = h * dpr;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    foam?.resize(w, h, dpr);
    shown = true;
    if (typeof source === 'function') return; // the grid comes with the next draw
    const start = performance.now();
    grid = buildSurf(surf, w, h, (f, u, v) => seabed(source, f, u, v));
    built = performance.now() - start;
    place(grid);
  };
  // Their spots over the screen, for the grid g.
  const place = (g: SurfGrid) => {
    const { umin, umax, vmin, vmax } = g.frame;
    const gap = (GAP * u * WORLD_H) / h; // m
    spots = [];
    for (let v = vmin - 6; v < vmax + 6; v += gap)
      for (let s = umin - 6; s < umax + 6; s += gap)
        spots.push({
          u: s + (Math.random() - 0.5) * gap * 0.8,
          v: v + (Math.random() - 0.5) * gap * 0.8,
          r: 0.85 + 0.3 * Math.random(),
          jx: (Math.random() - 0.5) * gap,
          jy: (Math.random() - 0.5) * gap,
          tint: Math.floor(Math.random() * 4),
          seed: Math.random() * 100,
        });
  };
  resize();
  return {
    resize,
    get grid() {
      return grid!;
    },
    set rocks(r: { w: number; data: Uint8Array } | null) {
      rocks = r;
    },
    draw(t: number, weight: number, day: number) {
      if (shown) {
        ctx.clearRect(0, 0, w, h);
        gtx.clearRect(0, 0, w, h);
        foam?.clear();
      }
      shown = weight >= 0.003;
      canvas.style.visibility = goo.style.visibility = fused.style.visibility = shown ? '' : 'hidden';
      if (!shown) return;
      if (typeof source === 'function' && source() !== grid) {
        grid = source();
        if (grid) place(grid);
      }
      if (!grid) return;
      if (debug && typeof source !== 'function') return drawSurfDebug(ctx, grid, source, t, h, built);
      const px = h / WORLD_H; // px per m
      const { cx, cy, n, t: along, vmin, vmax } = grid.frame;
      const span = vmax - vmin + 12;
      // A path for each layer, tint and step of opacity; and for the white water's bubbles, the
      // spray (young and old) and shadows.
      const bins = LAYERS.map(() => Array.from({ length: 4 * BINS }, () => new Path2D()));
      const bubbles = new Path2D();
      const drops = [new Path2D(), new Path2D()];
      const shadow = new Path2D();
      const dot = (path: Path2D, x: number, y: number, r: number) => {
        path.moveTo(x + r, y);
        path.arc(x, y, r, 0, TAU);
      };
      for (const p of spots) {
        const v = ((((p.v - vmin + 6 + DRIFT * t) % span) + span) % span) + vmin - 6; // drifting in, wrapping round off screen
        const sx = cx + p.u * along[0] + v * n[0];
        const sy = cy + p.u * along[1] + v * n[1];
        if (sx * px < -30 || sx * px > w + 30 || sy * px < -40 || sy * px > h + 30) continue;
        const a = surfAt(grid, surf, sx, sy, t);
        if (a.d < 0.05) continue; // up the beach
        const top = 0.5 + 0.5 * Math.cos(a.th); // 1 at the top of its loop, 0 at the bottom
        const shallow = 1 - Math.min(1, Math.max(0, (a.d - 0.6) / 4.4));
        const loop = 0.55 * 0.5 * LIFT * a.H; // m: the surface's loop's radius
        const across = 1 + 0.6 * shallow; // flattened in shallow water: longer...
        const upright = 1 - 0.5 * shallow; // ... and lower
        const broken = a.run > 0.5 ? Math.min(1, a.foam) : 0;
        const plunge = Math.min(1, Math.max(0, (a.xi - 0.35) / 0.3));
        // Spray, where the wave has just broken, flung out as each crest passes.
        if (broken > 0.5 && a.run < 1.6 * LIP && a.th >= 0) {
          const age = (a.th / TAU) * surf.period; // s since the crest passed here
          if (age < SPRAY) {
            // How hard it's breaking: by its height, how it breaks and how fresh the break is.
            const strength = Math.min(1.5, a.H / 1.2) * (0.5 + 0.5 * plunge) * (1 - (0.6 * a.run) / (1.6 * LIP));
            const hard = 0.85 + 0.25 * strength;
            for (let k = 0; k < Math.min(8, Math.round(2 + 4.5 * strength)); k++) {
              const r1 = fract(Math.sin(p.seed + k * 3.31) * 43758.5453);
              const r2 = fract(Math.sin(p.seed * 1.7 + k * 1.37) * 24634.6345);
              const r3 = fract(Math.sin(p.seed * 2.3 + k * 2.71) * 37717.2312);
              const turn = (r1 - 0.5) * 2.2; // radians off the way the wave runs
              const dx = a.dirX * Math.cos(turn) - a.dirY * Math.sin(turn);
              const dy = a.dirX * Math.sin(turn) + a.dirY * Math.cos(turn);
              const speed = (3.5 + 8.5 * r2) * (0.5 + a.H) * hard; // m/s, faster than the wave
              const z = Math.max(0, (2.5 + 5 * r3) * hard * age - 4.9 * age * age) * 0.5 * LIFT; // m up, drawn
              const x = (sx + dx * speed * age) * px;
              const y = (sy + dy * speed * age - tilt * (a.z + z)) * px;
              dot(drops[age < 0.4 * SPRAY ? 0 : 1], x, y, (0.8 + 0.6 * r3) * (0.92 + 0.12 * strength) * u * (1 - (0.5 * age) / SPRAY));
            }
          }
        }
        if (broken > 0.5 && a.th > -0.25 && a.th < 2.8) {
          // In the white water: now and then a small bubble carried along in it.
          if (p.tint) continue;
          const fx = sx + a.dirX * 0.4 * loop * Math.sin(a.th);
          const fy = sy + a.dirY * 0.4 * loop * Math.sin(a.th) - tilt * a.z;
          if (!hidden(fx * px, fy * px)) dot(bubbles, fx * px, fy * px, (0.8 + 0.6 * p.r) * u);
          continue;
        }
        // Flung ahead with a plunging lip, if it's on the crest as it throws.
        const throwing = a.run > 0.5 ? 1 - Math.min(1, Math.max(0, (a.run - 0.7 * LIP) / (0.3 * LIP))) : 0;
        const flung = plunge * throwing * Math.max(0, 1 + a.th / 0.8) * (a.th < 0 ? 1 : 0) * 0.35 * a.run;
        // How much of the surface's shows: barely there out where the waves are a long way from
        // breaking (their height a small part of the depth), fading in as they build towards it,
        // full white near it, less once broken. The deeper ones fade out there too, by half.
        const ratio = a.H / Math.max(0.78 * a.d, 0.05);
        const far = Math.min(1, ratio / 0.5); // 0 far out, 1 where they start to build
        const near = Math.min(1, Math.max(0, (ratio - 0.5) / 0.45));
        const white = broken ? 1 : near * near * (3 - 2 * near);
        const show = (0.05 + 0.2 * far + 0.75 * white) * (1 - 0.6 * broken);
        LAYERS.forEach((l, i) => {
          const r = l.loop * loop;
          const ahead = r * across * Math.sin(a.th) + (i ? 0 : flung);
          const lift = i ? l.loop * upright * a.z - l.down : a.z; // the surface ones ride the surface
          const x = (sx + (i ? p.jx : 0) + a.dirX * ahead) * px;
          const y = (sy + (i ? p.jy : 0) + a.dirY * ahead - tilt * lift) * px;
          const alpha = (l.a[0] + (l.a[1] - l.a[0]) * top) * (i ? 0.5 + 0.5 * far : show);
          const radius = (l.r[0] + (l.r[1] - l.r[0]) * top) * p.r * u * (i ? 1 : (0.65 + 0.35 * white) * (1 - 0.4 * broken));
          if (hidden(x, y)) return; // behind a rock
          dot(bins[i][p.tint * BINS + Math.min(BINS - 1, Math.floor(alpha * BINS))], x, y, radius);
          if (!i && alpha > 0.6) dot(shadow, x + 3 * u + a.z * px * 0.25, y + 5 * u + a.z * px * 0.4, radius);
        });
      }
      const rgb = (c: number[]) => c.map((d, k) => Math.round(d * (NIGHT[k] + (1 - NIGHT[k]) * day))).join(',');
      ctx.fillStyle = `rgba(0, 25, 40, ${0.14 * weight})`;
      ctx.fill(shadow);
      // The surface's, and the bubbles, on `goo` and to be fused.
      const onGoo = (style: string, path: Path2D) => {
        for (const x of foam ? [gtx, foam.ctx] : [gtx]) {
          x.fillStyle = style;
          x.fill(path);
        }
      };
      // Deepest first, so the surface's are drawn over them (on their own canvas, over this one).
      for (let i = LAYERS.length - 1; i >= 0; i--) {
        bins[i].forEach((path, b) => {
          const style = `rgba(${rgb(LAYERS[i].tints[Math.floor(b / BINS)])}, ${(((b % BINS) + 0.5) / BINS) * weight})`;
          if (i) {
            ctx.fillStyle = style;
            ctx.fill(path);
          } else onGoo(style, path);
        });
      }
      const white = rgb(LAYERS[0].tints[0]);
      onGoo(`rgba(${white}, ${0.7 * weight})`, bubbles);
      foam?.draw();
      [0.95, 0.55].forEach((alpha, k) => {
        ctx.fillStyle = `rgba(${white}, ${alpha * weight})`;
        ctx.fill(drops[k]);
      });
    },
  };
}
