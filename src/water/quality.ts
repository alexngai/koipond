// How much the water and fish spend on their looks: stepped down to keep frames coming at about 60 a
// second where the screen is big or the machine slow, and back up when there's room again. It watches
// the frames itself, and remembers where it settled for this screen; scene.ts and fish.ts read
// `quality.now` and listen for changes. Started by createPond() (index.ts), which can pin a level
// instead (0, all of it, to 4), and stopped with it.
// Each level: the surface's and the fish's canvas px per CSS px (at most; never more than the
// screen's), the floor's, and whether the fish catch the caustics.
export const LEVELS = [
  { surface: 1.5, fish: 2, floor: 1, glints: true },
  { surface: 1.25, fish: 1.5, floor: 1, glints: true },
  { surface: 1, fish: 1.5, floor: 0.75, glints: true },
  { surface: 1, fish: 1, floor: 0.75, glints: false },
  { surface: 0.75, fish: 1, floor: 0.5, glints: false },
];
const WINDOW = 1500; // ms of frames judged at a time
const SLOW = 18.5; // ms a frame on average: too slow (under ~54 a second)
const ROOMY = 17.2; // ... with room to spare (60 a second, give or take)

const clamp = (n: number) => Math.min(LEVELS.length - 1, Math.max(0, Math.round(n) || 0));
let key = ''; // where it remembers its level, for this screen
let level = 0;
let listeners: (() => void)[] = [];
let quiet = 0; // judging nothing till then: starting up, a new scene, a resize

export const quality = {
  get now() {
    return LEVELS[level];
  },
  onChange(f: () => void) {
    listeners.push(f);
  },
  // A moment of heavier frames ahead that says nothing about the machine (a crossfade, a reroll).
  settle(ms = 2000) {
    quiet = Math.max(quiet, performance.now() + ms);
  },
  // From where it last settled on this screen (or `pin`, held), watching till `signal` aborts.
  start(pin: number | null, signal: AbortSignal) {
    key = `koipond-quality:${screen.width}x${screen.height}@${window.devicePixelRatio}`;
    level = clamp(pin ?? Number((() => { try { return localStorage.getItem(key); } catch { return 0; } })()));
    listeners = [];
    quiet = performance.now() + 3000;
    signal.addEventListener('abort', () => (listeners = []));
    if (pin === null && !matchMedia('(prefers-reduced-motion: reduce)').matches) watch(signal);
  },
};

const set = (to: number) => {
  level = to;
  quiet = Math.max(quiet, performance.now() + 500); // a moment for the new level to settle in
  try {
    localStorage.setItem(key, String(level));
  } catch {}
  for (const f of listeners) f();
};

function watch(signal: AbortSignal) {
  let prev = performance.now();
  let [sum, n, start] = [0, 0, prev];
  let calm = 0; // windows in a row with room to spare
  let before = 0; // the average frame before the last step down, to see that it helped
  let up = 0; // when it last stepped up
  let hold = 60_000; // ms after a level proves too slow before trying it again: doubling each time
  let until = 0; // no stepping up till then
  let alone = 0; // no stepping at all till then
  const judge = (mean: number, now: number) => {
    if (before) {
      // The last step down didn't help: something else is holding the frames back (a browser
      // capping them to save power, a 50 Hz screen). Back up, and leave it be for a while.
      const helped = mean < before * 0.92;
      before = 0;
      if (!helped) {
        set(level - 1);
        alone = now + 5 * 60_000;
        return;
      }
    }
    if (now < alone) return;
    if (mean > SLOW && level < LEVELS.length - 1) {
      if (now - up < 2 * WINDOW) hold = Math.min(hold * 2, 30 * 60_000); // straight back down: wait longer next time
      until = now + hold;
      before = mean;
      calm = 0;
      set(level + 1);
      return;
    }
    calm = mean < ROOMY ? calm + 1 : 0;
    if (calm >= 8 && level > 0 && now > until) {
      calm = 0;
      up = now;
      set(level - 1);
    }
  };
  const tick = (now: number) => {
    const gap = now - prev;
    prev = now;
    if (now < quiet) [sum, n, start] = [0, 0, now];
    else if (gap < 100) {
      // (a longer one is the tab coming back, or a stall worth nothing to judge by)
      sum += gap;
      n++;
    }
    if (now - start >= WINDOW && n > 10) {
      judge(sum / n, now);
      [sum, n, start] = [0, 0, now];
    }
    if (!signal.aborted) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
