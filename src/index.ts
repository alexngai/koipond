// Koi Pond: a living water scene behind a page. A coral reef, a mountain stream, a koi pond or a
// beach, by day or by night, with fish that swim away from the cursor, drawn in WebGL full window on
// layers of its own.
//
//   import { createPond } from 'koipond-sim';
//   const pond = createPond({ scene: 'beach' });
//   pond?.setTime('night');
//
// One pond to a page at a time (its parts share some state). Nothing runs until createPond().
import { startWater, NAMES, type Scene as Inner } from './water/scene';
import { startFish } from './water/fish';
import { quality } from './water/quality';

export type Scene = 'reef' | 'stream' | 'pond' | 'beach';
export type Time = 'day' | 'night';
/** Every scene. */
export const SCENES: readonly Scene[] = ['reef', 'stream', 'pond', 'beach'];

export type PondOptions = {
  /** The scene it opens on: one at random unless given. */
  scene?: Scene;
  /** 'day' unless given. */
  time?: Time;
  /** Whether it has fish: true unless given. */
  fish?: boolean;
  /**
   * Holds the detail at a level, 0 (all of it) to 4. Unless given, it steps down by itself where
   * frames come slowly (a big screen, a slow machine) and back up when there's room, and remembers
   * where it settled for the screen.
   */
  quality?: number;
  /** The element its layers go in, as its first child: document.body unless given. */
  container?: HTMLElement;
  /** Its layers' z-index: -1 unless given (behind the page). 'auto' leaves them in the page's order. */
  zIndex?: number | 'auto';
  /** Draws the stream's current and the beach's surf model instead, for working on them. */
  flow?: boolean;
};

export type Pond = {
  /** The element its layers are in: class "koipond", with data-scene and data-time. */
  readonly element: HTMLElement;
  readonly scene: Scene;
  readonly time: Time;
  /** Crossfades to another scene. */
  setScene(scene: Scene): void;
  /** Eases into day or night. */
  setTime(time: Time): void;
  /** Lays every scene out afresh, at random, with new fish. */
  reroll(): void;
  /** Stops it, and takes its layers off the page. */
  destroy(): void;
};

// Its layers, bottom to top: the floor, the fish's shadows and the fish, the beach's crab, then the
// stream's leaves, the pond's lilies, the surface, the stream's bubbles, the beach's and the reef's
// particles (and their foam, fused), and the beach's gulls. `fish`: the fish's own.
const LAYERS = ['water=0', 'fish-shadows', 'boids', 'shore', 'leaves', 'lilies', 'water=1', 'bubbles', 'spray', 'fused', 'goo', 'reef-spray', 'reef-fused', 'reef-goo', 'sky'];
const FISH = ['fish-shadows', 'boids'];
// Its styles, as weak as can be (:where()) so a page's own win: the layers fill the window, the fish
// a touch see-through, and everything dips out while a reroll lays it out afresh.
const CSS = `:where(.koipond){position:fixed;inset:0;pointer-events:none;transition:opacity .25s}
:where(.koipond.koipond-rerolling){opacity:0}
:where(.koipond>canvas){position:absolute;inset:0;width:100%;height:100%}
:where(.koipond-fish){opacity:.9}`;

const inner = (s: string | undefined): Inner => {
  const n = (s === 'reef' ? 'ocean' : s) as Inner;
  return NAMES.includes(n) ? n : NAMES[Math.floor(Math.random() * NAMES.length)];
};
const outer = (s: Inner): Scene => (s === 'ocean' ? 'reef' : s);

/** Puts a pond on the page, or does nothing and returns null where there's no WebGL. */
export function createPond(options: PondOptions = {}): Pond | null {
  const fish = options.fish !== false;
  const root = document.createElement('div');
  root.className = 'koipond';
  root.setAttribute('aria-hidden', 'true');
  root.style.zIndex = String(options.zIndex ?? -1);
  for (const layer of LAYERS) {
    if (!fish && FISH.includes(layer)) continue;
    const canvas = document.createElement('canvas');
    const [name, value = ''] = layer.split('=');
    canvas.setAttribute(`data-${name}`, value);
    if (FISH.includes(layer)) canvas.className = 'koipond-fish';
    root.append(canvas);
  }
  if (!document.getElementById('koipond-style')) {
    const style = document.createElement('style');
    style.id = 'koipond-style';
    style.textContent = CSS;
    document.head.append(style);
  }
  (options.container ?? document.body).prepend(root);

  const stop = new AbortController();
  quality.start(options.quality ?? null, stop.signal);
  const water = startWater({ scene: inner(options.scene), time: options.time === 'night' ? 'night' : 'day', root, signal: stop.signal, flow: options.flow });
  if (!water) {
    stop.abort();
    root.remove();
    return null;
  }
  if (fish) startFish(root, stop.signal);
  return {
    element: root,
    get scene() {
      return outer(water.scene);
    },
    get time() {
      return water.time;
    },
    setScene: (scene) => water.setScene(inner(scene)),
    setTime: (time) => water.setTime(time === 'night' ? 'night' : 'day'),
    reroll: () => water.reroll(),
    destroy() {
      stop.abort();
      // Their GPU memory back now, not whenever the canvases are collected.
      for (const canvas of root.querySelectorAll('canvas')) (canvas.getContext('webgl') as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
      root.remove();
    },
  };
}
