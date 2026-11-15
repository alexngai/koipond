// Water around the fish (fish.ts): a floor under them and a surface over them, drawn by the current
// scene's shader (*.glsl). Every scene has a day and a night palette.
import PRELUDE from './prelude.glsl?raw';
import OCEAN from './ocean.glsl?raw';
import STREAM from './stream.glsl?raw';
import POND from './pond.glsl?raw';
import { CURRENT, flow, water, placeStones, placePools, bubbles } from './stream';
import { placeReef, drawReef } from './reef';
import { lilies } from './pond';

const SCENES = { ocean: OCEAN, stream: STREAM, pond: POND };
export type Scene = keyof typeof SCENES;
export type Time = 'day' | 'night';
export const NAMES = Object.keys(SCENES) as Scene[];
const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const UNIFORMS = ['u_time', 'u_cell', 'u_layer', 'u_day', 'u_weight', 'u_res', 'u_dir', 'u_seed', 'u_stones', 'u_stoneCount', 'u_pools', 'u_poolCount', 'u_current', 'u_debug', 'u_foamView', 'u_dt', 'u_foam', 'u_bed', 'u_flowMap', 'u_bedView', 'u_reef'];
const CELL = 220; // CSS px across a foam cell
const DEBUG_FLOW = new URLSearchParams(location.search).has('flow'); // ?flow draws the stream's current

// The random layout, new each visit and on each reroll: which way the swell and the current run, the
// patterns' seed, the stream's boulders and bed, and the reef's coral.
const layout = () => {
  const heading = Math.random() * Math.PI * 2;
  return {
    DIR: [Math.cos(heading), Math.sin(heading)] as [number, number],
    SEED: [Math.random() * 100, Math.random() * 100],
    STONES: placeStones(CELL),
    POOLS: placePools(CELL),
    REEF: placeReef(CELL),
  };
};
let { DIR, SEED, STONES, POOLS, REEF } = layout();

// The stream's offscreen maps (passes in stream.glsl), all covering the larger of the screen and
// the window, so resizing the window, or a phone's address bar coming and going, doesn't have to
// start them again:
// - on the floor canvas, the bed, drawn once (BED_PASS), and the current at a quarter of the
//   resolution, worked out each frame for the caustics (CURRENT_PASS);
// - on the surface canvas, the foam (FOAM_STEP), in two textures that take turns: each step
//   reads one and writes the other.
const QUARTER = 4; // CSS px per texel of the current and foam maps
let area: [number, number] = [0, 0]; // CSS px the maps cover
const view = (): [number, number] => [area[0] / CELL, area[1] / CELL]; // ... in cells
type Target = { tex: WebGLTexture; fb: WebGLFramebuffer };
const target = (gl: WebGLRenderingContext): Target => ({ tex: gl.createTexture()!, fb: gl.createFramebuffer()! });
const size = (gl: WebGLRenderingContext, t: Target, w: number, h: number) => {
  gl.bindTexture(gl.TEXTURE_2D, t.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

const build = (gl: WebGLRenderingContext, frag: string) => {
  const prog = gl.createProgram()!;
  const shaders = (
    [
      [gl.VERTEX_SHADER, VERT],
      [gl.FRAGMENT_SHADER, frag],
    ] as const
  ).map(([type, src]) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    gl.attachShader(prog, s);
    return s;
  });
  gl.bindAttribLocation(prog, 0, 'p');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('water shader:', gl.getShaderInfoLog(shaders[1]) || gl.getProgramInfoLog(prog));
    return null;
  }
  return { prog, u: Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)])) };
};

// Starts the water on the page's canvases (see newtab.html): the floor under the fish, the surface
// over them, and the stream's leaves and bubbles and the pond's lilies on their own canvases. Returns
// the controls for the scene and time of day, which it eases between, or null without WebGL (the
// canvases stay empty).
export function startWater(start: { scene: Scene; time: Time }) {
  const layers = [...document.querySelectorAll<HTMLCanvasElement>('[data-water]')].flatMap((canvas) => {
    const gl = canvas.getContext('webgl', { antialias: false });
    if (!gl) return [];
    const progs = {} as Record<Scene, NonNullable<ReturnType<typeof build>>>;
    for (const name of NAMES) {
      const built = build(gl, PRELUDE + SCENES[name]);
      if (!built) return [];
      progs[name] = built;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one triangle covering the screen
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // while crossfading, two scenes add up, each scaled by its weight
    const layer = Number(canvas.dataset.water);
    // ponytail: the soft floor renders at 1 canvas px per CSS px and the surface's thin lines at
    // 1.5x (sharp enough on retina, at about half the cost of 2x) to keep laptops cool.
    const scale = layer ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
    const pass = (define: string) => build(gl, PRELUDE + `\n#define ${define}\n` + STREAM);
    const passes = layer ? { foamStep: pass('FOAM_STEP') } : { bedPass: pass('BED_PASS'), currentPass: pass('CURRENT_PASS') };
    if (Object.values(passes).some((p) => !p)) return [];
    return [
      {
        canvas,
        gl,
        progs,
        layer,
        scale,
        foamStep: 'foamStep' in passes ? passes.foamStep! : null,
        bedPass: 'bedPass' in passes ? passes.bedPass! : null,
        currentPass: 'currentPass' in passes ? passes.currentPass! : null,
        foam: layer ? [target(gl), target(gl)] : null, // which is current: `cur`
        cur: 0,
        bed: layer ? null : target(gl),
        current: layer ? null : target(gl),
        reef: layer ? null : target(gl), // the reef's coral, drawn once (reef.ts), on texture unit 2
      },
    ];
  });

  if (layers.length) {
    // Scene and time of day, also on <html> so the page can restyle.
    let { scene, time } = start;
    const weights = Object.fromEntries(NAMES.map((n) => [n, n === scene ? 1 : 0])) as Record<Scene, number>;
    let day = time === 'day' ? 1 : 0;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Let the fish feel the stream's current, fading in and out with the scene, and see its boulders.
    water.downstream = { x: DIR[0], y: -DIR[1] };
    water.speed = CURRENT * CELL;
    water.at = (x, y) => {
      const [vx, vy] = flow(STONES, POOLS, DIR, x / CELL, (window.innerHeight - y) / CELL, performance.now() / 1000);
      return [vx * CELL * weights.stream, -vy * CELL * weights.stream];
    };
    // The uniforms every program takes.
    const common = (gl: WebGLRenderingContext, u: Record<string, WebGLUniformLocation | null>, t: number, o: { weight: number; layer: number; cell: number; res: [number, number]; dt?: number }) => {
      gl.uniform1f(u.u_time, t);
      gl.uniform1f(u.u_day, day);
      gl.uniform1f(u.u_weight, o.weight);
      gl.uniform1f(u.u_layer, o.layer);
      gl.uniform1f(u.u_cell, o.cell);
      gl.uniform2f(u.u_res, ...o.res);
      gl.uniform2f(u.u_dir, ...DIR);
      gl.uniform2fv(u.u_seed, SEED);
      gl.uniform4fv(u.u_stones, STONES.data);
      gl.uniform1i(u.u_stoneCount, STONES.count);
      gl.uniform4fv(u.u_pools, POOLS.data);
      gl.uniform1i(u.u_poolCount, POOLS.count);
      gl.uniform1f(u.u_current, CURRENT);
      gl.uniform1f(u.u_debug, DEBUG_FLOW ? 1 : 0);
      gl.uniform2f(u.u_foamView, ...view());
      gl.uniform2f(u.u_bedView, ...view());
      gl.uniform1f(u.u_dt, o.dt ?? 0);
      gl.uniform1i(u.u_foam, 0); // texture units
      gl.uniform1i(u.u_bed, 0);
      gl.uniform1i(u.u_flowMap, 1);
      gl.uniform1i(u.u_reef, 2);
    };
    type Layer = (typeof layers)[number];
    type Program = NonNullable<ReturnType<typeof build>>;
    // One pass of a program into a map, whose texels are `px` CSS px across.
    const render = (gl: WebGLRenderingContext, prog: Program, into: Target, px: number, t: number, dt = 0) => {
      const w = area[0] / px;
      const h = area[1] / px;
      gl.useProgram(prog.prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, into.fb);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      common(gl, prog.u, t, { weight: 1, layer: 0, cell: CELL / px, res: [w, h], dt });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    // One step of the foam: carried, faded, topped up (stream.glsl's FOAM_STEP).
    const stepFoam = (L: Layer, t: number, dt: number) => {
      if (!L.foam || !L.foamStep || !dt) return;
      L.gl.bindTexture(L.gl.TEXTURE_2D, L.foam[L.cur].tex);
      render(L.gl, L.foamStep, L.foam[1 - L.cur], QUARTER, t, dt);
      L.cur = 1 - L.cur;
    };
    const extras = () => ({
      surface: bubbles(document.querySelector<HTMLCanvasElement>('[data-bubbles]')!, document.querySelector<HTMLCanvasElement>('[data-leaves]')!, STONES, POOLS, DIR, CELL),
      pads: lilies(document.querySelector<HTMLCanvasElement>('[data-lilies]')!, CELL),
    });
    let { surface, pads } = extras();
    let drawn = performance.now();
    const draw = (now: number, ease = 0.15) => {
      // Ease towards the picked scene and time of day: about half a second at ~30 fps.
      day += ((time === 'day' ? 1 : 0) - day) * ease;
      for (const n of NAMES) weights[n] += ((n === scene ? 1 : 0) - weights[n]) * ease;
      const dt = Math.min((now - drawn) / 1000, 0.1);
      surface.draw(now / 1000, dt, weights.stream, day);
      pads.draw(now / 1000, weights.pond, day);
      water.share = weights.stream;
      water.pond = weights.pond;
      drawn = now;
      for (const layer of layers) {
        const { canvas, gl, progs, scale, foam, bed, current, currentPass } = layer;
        if (weights.stream >= 0.003) {
          stepFoam(layer, now / 1000, dt);
          if (current && currentPass) render(gl, currentPass, current, QUARTER, now / 1000);
        }
        if (foam) gl.bindTexture(gl.TEXTURE_2D, foam[layer.cur].tex);
        if (bed && current) {
          gl.bindTexture(gl.TEXTURE_2D, bed.tex);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, current.tex);
          gl.activeTexture(gl.TEXTURE0);
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (const n of NAMES) {
          if (weights[n] < 0.003) continue;
          const { prog, u } = progs[n];
          gl.useProgram(prog);
          common(gl, u, now / 1000, { weight: weights[n], layer: layer.layer, cell: CELL * scale, res: [canvas.width, canvas.height] });
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
      }
    };

    const show = () => {
      document.documentElement.dataset.scene = scene;
      document.documentElement.dataset.time = time;
      if (still) draw(last, 1); // no animation loop to ease it in
    };

    let last = performance.now();
    const resize = () => {
      surface.resize();
      pads.resize();
      water.rocks = Array.from({ length: STONES.count }, (_, i) => ({
        x: STONES.data[4 * i] * CELL,
        y: window.innerHeight - STONES.data[4 * i + 1] * CELL,
        r: STONES.data[4 * i + 2] * CELL,
      }));
      for (const { canvas, scale } of layers) {
        canvas.width = window.innerWidth * scale;
        canvas.height = window.innerHeight * scale;
      }
      // The maps only need making again if the window has outgrown them (they start screen-sized):
      // the bed is drawn, and the foam run on for 8 seconds so the stream opens foamy.
      const need = [Math.max(screen.width, window.innerWidth), Math.max(screen.height, window.innerHeight)].map((v) => Math.ceil(v / QUARTER) * QUARTER);
      if (need[0] > area[0] || need[1] > area[1]) {
        area = [need[0], need[1]];
        for (const layer of layers) {
          const { gl, foam, bed, current, bedPass, reef } = layer;
          for (const t of foam ?? []) size(gl, t, area[0] / QUARTER, area[1] / QUARTER);
          for (let k = 80; k > 0; k--) stepFoam(layer, last / 1000 - k * 0.1, 0.1);
          if (bed && current && bedPass) {
            size(gl, bed, area[0], area[1]);
            size(gl, current, area[0] / QUARTER, area[1] / QUARTER);
            render(gl, bedPass, bed, 1, 0);
          }
          if (reef) {
            gl.activeTexture(gl.TEXTURE2);
            size(gl, reef, area[0], area[1]);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // the canvas's top row is the window's top
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drawReef(REEF, area[0], area[1]));
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.activeTexture(gl.TEXTURE0);
          }
        }
      }
      draw(last, 0); // resizing clears the canvas
    };
    resize();
    window.addEventListener('resize', resize);
    show();

    if (!still) {
      // The water drifts slowly, so ~30 fps looks the same and costs half.
      const loop = (now: number) => {
        if (now - last >= 32) draw((last = now));
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    return {
      get scene() {
        return scene;
      },
      setScene(s: Scene) {
        scene = s;
        show();
      },
      setTime(t: Time) {
        time = t;
        show();
      },
      // A new random layout, and new fish (fish.ts watches water.generation), laid out while the
      // water and fish dip out for a moment. The maps are made again from scratch (area reset).
      reroll() {
        const go = () => {
          ({ DIR, SEED, STONES, POOLS, REEF } = layout());
          ({ surface, pads } = extras());
          water.downstream = { x: DIR[0], y: -DIR[1] };
          water.generation++;
          area = [0, 0];
          resize();
        };
        if (still) return go();
        document.documentElement.classList.add('rerolling');
        setTimeout(() => {
          go();
          document.documentElement.classList.remove('rerolling');
        }, 250);
      },
    };
  }
  return null;
}
