// The fish: a reef school of small fish with a couple of larger predators chasing them, and clouds of
// damselfish living about its coral; salmon in the stream; koi in the pond; and on the beach the reef's
// school again, keeping to the sea. Each school swims (and shows, fading) only while its scene does
// (water.stream, water.pond and water.beach, from scene.ts); all of them feel the current where there
// is one (water.current). Everything swims away from the cursor. A
// still frame for reduced motion. On the [data-boids] canvas in `root` (index.ts makes it), from
// startFish() (after startWater()), till `signal` aborts.
import { water } from './stream';
import { quality } from './quality';
import { stage } from './stage';

type V = { x: number; y: number };
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const mag = (v: V) => Math.hypot(v.x, v.y);
const add = (a: V, b: V, k = 1): V => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k });
const lerp = (a: V, b: V, t: number): V => ({ x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t });
const norm = (v: V): V => {
  const m = mag(v) || 1;
  return { x: v.x / m, y: v.y / m };
};
const ortho = (v: V) => norm({ x: -v.y, y: v.x });
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y;
const rotate = (v: V, a: number): V => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

const FISH_BODY = [0.2, 0.5, 0.8, 0.9, 0.7, 0.5, 0.3, 0.1];
const SALMON_BODY = [0.16, 0.34, 0.52, 0.68, 0.82, 0.94, 1, 0.97, 0.88, 0.72, 0.56, 0.42, 0.3]; // a long, tapering snout
const SALMON_NECK = 4; // segments before this are its (green, rigid) head
const KOI_BODY = [0.3, 0.62, 0.8, 0.92, 0.98, 1, 0.97, 0.9, 0.78, 0.64, 0.5, 0.36, 0.26]; // blunt-nosed and stout
const PREDATOR_BODY = [0.3, 0.5, 0.7, 0.9, 0.93, 0.96, 1, 0.85, 0.8, 0.75, 0.64, 0.53, 0.5, 0.4, 0.22, 0.15, 0.18, 0.13, 0.1, 0.08];
const MARGIN = 100;
const HOLD_PHASE = Math.random() * 6.283;
// Swim speed vs the original. Turning and tail wag scale with it, so paths keep their shape.
const PACE = 1.69; // 1.3 x 1.3

class Fish {
  type: 'fish' | 'predator' | 'salmon' | 'koi' | 'damsel' = 'fish';
  x: number;
  y: number;
  v: V = { x: rand(-1, 1), y: rand(-1, 1) };
  acc: V = { x: 0, y: 0 };
  heading: V;
  effort = 1; // how hard it is swimming, 1 at cruising speed
  strain = 1; // how hard it would need to swim for where it wants to go (effort, before its limit)
  rush = 1; // how fast the water around it runs, against the stream's usual speed (1 out of it)
  sway = 0; // the swimming wave's bend just past the tail, -1 to 1 (times effort)
  clock = 0; // its own swimming time, ms: see beat()
  lastNow = 0;
  // In a current it takes turns holding station over the bed and moving on, unless something
  // is after it (or it is after something): `alarmed`.
  alarmed = false;
  hold = 0; // eases to 1 while it holds station, so it settles and sets off smoothly
  phase = Math.random() * Math.PI * 2;
  speed = 1.6;
  size = (5 * Math.floor(rand(70, 100))) / 100;
  color = `rgb(${~~rand(0, 100)},${~~rand(50, 220)},${~~rand(50, 220)})`;
  finColor = '';
  body = FISH_BODY;
  sizeMult = 1;
  period = 0;
  amplitude = 0;
  eyesight = 100;
  personalSpace = 15;
  flockDistance = 1000;
  matchVelFactor = 4;
  momentum = 0.25;
  angMomentum = 0.1;
  separationScale = 0.2;
  maxAccel = 1;
  wade = 0; // in the beach scene, the least water it swims in (m): it keeps off the beach and rocks
  homed = false; // it lives about a spot of its own (the reef's residents): it doesn't wrap round the screen
  cruise = 0.45; // the least of its speed it swims at, unless resting (see think())
  glow = 2; // px its colour blurs out round its outline (costly to draw: none on the tiny ones)
  segments: V[] = [];
  shape: V[] = []; // the body as drawn: the segments themselves, unless a kind of fish says otherwise

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.heading = norm(this.v);
    this.period = ((rand(80, 120) / 100) * 50 * this.size) / 3;
    this.amplitude = ((rand(80, 120) / 100) * 3 * this.size) / 5;
  }

  // Straight out behind the head, against its heading. (Each segment keeps to the side of the one
  // before it that it starts on, so a body laid out ahead would stay folded until the head had
  // swum back through it.)
  initSegments() {
    this.segments = Array.from({ length: this.body.length }, (_, i) => sub(this, mul(this.heading, i * this.size)));
    this.shape = this.segments;
  }

  steer(target: V, scale: number, toward: boolean) {
    const k = scale * ((this.eyesight - dist(this, target)) / this.eyesight) * (toward ? 1 : -1);
    this.acc = add(this.acc, { x: (target.x - this.x) * k, y: (target.y - this.y) * k }, 1 - this.momentum);
  }

  reactTo(other: Fish) {
    if (other.type !== 'predator') return;
    this.steer(other, 1, false);
    this.alarmed = true;
  }

  think(all: Fish[], self: number, pointer: V | null, dt: number, now: number) {
    this.alarmed = false;
    // Its school, each fish counting less the further off it is (so one swimming into or out
    // of sight doesn't jolt it), and a push away from any too close that grows as they near.
    const center = { x: 0, y: 0 };
    const vel = { x: 0, y: 0 };
    let n = 0;
    for (let i = 0; i < all.length; i++) {
      if (i === self) continue;
      const o = all[i];
      const d = dist(this, o);
      if (d >= this.eyesight) continue;
      if (o.type === this.type) {
        const w = 1 - d / this.eyesight;
        center.x += o.x * w;
        center.y += o.y * w;
        vel.x += o.v.x * w;
        vel.y += o.v.y * w;
        n += w;
        const room = this.personalSpace + this.size;
        if (d < room) this.acc = add(this.acc, mul(norm(sub(this, o)), this.separationScale * room * (1 - d / room)), 1 - this.momentum);
      } else this.reactTo(o);
    }
    if (n) {
      const cohesion = { x: (center.x / n - this.x) / this.flockDistance, y: (center.y / n - this.y) / this.flockDistance };
      const alignment = { x: (vel.x / n - this.v.x) / this.matchVelFactor, y: (vel.y / n - this.v.y) / this.matchVelFactor };
      this.acc = add(this.acc, add(cohesion, alignment), 1 - this.momentum);
    }
    if (pointer && dist(pointer, this) < this.eyesight) {
      this.steer(pointer, 20, false);
      this.alarmed = true;
    }
    if (mag(this.acc) > this.maxAccel) this.acc = mul(norm(this.acc), this.maxAccel);
    const away = this.wade ? this.keepToSea() : null;
    // Steer. While it rests (holding station in a current) the school's pull on it mostly
    // lets up, so it can settle rather than being dragged about (see settle()).
    const k = (dt / (0.001 * this.size)) * (1 - 0.9 * this.hold * water.current.strength);
    this.v = { x: this.v.x + this.acc.x * k, y: this.v.y + this.acc.y * k };
    if (away) {
      // Turning (keeping its speed: a fish that brakes barely turns, see move()), the harder the
      // nearer it is.
      const speed = mag(this.v);
      const dir = speed > 1e-3 ? mul(this.v, 1 / speed) : this.heading;
      const turn = Math.atan2(dir.x * away.want.y - dir.y * away.want.x, dot(dir, away.want));
      const most = 0.25 * away.urgent;
      this.v = mul(rotate(dir, Math.max(-most, Math.min(most, turn))), Math.max(speed, 0.8 * this.speed));
    }
    const m = mag(this.v);
    if (m > this.speed) this.v = mul(this.v, this.speed / m);
    this.settle(now);
    // Turn instead of brake: unless it's resting (holding station in a current), it never slows
    // below about half its speed. When it changes its mind (the school, a predator, the cursor,
    // the end of a rest) it swings round from the way it's facing, rather than slowing through a
    // stop and setting off the other way: a fish that barely moves barely turns (see move()), so
    // it would sit there, seemingly frozen, till it had come round.
    const floor = this.cruise * this.speed * (1 - this.hold * water.current.strength);
    const now_m = mag(this.v);
    if (now_m < floor) {
      const from = this.heading;
      const want = now_m > 1e-4 ? mul(this.v, 1 / now_m) : from;
      const turn = Math.atan2(from.x * want.y - from.y * want.x, dot(from, want));
      this.v = mul(rotate(from, Math.max(-0.12, Math.min(0.12, turn))), floor);
    }
  }

  // In the beach scene: it keeps to water deep enough for it (`wade`), turning away well before the
  // shallows (up the beach and on the rocks standing out of it, too). It looks ahead along its way
  // about three turning circles' worth (further for a shark, which turns wider), and the nearer
  // and shallower the water there, the more urgently it turns: at first only to run along the
  // shore, then, nearer, out to sea. Its urge to go that way (acc, which steers it from frame to
  // frame) gives up whatever of it pointed into the shallows, so the school's pull doesn't keep
  // turning it back. The screen's edges count as shallows too, shoaling over their last few tens of
  // px (it doesn't wrap round: across the screen might be the beach). Returns which way to turn and
  // how urgently (0-1), or null if it needn't.
  keepToSea() {
    if (!water.depth) return null;
    const speed = mag(this.v);
    const dir = speed > 1e-3 ? mul(this.v, 1 / speed) : this.heading;
    const look = (3 * this.speed) / this.angMomentum;
    const near = (d: number, room: number) => {
      const k = Math.min(1, Math.max(0, 1 - (d - this.wade) / room));
      return k * k * (3 - 2 * k); // 0 with `room` m to spare, 1 at the least it swims in
    };
    let urgent = near(this.deep(this.x, this.y), 1);
    let at: V = this;
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const p = add(this, dir, t * look);
      const k = near(this.deep(p.x, p.y), 1.5) * (1.15 - 0.4 * t);
      if (k > urgent) [urgent, at] = [k, p];
    }
    if (urgent <= 0) return null;
    urgent = Math.min(1, urgent);
    const e = 12;
    const deeper = norm({ x: this.deep(at.x + e, at.y) - this.deep(at.x - e, at.y), y: this.deep(at.x, at.y + e) - this.deep(at.x, at.y - e) });
    let along = { x: -deeper.y, y: deeper.x };
    if (dot(along, dir) < 0) along = mul(along, -1);
    const want = norm(add(mul(along, 1 - urgent), mul(deeper, urgent + 0.25)));
    const into = dot(this.acc, deeper);
    if (into < 0) this.acc = add(this.acc, deeper, -into * urgent);
    this.acc = add(this.acc, want, 0.3 * this.maxAccel * urgent);
    if (mag(this.acc) > this.maxAccel) this.acc = mul(norm(this.acc), this.maxAccel);
    return { want, urgent };
  }

  // How deep the water is at (x, y) as it sees it (m), the screen's edges shoaling (keepToSea()):
  // 1 m per 30 px in from them, their corners rounded off, and blended smoothly into the real
  // depth where they meet the shore, so that in a corner the way to deeper water points out of
  // it, not along one side into the other.
  deep(x: number, y: number) {
    const [w, h, round] = [stage.w, stage.h, 150];
    const [dx, dy] = [Math.min(x, w - x), Math.min(y, h - y)];
    const edge = (dx < round && dy < round ? round - Math.hypot(round - dx, round - dy) : Math.min(dx, dy)) / 30;
    const d = water.depth!(x, y);
    const k = Math.max(1 - Math.abs(d - edge), 0); // a smooth minimum, over 1 m
    return Math.min(d, edge) - 0.25 * k * k;
  }

  // Holding station: its way over the bed drops to a tenth (the school still nudges it apart),
  // so in move() it ends up swimming nose into the current just hard enough to stay put.
  // When: a slow rhythm (~12 s each way) that nearby fish share, so a school settles and sets
  // off together. Only in a current, and never while alarmed.
  settle(now: number) {
    const holding = Math.sin(now / 4000 + this.x / 1250 + this.y / 1650 + HOLD_PHASE) > 0;
    this.hold += ((holding && !this.alarmed ? 1 : 0) - this.hold) * 0.05;
    this.v = mul(this.v, 1 - 0.9 * this.hold * water.current.strength);
  }

  // drift: how far the water carries things this step (px; none outside the stream).
  move(w: number, h: number, now: number, drift: V) {
    // It wants to go along v over the ground, but it swims through the water, so it heads partly
    // into the current to get there; it only swims so fast, so against a strong current it
    // faces upstream and still slips back. The current carries it, and its whole body, along.
    let swim = sub(mul(this.v, PACE), drift);
    this.strain = mag(swim) / (this.speed * PACE);
    this.rush += ((water.current.strength ? (mag(drift) * 60) / (water.current.speed * water.current.strength) : 1) - this.rush) * 0.1;
    const most = this.speed * PACE * 1.15;
    if (mag(swim) > most) swim = mul(norm(swim), most);
    // It turns to face the way it swims; but barely moving through the water, it barely turns
    // (so it doesn't swing round after every tiny nudge), and in a current it settles nose
    // upstream.
    const grip = Math.min(1, mag(swim) / (0.3 * this.speed * PACE));
    const face = add(mul(norm(swim), grip), mul(water.current.downstream, -(1 - grip) * water.current.strength));
    if (mag(face) > 1e-3) this.heading = norm(lerp(this.heading, norm(face), this.angMomentum * PACE * Math.max(grip, 0.3)));
    const m = mag(swim);
    this.effort = m / (this.speed * PACE);
    const from = { x: this.x, y: this.y };
    this.x += this.heading.x * m + drift.x;
    this.y += this.heading.y * m + drift.y;
    // In the beach scene the shore is a wall too, should it ever get that close (chased, say): it
    // can't swim into water too shallow to swim in, but slides along it.
    if (this.wade && water.depth && this.deep(this.x, this.y) < 0.3 && this.deep(this.x, this.y) < this.deep(from.x, from.y)) {
      const e = 6;
      const deeper = norm({ x: this.deep(from.x + e, from.y) - this.deep(from.x - e, from.y), y: this.deep(from.x, from.y + e) - this.deep(from.x, from.y - e) });
      const step = sub(this, from);
      const slide = add(step, deeper, -Math.min(0, dot(step, deeper)));
      Object.assign(this, add(from, slide));
      if (this.deep(this.x, this.y) < 0.3) Object.assign(this, from);
    }
    for (const s of this.segments) {
      s.x += drift.x;
      s.y += drift.y;
    }
    // Wrap around the edges, off screen: far enough out that none of it still shows.
    const out = MARGIN + (this.body.length + 3) * this.size;
    const jump = { x: 0, y: 0 };
    if (this.x > w + out) jump.x = -(w + 2 * out);
    else if (this.x < -out) jump.x = w + 2 * out;
    if (this.y > h + out) jump.y = -(h + 2 * out);
    else if (this.y < -out) jump.y = h + 2 * out;
    if ((jump.x || jump.y) && !this.wade && !this.homed) for (const p of [this, ...this.segments]) Object.assign(p, add(p, jump));
    this.updateSegments(now * PACE);
  }

  // Its swimming time: runs at the clock's pace at cruising effort in the stream's usual current,
  // faster the harder it has to work and the faster the water around it runs (up to 1.6x past a
  // boulder), slower as it eases off, but never below 0.7x: a fish holding its place still swims.
  // Out of a current, only effort counts.
  beat(now: number) {
    const water = 1 + 0.6 * (Math.min(this.rush, 2) - 1);
    // Each kind's tail beats at a period that goes by its size (a bigger fish's slower, more sweeping),
    // and that's the size it looks: drawn smaller on a phone, it beats faster (stage.tempo).
    if (this.lastNow) this.clock += (now - this.lastNow) * stage.tempo * Math.max(0.7, (0.35 + 0.65 * Math.min(this.strain, 2)) * water);
    this.lastNow = now;
    return this.clock;
  }

  // The body follows the head, with a swimming wiggle that grows towards the tail.
  updateSegments(now: number) {
    now = this.beat(now);
    const prev = this.segments[0];
    const effort = Math.max(this.effort, 0.65); // even holding still, it keeps swimming
    const wag = Math.sin(now / this.period + this.phase) * this.amplitude * effort;
    let head = add(this, mul(ortho(this.heading), wag));
    let step = sub(head, prev);
    if (mag(step) > 2 * PACE) head = add(prev, mul(norm(step), 2 * PACE));
    this.segments[0] = head;
    const wave = (this.body.length / 2) * Math.PI;
    for (let i = 1; i < this.body.length; i++) {
      step = sub(this.segments[i - 1], this.segments[i]);
      step = add(step, mul(ortho(step), (Math.sin(now / this.period + i * wave + this.phase) * effort * 1.25 * i) / this.body.length));
      this.segments[i] = sub(this.segments[i - 1], mul(norm(step), this.size));
    }
    this.sway = Math.sin(now / this.period + this.body.length * wave + this.phase) * effort;
  }

  // The body from the head back to segment `end` (the whole of it by default).
  outline(ctx: CanvasRenderingContext2D, scale: number, color = this.color, end = this.body.length) {
    const s = this.shape;
    ctx.beginPath();
    ctx.moveTo(s[0].x, s[0].y);
    for (let i = 1; i < end; i++) {
      const p = add(s[i], mul(ortho(sub(s[i - 1], s[i])), this.body[i] * this.size * scale));
      ctx.lineTo(p.x, p.y);
    }
    for (let i = end - 1; i > 0; i--) {
      const p = add(s[i], mul(ortho(sub(s[i], s[i - 1])), this.body[i] * this.size * scale));
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = tone(color);
    ctx.shadowColor = tone(color);
    ctx.shadowBlur = glowing ? this.glow : 0;
    ctx.fill();
  }

  fin(ctx: CanvasRenderingContext2D, at: number, width: number, length: number, left: boolean) {
    const shape = [0.25, 0.35, 0.6, 0.85, 0.95, 1];
    const s = this.shape;
    const along = sub(s[at], s[at - 1]);
    const side = mul(ortho(along), left ? 1 : -1);
    const step = mul(norm(along), this.size * length);
    ctx.beginPath();
    ctx.moveTo(s[at].x, s[at].y);
    shape.forEach((k, m) => {
      const p = add(add(s[at], mul(step, m)), mul(side, k * this.size * width));
      ctx.lineTo(p.x, p.y);
    });
    const tip = add(add(s[at], mul(step, shape.length - 2)), mul(side, 0.35 * this.size * width));
    ctx.lineTo(tip.x, tip.y);
    ctx.closePath();
    ctx.fillStyle = tone(this.finColor);
    ctx.shadowColor = tone(this.color);
    ctx.shadowBlur = glowing ? 2 : 0;
    ctx.fill();
  }

  draw(ctx: CanvasRenderingContext2D) {
    this.outline(ctx, this.sizeMult);
  }
}

class Predator extends Fish {
  constructor(x: number, y: number) {
    super(x, y);
    this.type = 'predator';
    this.speed = 2;
    this.size = ~~rand(7, 9);
    const [r, g, b] = [~~rand(130, 170), ~~rand(160, 200), ~~rand(200, 225)];
    this.color = `rgb(${r},${g},${b})`;
    this.finColor = `rgb(${r - 10},${g - 10},${b - 10})`;
    this.angMomentum = 0.047; // turn radius ~ speed / angMomentum: 1.5x wider than 0.07, so fish out-turn it
    this.period = 50 * this.size * 0.85 * PACE; // tail beats at the original rate, unhurried by PACE
    this.amplitude = 3 * this.size * 1.2;
    this.body = PREDATOR_BODY;
    this.sizeMult = 1.5;
    this.eyesight = 200;
    this.flockDistance = 2000;
    this.matchVelFactor = 2000;
    this.separationScale = 1;
    this.personalSpace = 70;
  }

  reactTo(other: Fish) {
    if (other.type !== 'fish') return;
    this.steer(other, 1, true);
    this.alarmed = true; // on the hunt
  }

  draw(ctx: CanvasRenderingContext2D) {
    this.fin(ctx, 4, 4, 0.75, true);
    this.fin(ctx, 4, 4, 0.75, false);
    this.fin(ctx, 9, 1.5, 0.3, true);
    this.fin(ctx, 9, 1.5, 0.3, false);
    this.fin(ctx, 16, 0.5, 0.5, false);
    this.outline(ctx, 1.5);
    this.fin(ctx, 7, 1, 0.4, true);
  }
}

// Spawning sockeye for the stream: red with a green head, bigger and steadier than the reef fish.
// They work their way upstream in loose groups; between pushes each rests in the slack water
// behind the nearest boulder in reach (or holds where it is), and they swim round the boulders.
class Salmon extends Fish {
  head: string;
  neck = SALMON_NECK; // segments before this are its rigid head
  tailLength = 2.55; // the tail fin, in segment lengths
  tailWidth = 0.35;

  constructor(x: number, y: number) {
    super(x, y);
    this.type = 'salmon';
    this.speed = 2.2;
    const grown = 1 + 0.3 * Math.random(); // up to 30% bigger than the smallest
    this.size = 6.5 * grown; // about 90-120 px long
    this.body = SALMON_BODY;
    // The same reds and greens on every fish, each a touch brighter or darker (+-8%) and more or
    // less vivid (-15% to +10%).
    const light = rand(0.92, 1.08);
    const vivid = rand(0.85, 1.1);
    const tint = (...rgb: number[]) => {
      const grey = (rgb[0] + rgb[1] + rgb[2]) / 3;
      return `rgb(${rgb.map((c) => Math.round(Math.min(255, (grey + (c - grey) * vivid) * light))).join()})`;
    };
    this.color = tint(192, 45, 40);
    this.head = tint(72, 112, 62);
    this.finColor = tint(122, 35, 32);
    this.angMomentum = 0.06;
    // An unhurried tail beat (~1.2 s for the smallest), slower the bigger the fish: up to half as
    // slow again for the biggest.
    this.period = (50 * 6.5 * 0.7 * PACE * grown ** 1.5) / 1.2;
    this.amplitude = 1.2 * this.size; // how far the tail swings either side
    this.eyesight = 160;
    this.personalSpace = 45;
    this.separationScale = 0.6;
    this.flockDistance = 2500;
    this.matchVelFactor = 10;
  }

  settle(now: number) {
    if (!water.current.strength) return;
    // Resting a little under half the time, on a rhythm nearby salmon share (only gently tied to
    // where it is, so its own swimming hardly speeds or stalls its rhythm).
    const resting = Math.sin(now / 5000 + this.x / 1500 + this.y / 1900 + HOLD_PHASE) > 0.15 && !this.alarmed;
    this.hold += ((resting ? 1 : 0) - this.hold) * 0.04;
    // Edge away from any boulder it's over, and find the slack water behind the nearest one ahead.
    let lee: V | null = null;
    let best = 320;
    for (const r of water.current.rocks) {
      const d = dist(this, r);
      if (d < r.r + 30) this.v = add(this.v, mul(norm(sub(this, r)), 0.25 * (1 - d / (r.r + 30)) * this.speed));
      const spot = add(r, mul(water.current.downstream, 1.6 * r.r));
      // Only boulders ahead of it, or nearly alongside: it doesn't turn back to rest.
      const ahead = -dot(sub(spot, this), water.current.downstream);
      if (dist(this, spot) < best && ahead > -40) {
        best = dist(this, spot);
        lee = spot;
      }
    }
    // Pushing upstream, or easing into that slack water (slowing as it arrives) and staying.
    const upstream = mul(water.current.downstream, -0.8 * this.speed);
    const toLee = lee && sub(lee, this);
    const stay = toLee ? mul(norm(toLee), Math.min(this.speed, 0.02 * mag(toLee))) : mul(this.v, 0.1);
    this.v = lerp(this.v, lerp(upstream, stay, this.hold), 0.08 * water.current.strength);
  }

  // Swimming. Its spine follows the path of its head, stiffly, so it curves through turns; on
  // top of that a wave of side-to-side movement runs from head to tail, about one wavelength
  // along the body, growing from almost nothing at the head to `amplitude` at the tail. (The
  // other fish swing their heads and let the body follow, which reads as flapping on a fish
  // this big.)
  updateSegments(now: number) {
    const s = this.segments;
    s[0] = { x: this.x, y: this.y };
    for (let i = 1; i < s.length; i++) s[i] = sub(s[i - 1], mul(norm(sub(s[i - 1], s[i])), this.size));
    const beat = this.beat(now) / this.period + this.phase;
    this.shape = s.map((p, i) => {
      const u = i / (s.length - 1); // 0 at the head, 1 at the tail
      const side = ortho(i ? sub(s[i - 1], s[i]) : sub(s[0], s[1]));
      return add(p, mul(side, this.amplitude * Math.max(this.effort, 0.65) * (0.06 + 0.94 * u * u) * Math.sin(beat - 5.6 * u)));
    });
    // The head is one rigid piece, from the neck to the tip of the snout: no bend within it.
    const neck = this.shape[this.neck];
    const snout = sub(this.shape[0], neck);
    for (let i = 1; i < this.neck; i++) this.shape[i] = add(neck, mul(snout, (this.neck - i) / this.neck));
    this.sway = Math.cos(beat - 5.6) * Math.max(this.effort, 0.65); // how fast the tail is sweeping sideways, -1 to 1
  }

  // The tail fin: two lobes pivoting on the end of the body, lying over each other. It beats like
  // a paddle: as the tail sweeps sideways the fin is bent back against the sweep (most at
  // mid-stroke, up to ~25 deg), pushing water behind, and flicks over at each end of the stroke.
  // The second lobe bends a little more, so the fork opens on each stroke.
  tail(ctx: CanvasRenderingContext2D) {
    const s = this.shape;
    const base = s[s.length - 1];
    const toward = sub(s[s.length - 2], base); // up the body
    const back = norm(mul(toward, -1));
    const across = ortho(toward); // the way the tail's sideways sweep (sway) is measured
    for (const [give, edge] of [
      [0.4, 1],
      [0.5, -1],
    ]) {
      const dir = norm(add(back, mul(across, -give * this.sway)));
      const side = mul(ortho(dir), this.tailWidth * this.size * edge); // its fuller, outer edge
      const mid = add(base, mul(dir, 0.53 * this.tailLength * this.size));
      ctx.beginPath();
      for (const p of [add(base, side), add(mid, mul(side, 0.9)), add(base, mul(dir, this.tailLength * this.size)), sub(mid, mul(side, 0.4)), sub(base, mul(side, 0.4))]) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fillStyle = tone(this.finColor);
      ctx.fill();
    }
  }

  // The dorsal fin, seen from above: a thin dark sliver along its back, a little behind the
  // middle, bending with it.
  dorsal(ctx: CanvasRenderingContext2D) {
    const s = this.shape;
    const width = [0, 0.16, 0.1, 0]; // across segments 6-9, in segment lengths
    const edge = (i: number, k: number) => add(s[i + 6], mul(ortho(sub(s[i + 5], s[i + 6])), k * width[i] * this.size));
    ctx.beginPath();
    for (let i = 0; i < width.length; i++) ctx.lineTo(edge(i, 1).x, edge(i, 1).y);
    for (let i = width.length - 1; i >= 0; i--) ctx.lineTo(edge(i, -1).x, edge(i, -1).y);
    ctx.closePath();
    ctx.fillStyle = tone(this.finColor);
    ctx.fill();
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Under the body, sticking out either side: pectoral fins behind the head, pelvic fins at
    // mid-belly.
    this.fin(ctx, 3, 1.7, 0.4, true); // just behind where the green head meets the red
    this.fin(ctx, 3, 1.7, 0.4, false);
    this.fin(ctx, 7, 1.4, 0.5, true);
    this.fin(ctx, 7, 1.4, 0.5, false);
    this.tail(ctx);
    this.outline(ctx, 1.3);
    this.outline(ctx, 1.3, this.head, SALMON_NECK + 1);
    this.dorsal(ctx);
  }
}

// Koi for the pond: big, slow and graceful, each with its own pattern (koiPattern()). They cruise
// in loose groups, now gliding, now pushing on, wandering this way and that, and turn back from
// the pond's edges. They swim like the salmon, with a softer, slower beat.
class Koi extends Salmon {
  patches: Patch[];
  pace = 0.6; // its speed
  dir = this.heading; // and which way it's going (see settle())

  constructor(x: number, y: number) {
    super(x, y);
    this.type = 'koi';
    const grown = 0.5 + Math.random(); // half to one and a half times a typical koi
    this.size = 7 * grown; // about 50-150 px long, with the tail
    this.body = KOI_BODY;
    this.neck = 3;
    this.speed = 1.2;
    const { base, fin, patches } = koiPattern();
    this.color = base;
    this.finColor = fin;
    this.patches = patches;
    this.angMomentum = 0.035;
    this.momentum = 0.6; // slow to answer the school's tugs
    this.period = 50 * 7 * 0.6 * PACE * grown ** 1.5; // a beat every ~2.2 s for a typical one
    this.amplitude = 0.9 * this.size;
    this.tailLength = 2.3;
    this.tailWidth = 0.42;
    this.eyesight = 200;
    this.personalSpace = 60;
    this.separationScale = 0.5;
    // Its school's pull only steers it (see settle()), and gently: a loose group.
    this.flockDistance = 30000;
    this.matchVelFactor = 200;
  }

  settle(now: number) {
    // Wandering: a slow swing one way, then the other.
    this.v = rotate(this.v, 0.006 * Math.sin(now / 2300 + 3 * this.phase));
    // Its speed eases between gliding and pushing on (darting off if alarmed). The school's tugs
    // and its wandering only steer it (left to set its speed too, a tug swinging round would take
    // it through zero, stopping it dead), and it turns no tighter than a fish its length
    // comfortably can, in a circle over a body length in radius (half that when alarmed), so it
    // sweeps round rather than doubling back on itself.
    const cruise = this.alarmed ? this.speed : this.speed * (0.75 + 0.2 * Math.sin(now / 6000 + 5 * this.phase));
    this.pace += (cruise - this.pace) * 0.03;
    const radius = (this.alarmed ? 0.6 : 1.2) * this.body.length * this.size;
    // It heads where they steer it, unless that's out of view within a full turn's width: then it
    // turns back in, as hard as it can.
    const [w, h, edge] = [stage.w, stage.h, 100];
    const ahead = add(this, this.dir, 2 * radius);
    const back = { x: +(ahead.x < edge) - +(ahead.x > w - edge), y: +(ahead.y < edge) - +(ahead.y > h - edge) };
    const to = back.x || back.y ? back : this.v;
    const most = (this.pace * PACE) / radius; // radians this step
    const want = Math.atan2(this.dir.x * to.y - this.dir.y * to.x, dot(this.dir, to));
    this.dir = rotate(this.dir, Math.max(-most, Math.min(most, want)));
    this.v = mul(this.dir, this.pace);
  }

  // A point on the body: u from the snout (0) to the tail (1), v across it (1 at either edge).
  at(u: number, v: number, scale: number): V {
    const s = this.shape;
    const f = Math.min(Math.max(u, 0), 1) * (s.length - 1);
    const i = Math.min(Math.floor(f), s.length - 2);
    const t = f - i;
    const width = (this.body[i] * (1 - t) + this.body[i + 1] * t) * this.size * scale;
    return add(lerp(s[i], s[i + 1], t), mul(ortho(sub(s[i], s[i + 1])), v * width));
  }

  draw(ctx: CanvasRenderingContext2D) {
    // Broad pectoral fins behind the head and smaller pelvic fins, under the body.
    this.fin(ctx, 3, 2.4, 0.55, true);
    this.fin(ctx, 3, 2.4, 0.55, false);
    this.fin(ctx, 8, 1.2, 0.45, true);
    this.fin(ctx, 8, 1.2, 0.45, false);
    this.tail(ctx);
    this.outline(ctx, 1.3); // leaves the body's outline as the path, to clip the pattern to
    ctx.save();
    ctx.clip();
    ctx.shadowBlur = 0;
    for (const p of this.patches) {
      ctx.beginPath();
      for (const [u, v] of p.pts) {
        const q = this.at(u, v, 1.3);
        ctx.lineTo(q.x, q.y);
      }
      ctx.closePath();
      ctx.fillStyle = tone(p.color);
      ctx.fill();
    }
    ctx.restore();
    this.dorsal(ctx);
  }
}

// A koi's colours: one of the classic varieties, laid out at random so no two are alike. The
// patches are blobs in body coordinates (see Koi.at()), cut off by the body's outline.
type Patch = { color: string; pts: [number, number][] };
const KOI_COLOURS = {
  white: [244, 239, 230],
  red: [214, 66, 42],
  black: [34, 31, 33],
  gold: [234, 178, 62],
  platinum: [222, 226, 228],
  orange: [238, 124, 46],
  yellow: [240, 204, 82],
  brown: [140, 98, 62],
  blue: [118, 140, 160],
};
function koiPattern() {
  const light = rand(0.94, 1.04);
  const tone = (c: number[], k = 1) => c.map((x) => Math.round(Math.min(255, x * light * k)));
  const css = (c: number[], a = 1) => `rgba(${tone(c).join()},${a})`;
  const blob = (u: number, v: number, ru: number, rv: number): [number, number][] => {
    const [a, b] = [rand(0, 6.283), rand(0, 6.283)];
    return Array.from({ length: 20 }, (_, k) => {
      const t = (k / 20) * 6.283;
      const r = 1 + 0.18 * Math.sin(3 * t + a) + 0.1 * Math.sin(5 * t + b);
      return [u + ru * r * Math.cos(t), v + rv * r * Math.sin(t)];
    });
  };
  const patch = (c: number[], u: number, v: number, ru: number, rv: number): Patch => ({ color: css(c), pts: blob(u, v, ru, rv) });
  // Red (or another colour) in steps down the back, the first often capping the head.
  const steps = (c: number[], n: number, from = rand(0, 1) < 0.5 ? 0.04 : 0.16) =>
    Array.from({ length: n }, (_, k) => patch(c, from + ((k + rand(0.3, 0.7)) * (0.82 - from)) / n, rand(-0.4, 0.4), ((0.82 - from) / n) * rand(0.35, 0.55), rand(0.7, 1.4)));
  const spots = (c: number[], n: number) => Array.from({ length: n }, () => patch(c, rand(0.2, 0.85), rand(-0.9, 0.9), rand(0.02, 0.045), rand(0.25, 0.5)));
  const sheen = (c: number[]) => [patch(tone(c, 1.12), 0.45, 0, 0.38, 0.35)]; // a metallic gleam along the back
  const { white, red, black, gold, platinum, orange, yellow, brown, blue } = KOI_COLOURS;
  const kinds: [number, () => [number[], Patch[]]][] = [
    [4, () => [white, steps(red, Math.round(rand(2, 4)))]], // kohaku
    [3, () => [white, [...steps(red, Math.round(rand(2, 4))), ...spots(black, Math.round(rand(3, 6)))]]], // sanke
    [2, () => [black, [...steps(red, Math.round(rand(2, 3))), ...Array.from({ length: Math.round(rand(2, 4)) }, () => patch(white, rand(0.1, 0.8), rand(-1, 1), rand(0.05, 0.1), rand(0.4, 0.9)))]]], // showa
    [1, () => [white, [patch(red, 0.09, 0, 0.045, 0.55)]]], // tancho
    [1.5, () => { const c = [gold, platinum, yellow][Math.floor(rand(0, 3))]; return [c, sheen(c)]; }], // ogon, platinum, yamabuki
    [1, () => [orange, sheen(orange)]], // orenji ogon
    [1, () => [platinum, steps(orange, Math.round(rand(2, 3)))]], // hariwake / kujaku-ish
    [1, () => [blue, [patch(orange, 0.45, 1.1, 0.35, 0.5), patch(orange, 0.45, -1.1, 0.35, 0.5), patch(tone(white, 0.95), 0.07, 0, 0.06, 0.8)]]], // asagi
    [0.7, () => [brown, sheen(brown)]], // chagoi
  ];
  let pick = rand(0, kinds.reduce((sum, [w]) => sum + w, 0));
  const [base, patches] = (kinds.find(([w]) => (pick -= w) < 0) ?? kinds[0])[1]();
  return { base: css(base), fin: css(base === black ? black : white, 0.55), patches };
}

// What the reef's damselfish keep an eye on, each frame: the sharks, the cursor, and the time step.
// The colour they're drawn in (CSS's saturate() and brightness(), as their canvas's filter once
// did): richer in the bright day water of the reef and the beach, or they'd wash out; dimmer and
// greyer in the pond at night, with the lilies. Each colour worked out once per look.
let look = { vivid: 1, light: 1 };
const tones = new Map<string, string>();
const tone = (c: string) => {
  if (look.vivid === 1 && look.light === 1) return c;
  let t = tones.get(c);
  if (!t) {
    const [r, g, b, a = 1] = (c.match(/[\d.]+/g) ?? []).map(Number);
    const grey = 0.213 * r + 0.715 * g + 0.072 * b;
    const [R, G, B] = [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, (grey + (v - grey) * look.vivid) * look.light))));
    tones.set(c, (t = `rgba(${R},${G},${B},${a})`));
  }
  return t;
};
const setLook = (vivid: number, light: number) => {
  if (vivid === look.vivid && light === look.light) return;
  look = { vivid, light };
  tones.clear();
};
let glowing = true; // their colour blurring out round them (not in their shadows)
let sharks: Fish[] = [];
let cursor: V | null = null;
let step = 1 / 60;
type Home = { x: number; y: number; r: number };
// Danger near a point: a shark within `reach` px of it, or the cursor within `hand` px.
const danger = (p: V, reach: number, hand: number) => sharks.find((f) => dist(f, p) < reach) ?? (cursor && dist(cursor, p) < hand ? cursor : null);

// Damselfish (and chromis) for the reef: a cloud of small fish over each of the big coral colonies,
// each hovering about a spot of its own over the coral that wanders slowly round it, milling with its
// neighbours. When a shark comes near the colony (or the cursor near them), the whole cloud dives
// down into the coral, packing in near its middle and tucking in (smaller and fainter, as if among
// its branches); once the danger's past they drift back up, a few at a time.
class Damsel extends Fish {
  home: Home;
  spot = rand(0, 6.283); // where it hovers: an angle round the colony, and how far out (of its reach)
  out = rand(0.15, 0.7);
  hiding = 0; // s more it stays hidden
  tuck = 0; // eases to 1 while it's tucked into the coral

  constructor(home: Home, color: string) {
    super(home.x + rand(-0.4, 0.4) * home.r, home.y + rand(-0.4, 0.4) * home.r);
    this.type = 'damsel';
    this.homed = true;
    this.glow = 0;
    this.home = home;
    this.size = rand(2.6, 3.4);
    this.speed = 1.1;
    this.color = color;
    this.period = (rand(0.8, 1.2) * 50 * this.size) / 3;
    this.amplitude = (rand(0.8, 1.2) * 3 * this.size) / 5;
    this.eyesight = 45;
    this.personalSpace = 7;
    this.separationScale = 0.4;
    this.flockDistance = 2500;
    this.matchVelFactor = 10;
  }

  settle(now: number) {
    if (danger(this.home, 0.6 * this.home.r + 120, 110)) this.hiding = Math.max(this.hiding, rand(1.5, 3.5));
    else this.hiding = Math.max(0, this.hiding - step);
    const hidden = this.hiding > 0;
    this.spot += 0.15 * step * Math.sin(now / 3000 + this.phase);
    const reach = this.home.r * (hidden ? 0.18 : this.out);
    const to = sub({ x: this.home.x + reach * Math.cos(this.spot), y: this.home.y + reach * Math.sin(this.spot) }, this);
    const pace = this.speed * (hidden ? 1 : 0.55) * Math.min(1, Math.max(0.15, mag(to) / 40));
    // Its urge to swim (acc, which steers it from frame to frame) turns to its spot, the cloud's
    // pull only adding to it, or the cloud would carry it off its colony.
    const want = mul(norm(to), pace);
    this.acc = mul(sub(want, this.v), hidden ? 0.08 : 0.04);
    this.v = lerp(this.v, want, hidden ? 0.2 : 0.08);
    const tucked = hidden && mag(to) < 0.3 * this.home.r;
    this.tuck += ((tucked ? 1 : 0) - this.tuck) * 0.06;
    this.cruise = tucked ? 0.05 : 0.25; // hovering, it barely swims; tucked in, hardly at all
  }

  draw(ctx: CanvasRenderingContext2D) {
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * (1 - 0.55 * this.tuck);
    this.outline(ctx, this.sizeMult * (1 - 0.25 * this.tuck));
    ctx.globalAlpha = alpha;
  }
}

export function startFish(root: HTMLElement, signal: AbortSignal) {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-boids]');
  const ctx = canvas?.getContext('2d');
  // Their shadows on the floor, cast the way the foam's are but shorter (they swim lower): drawn as
  // silhouettes at half the resolution off the page (`shapes`), then blurred onto a canvas of their
  // own beneath them. Where a canvas can't blur (Safari), at a fifth of it, stretched to soften them.
  const shadows = root.querySelector<HTMLCanvasElement>('[data-fish-shadows]');
  const stx = shadows?.getContext('2d');
  const shapes = document.createElement('canvas');
  const htx = shapes.getContext('2d');
  const blurs = !!stx && 'filter' in stx;
  const SHADOW = { scale: blurs ? 0.5 : 0.2, x: 30, y: 42, blur: 3, alpha: 0.45 }; // CSS px
  if (canvas && ctx && shadows && stx && htx) {
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = stage.dpr(quality.now.fish); // less where frames come slowly (quality.ts)
      w = stage.w;
      h = stage.h;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      shadows.width = shapes.width = Math.ceil(w * SHADOW.scale);
      shadows.height = shapes.height = Math.ceil(h * SHADOW.scale);
      htx.setTransform(SHADOW.scale, 0, 0, SHADOW.scale, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize, { signal });
    quality.onChange(resize);

    // Fewer fish on small screens, same density as the original on a laptop.
    // (All made again, in new places and patterns, when the water is rerolled: water.generation.)
    const [reef, run, pond, sea, residents]: Fish[][] = [[], [], [], [], []];
    // The reef's residents, about its coral (water.colonies, from scene.ts): a cloud of damselfish
    // over each big colony on screen, all of one kind (blue chromis, green chromis or yellow damsels).
    let residentsFor: unknown = null;
    const settleIn = () => {
      residents.length = 0;
      residentsFor = water.colonies;
      const colonies = water.colonies ?? [];
      const kinds = [[60, 150, 255], [70, 215, 205], [255, 210, 60]];
      for (const c of colonies) {
        if (c.r < 70 || c.x < -c.r / 2 || c.x > w + c.r / 2 || c.y < -c.r / 2 || c.y > h + c.r / 2) continue;
        const [r, g, b] = kinds[Math.floor(rand(0, kinds.length))];
        for (let i = 0; i < Math.round(rand(10, 16)); i++) {
          const k = rand(0.85, 1.15);
          residents.push(new Damsel(c, `rgb(${[r, g, b].map((v) => Math.min(255, Math.round(v * k))).join()})`));
        }
      }
      for (const f of residents) f.initSegments();
    };
    // The beach scene's: the reef's fish and its sharks again, in water deep enough for them (sharks
    // keeping out past the break), placed once the waves' seabed is known (water.depth).
    let seaFor: unknown = null;
    const stock = () => {
      sea.length = 0;
      seaFor = water.depth;
      const wet = (wade: number) => {
        for (let k = 0; k < 200; k++) {
          const p = { x: rand(40, w - 40), y: rand(40, h - 40) };
          if (water.depth!(p.x, p.y) > wade + 1.5) return p;
        }
        return null;
      };
      const count = Math.round(Math.min(60, Math.max(20, (w * h) / 18000)));
      for (let i = 0; i < count + 2; i++) {
        const wade = i < count ? 0.8 : 3;
        const p = wet(wade);
        if (!p) continue;
        const f = i < count ? new Fish(p.x, p.y) : new Predator(p.x, p.y);
        f.wade = wade;
        f.initSegments();
        sea.push(f);
      }
    };
    const populate = () => {
      for (const school of [reef, run, pond]) school.length = 0;
      seaFor = null;
      residentsFor = null;
      const count = Math.round(Math.min(80, Math.max(25, (w * h) / 14000)));
      for (let i = 0; i < count; i++) reef.push(new Fish(rand(0, w), rand(0, h)));
      reef.push(new Predator(rand(0, w), rand(0, h)), new Predator(rand(0, w), rand(0, h)));
      // The stream's salmon: a few big fish, about 14 on a laptop.
      for (let i = 0; i < Math.round(Math.min(16, Math.max(6, (w * h) / 90000))); i++) run.push(new Salmon(rand(0, w), rand(0, h)));
      // The pond's koi: about 10 on a laptop.
      for (let i = 0; i < Math.round(Math.min(12, Math.max(5, (w * h) / 130000))); i++) pond.push(new Koi(rand(0, w), rand(0, h)));
      for (const f of [...reef, ...run, ...pond]) f.initSegments();
    };
    populate();
    let generation = water.generation;

    let pointer: V | null = null;
    window.addEventListener('pointermove', (e) => (pointer = { x: e.clientX / stage.zoom, y: e.clientY / stage.zoom }), { passive: true, signal });
    document.addEventListener('pointerleave', () => (pointer = null), { signal });

    // Fish move a fixed step at a time (as in the original): 60 a second, whatever the frame rate.
    const STEP = 1000 / 60; // ms
    let last = performance.now();
    // `steps`: how many to take before drawing them.
    const frame = (now: number, steps = 1) => {
      const dt = Math.min((now - last) / 1000, 0.05 * steps) / steps; // s a step; no jump after the tab was hidden
      last = now;
      // The reef fish in the ocean, the salmon in the stream, the koi in the pond: each school only
      // swims (and shows, fading) while its scene does.
      const reefWeight = Math.max(0, 1 - water.stream - water.pond - water.beach);
      const schools: [Fish[], number][] = [
        [residents, reefWeight],
        [reef, reefWeight],
        [run, water.stream],
        [pond, water.pond],
        [sea, water.beach],
      ];
      if (water.beach >= 0.003 && water.depth && seaFor !== water.depth) stock();
      if (reefWeight >= 0.003 && water.colonies && residentsFor !== water.colonies) settleIn();
      // The residents watch the reef's sharks (which only ever hunt the schooling fish: they never see
      // the residents) and the cursor.
      sharks = reef.filter((f) => f.type === 'predator');
      cursor = pointer;
      step = dt || 1 / 60;
      if (water.generation !== generation) {
        generation = water.generation;
        populate();
      }
      ctx.clearRect(0, 0, w, h);
      htx.clearRect(0, 0, w, h);
      const day = water.day;
      for (const [school, weight] of schools) {
        if (weight < 0.003) continue;
        if (school === pond) setLook(day ? 1 : 0.75, day ? 1 : 0.55);
        else setLook(day && school !== run ? 1.8 : 1, 1);
        for (let k = steps - 1; k >= 0; k--) {
          const t = now - k * STEP;
          for (let i = school.length - 1; i >= 0; i--) {
            school[i].think(school, i, pointer, dt, t);
            const [dx, dy] = water.current.at?.(school[i].x, school[i].y) ?? [0, 0];
            school[i].move(w, h, t, { x: dx / 60, y: dy / 60 }); // px/s to px per (60 Hz) step
          }
        }
        ctx.globalAlpha = htx.globalAlpha = weight;
        for (let i = school.length - 1; i >= 0; i--) {
          const f = school[i];
          // In the beach scene, seen through the waves: each part of it lifted up the screen by the
          // water over it, as the seabed is, so it shifts, and bends, as the swell passes over.
          const lift = school === sea ? water.lift : undefined;
          const shape = f.shape;
          if (lift) f.shape = shape.map((p) => ({ x: p.x, y: p.y + lift(p.x, p.y) }));
          f.draw(ctx);
          glowing = false;
          f.draw(htx);
          glowing = true;
          f.shape = shape;
        }
      }
      ctx.globalAlpha = htx.globalAlpha = 1;
      // The shadows: the silhouettes, cast and blurred, all one colour.
      stx.clearRect(0, 0, shadows.width, shadows.height);
      if (blurs) stx.filter = `blur(${SHADOW.blur * SHADOW.scale}px)`;
      stx.drawImage(shapes, SHADOW.x * SHADOW.scale, SHADOW.y * SHADOW.scale);
      if (blurs) stx.filter = 'none';
      stx.globalCompositeOperation = 'source-in';
      stx.fillStyle = `rgba(0, 0, 0, ${SHADOW.alpha})`;
      stx.fillRect(0, 0, shadows.width, shadows.height);
      stx.globalCompositeOperation = 'source-over';
      // The caustics falling on them (scene.ts's glints), painted only where there's a fish: fainter
      // on the richer and the dimmer fish (tone()), as when their colour was a filter over the glints too.
      if (water.glints) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = 1 - (day ? 0.5 * (reefWeight + water.beach) : 0.6 * water.pond);
        ctx.drawImage(water.glints, 0, 0, w, h);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    };

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // One still frame: the fish, not swimming.
      for (let i = 0; i < 60; i++) frame(last + i * 16);
    } else {
      // 60 steps a second: on a 120 Hz screen one every other frame; where frames come slower (an
      // older phone, a browser saving power) two or more a frame, so they don't slow down with it. (At
      // most 4: past that, slowing down is better than stalling the page.)
      let lag = 0;
      let prev = performance.now();
      const loop = (now: number) => {
        if (signal.aborted) return;
        lag += now - prev;
        prev = now;
        if (lag >= STEP - 2) {
          const steps = Math.min(4, Math.max(1, Math.floor((lag + 2) / STEP)));
          lag = Math.min(lag - steps * STEP, STEP); // carry the remainder, so 144 Hz still averages 60
          frame(now, steps);
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }
}
