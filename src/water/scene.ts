// Water around the fish (fish.ts): a floor under them and a surface over them, drawn by the current
// scene's shader (*.glsl). Every scene has a day and a night palette.
import PRELUDE from './prelude.glsl?raw';
import OCEAN from './ocean.glsl?raw';
import STREAM from './stream.glsl?raw';
import POND from './pond.glsl?raw';
import BEACH from './beach.glsl?raw';
import SURF_GLSL from './surf.glsl?raw';
import GLINTS from './glints.glsl?raw';
import { CURRENT, flow, water, placeStones, placePools, bubbles } from './stream';
import { placeReef, drawReef, drawReefHeight, placeReefSwell, reefBed } from './reef';
import { lilies } from './pond';
import { spray } from './beach';
import { shore } from './shore';
import { placeSurf, packSurf, buildSurf, groundAt, surfAt, TILT, WORLD_H, type SurfGrid, type Swell } from './surf';
import { quality } from './quality';
import { stage } from './stage';

// The reef and the beach both ride the surf model (surf.ts, surf.glsl), each on its own grid.
const SCENES = { ocean: SURF_GLSL + OCEAN, stream: STREAM, pond: POND, beach: SURF_GLSL + BEACH };
export type Scene = keyof typeof SCENES;
export type Time = 'day' | 'night';
export const NAMES = Object.keys(SCENES) as Scene[];
const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const UNIFORMS = ['u_time', 'u_cell', 'u_layer', 'u_day', 'u_weight', 'u_res', 'u_dir', 'u_seed', 'u_stones', 'u_stoneCount', 'u_pools', 'u_poolCount', 'u_current', 'u_debug', 'u_foamView', 'u_dt', 'u_foam', 'u_bed', 'u_flowMap', 'u_bedView', 'u_reef', 'u_surfTex', 'u_surfGrid', 'u_surfSize', 'u_surfFrame', 'u_rocks', 'u_bump', 'u_scenes', 'u_reefBump'];
const CELL = 220; // CSS px across a foam cell
const DEBUG_FLOW = new URLSearchParams(location.search).has('flow'); // ?flow draws the stream's current

// The random layout, new each visit and on each reroll: which way the swell and the current run, the
// patterns' seed, the stream's boulders and bed, the reef's coral and its swell, and the beach's
// seabed and swell.
const layout = () => {
  const heading = Math.random() * Math.PI * 2;
  const DIR = [Math.cos(heading), Math.sin(heading)] as [number, number];
  return {
    DIR,
    SEED: [Math.random() * 100, Math.random() * 100],
    STONES: placeStones(CELL),
    POOLS: placePools(CELL),
    REEF: placeReef(CELL),
    REEF_SWELL: placeReefSwell(DIR),
    SURF: placeSurf(),
  };
};
let { DIR, SEED, STONES, POOLS, REEF, REEF_SWELL, SURF } = layout();

// The stream's offscreen maps (passes in stream.glsl), all covering the larger of the screen and
// the window, so resizing the window, or a phone's address bar coming and going, doesn't have to
// start them again:
// - on the floor canvas, the bed and its relief, drawn once (BED_PASS, HEIGHT_PASS), and the
//   current at a quarter of the resolution, worked out each frame for the caustics
//   (CURRENT_PASS);
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
// over them, and on their own canvases the stream's leaves and bubbles, the pond's lilies, the
// beach's and the reef's particles, and the beach's crab and gulls. Returns
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
    // 1.5x (sharp enough on retina, at about half the cost of 2x) to keep laptops cool; less of each
    // where frames come slowly (quality.ts).
    const scale = 1; // set by fit()
    const pass = (define: string) => build(gl, PRELUDE + `\n#define ${define}\n` + STREAM);
    const passes = layer ? { foamStep: pass('FOAM_STEP') } : { bedPass: pass('BED_PASS'), bumpPass: pass('HEIGHT_PASS'), currentPass: pass('CURRENT_PASS') };
    const rockPass = build(gl, PRELUDE + '\n#define ROCK_PASS\n' + SURF_GLSL + BEACH);
    if (Object.values(passes).some((p) => !p) || !rockPass) return [];
    return [
      {
        canvas,
        gl,
        progs,
        layer,
        scale,
        foamStep: 'foamStep' in passes ? passes.foamStep! : null,
        bedPass: 'bedPass' in passes ? passes.bedPass! : null,
        bumpPass: 'bumpPass' in passes ? passes.bumpPass! : null,
        currentPass: 'currentPass' in passes ? passes.currentPass! : null,
        foam: layer ? [target(gl), target(gl)] : null, // which is current: `cur`
        cur: 0,
        bed: layer ? null : target(gl),
        bump: layer ? null : target(gl), // the bed's relief, on texture unit 5
        current: layer ? null : target(gl),
        reef: layer ? null : target(gl), // the reef's coral, drawn once (reef.ts), on texture unit 2
        reefBump: layer ? null : target(gl), // ... and how high it stands, on texture unit 6
        reefSurf: gl.createTexture()!, // the reef's surf (surf.ts), on texture unit 7, as half floats
        surf: gl.createTexture()!, // the waves' surf (surf.ts: packSurf()), on texture unit 3, as half floats
        rocks: target(gl), // the waves' rocks standing out of the water, drawn once (beach.glsl's ROCK_PASS), on texture unit 4
        rockPass,
        half: gl.getExtension('OES_texture_half_float'),
        halfLinear: gl.getExtension('OES_texture_half_float_linear'),
      },
    ];
  });

  // The caustics falling on the fish (glints.glsl), drawn each frame at half resolution on a canvas
  // of their own (off the page) and handed to fish.ts to paint onto them as an image that stays on
  // the GPU (copying the canvas itself into the fish's every frame cost a fifth of the frame rate);
  // where that can't be done, the canvas itself.
  const glints = (() => {
    if (!layers.length) return null;
    const canvas = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: !('transferToImageBitmap' in canvas) }) as WebGLRenderingContext | null;
    const prog = gl && build(gl, PRELUDE + GLINTS);
    if (!gl || !prog) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0, 0, 0, 0);
    return { canvas, gl, prog, surf: gl.createTexture()!, half: gl.getExtension('OES_texture_half_float'), halfLinear: gl.getExtension('OES_texture_half_float_linear') };
  })();

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
      const [vx, vy] = flow(STONES, POOLS, DIR, x / CELL, (stage.h - y) / CELL, performance.now() / 1000);
      return [vx * CELL * weights.stream, -vy * CELL * weights.stream];
    };
    // Which surf grid a program reads (surf.glsl), and on which texture unit.
    const surfUniforms = (gl: WebGLRenderingContext, u: Record<string, WebGLUniformLocation | null>, g: SurfGrid, s: Swell, unit: number) => {
      gl.uniform1i(u.u_surfTex, unit);
      gl.uniform4f(u.u_surfGrid, g.x0, g.y0, g.step, WORLD_H);
      gl.uniform4f(u.u_surfSize, g.nx, g.ny, s.period, s.seed);
      gl.uniform4f(u.u_surfFrame, g.frame.cx, g.frame.cy, g.frame.n[0], g.frame.n[1]);
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
      gl.uniform1i(u.u_rocks, 4);
      gl.uniform1i(u.u_bump, 5);
      surfUniforms(gl, u, flecks.grid, SURF, 3); // the beach's surf (surf.ts), on texture unit 3
      gl.uniform1i(u.u_reefBump, 6);
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
      flecks: spray(document.querySelector<HTMLCanvasElement>('[data-spray]')!, document.querySelector<HTMLCanvasElement>('[data-goo]')!, document.querySelector<HTMLCanvasElement>('[data-fused]')!, SURF, SURF, TILT, DEBUG_FLOW),
      // The reef's, riding its own swell (its grid worked out in resize()), seen straight down.
      reefFlecks: spray(document.querySelector<HTMLCanvasElement>('[data-reef-spray]')!, document.querySelector<HTMLCanvasElement>('[data-reef-goo]')!, document.querySelector<HTMLCanvasElement>('[data-reef-fused]')!, REEF_SWELL, () => reefGrid, 0),
      life: shore(document.querySelector<HTMLCanvasElement>('[data-shore]')!, document.querySelector<HTMLCanvasElement>('[data-sky]')!),
    });
    let { surface, pads, flecks, reefFlecks, life } = extras();
    // Let the fish in the beach scene keep to the sea: how deep the water is at a point (CSS px).
    water.depth = (x, y) => groundAt(flecks.grid, (x * WORLD_H) / stage.h, (y * WORLD_H) / stage.h).d;
    // ... and be seen through the waves as the seabed is (beach.glsl: shade()): lifted up the screen
    // by the height of the water over them, so they shift as each swell passes (CSS px).
    water.lift = (x, y) => {
      const k = WORLD_H / stage.h; // m per px
      return (-TILT * surfAt(flecks.grid, SURF, x * k, y * k, performance.now() / 1000).z) / k;
    };
    let drawn = performance.now();
    const draw = (now: number, ease = 0.15) => {
      // Ease towards the picked scene and time of day: about half a second at ~30 fps.
      day += ((time === 'day' ? 1 : 0) - day) * ease;
      for (const n of NAMES) weights[n] += ((n === scene ? 1 : 0) - weights[n]) * ease;
      const dt = Math.min((now - drawn) / 1000, 0.1);
      surface.draw(now / 1000, dt, weights.stream, day);
      pads.draw(now / 1000, weights.pond, day);
      flecks.draw(now / 1000, weights.beach, day);
      reefFlecks.draw(now / 1000, weights.ocean, day);
      life.draw(now / 1000, dt, weights.beach, day, flecks.grid);
      water.share = weights.stream;
      water.pond = weights.pond;
      water.beach = weights.beach;
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
          if (n === 'ocean' && reefGrid) surfUniforms(gl, u, reefGrid, REEF_SWELL, 7);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
      }
      // The glints on the fish.
      if (glints && quality.now.glints) {
        const { canvas, gl, prog } = glints;
        const [cw, ch] = [Math.ceil((stage.w * stage.zoom) / 2), Math.ceil((stage.h * stage.zoom) / 2)];
        if (canvas.width !== cw || canvas.height !== ch) [canvas.width, canvas.height] = [cw, ch];
        gl.viewport(0, 0, cw, ch);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog.prog);
        common(gl, prog.u, now / 1000, { weight: 1, layer: 0, cell: (CELL * stage.zoom) / 2, res: [cw, ch] });
        gl.uniform4f(prog.u.u_scenes, weights.ocean, weights.stream, weights.beach, weights.pond);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if ('transferToImageBitmap' in canvas) {
          if (water.glints instanceof ImageBitmap) water.glints.close();
          water.glints = canvas.transferToImageBitmap();
        } else water.glints = canvas;
      } else water.glints = undefined;
    };

    const show = () => {
      document.documentElement.dataset.scene = scene;
      document.documentElement.dataset.time = time;
      if (still) draw(last, 1); // no animation loop to ease it in
    };

    let last = performance.now();
    let uploaded: typeof flecks.grid | null = null; // the surf grid on the GPU
    // A surf grid onto texture unit `unit` in every canvas that reads it, as half floats.
    const upload = (g: SurfGrid, unit: number, which: (L: { surf: WebGLTexture; reefSurf?: WebGLTexture }) => WebGLTexture | undefined, into: { gl: WebGLRenderingContext; surf: WebGLTexture; reefSurf?: WebGLTexture; half: OES_texture_half_float | null; halfLinear: OES_texture_half_float_linear | null }[]) => {
      const data = packSurf(g);
      for (const L of into) {
        const { gl, half, halfLinear } = L;
        const tex = which(L);
        if (!half || !tex) continue;
        // ponytail: where half floats can't be filtered the grid is sampled nearest: blocky, but rare.
        const filter = halfLinear ? gl.LINEAR : gl.NEAREST;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, g.nx, g.ny * 4, 0, gl.RGBA, half.HALF_FLOAT_OES, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.activeTexture(gl.TEXTURE0);
      }
    };
    // The reef's: its coral's heights (read back once from drawReefHeight()), and the grid worked out
    // over them for the window's size.
    let reefHeights: { data: Uint8ClampedArray; w: number; h: number } | null = null;
    let reefGrid: SurfGrid | null = null;
    let reefFor = '';
    let rocked: typeof flecks.grid | null = null; // ... and the rocks drawn for it
    // The waves' rocks, drawn into their map (covering `area`, though worked out for the window).
    const drawRocks = (L: Layer) => {
      const { gl, rocks, rockPass } = L;
      gl.useProgram(rockPass.prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rocks.fb);
      gl.viewport(0, 0, area[0], area[1]);
      gl.disable(gl.BLEND);
      common(gl, rockPass.u, 0, { weight: 1, layer: L.layer, cell: CELL, res: [stage.w, stage.h] });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    // The floor's and the surface's canvases, at the resolution quality.ts allows.
    const fit = () => {
      for (const L of layers) {
        L.scale = L.layer ? stage.dpr(quality.now.surface) : quality.now.floor * stage.zoom;
        L.canvas.width = stage.w * L.scale;
        L.canvas.height = stage.h * L.scale;
      }
    };
    quality.onChange(() => {
      fit();
      draw(last, 0);
    });
    const resize = () => {
      surface.resize();
      pads.resize();
      flecks.resize();
      reefFlecks.resize();
      life.resize();
      if (flecks.grid !== uploaded) {
        uploaded = flecks.grid;
        upload(uploaded, 3, (L) => L.surf, [...layers, ...(glints ? [glints] : [])]);
      }
      // The reef's coral colonies, for its fish to live about (CSS px, y down).
      water.colonies = REEF.colonies.map((c) => ({ x: c.x, y: stage.h - c.y, r: c.r }));
      water.rocks = Array.from({ length: STONES.count }, (_, i) => ({
        x: STONES.data[4 * i] * CELL,
        y: stage.h - STONES.data[4 * i + 1] * CELL,
        r: STONES.data[4 * i + 2] * CELL,
      }));
      fit();
      // The maps only need making again if the window has outgrown them (they start screen-sized):
      // the bed is drawn, and the foam run on for 8 seconds so the stream opens foamy.
      const need = [Math.max(stage.sw, stage.w), Math.max(stage.sh, stage.h)].map((v) => Math.ceil(v / QUARTER) * QUARTER);
      if (need[0] > area[0] || need[1] > area[1]) {
        area = [need[0], need[1]];
        for (const layer of layers) {
          const { gl, foam, bed, bump, current, bedPass, bumpPass, reef } = layer;
          for (const t of foam ?? []) size(gl, t, area[0] / QUARTER, area[1] / QUARTER);
          for (let k = 80; k > 0; k--) stepFoam(layer, last / 1000 - k * 0.1, 0.1);
          if (bed && current && bedPass) {
            size(gl, bed, area[0], area[1]);
            size(gl, current, area[0] / QUARTER, area[1] / QUARTER);
            render(gl, bedPass, bed, 1, 0);
            if (bump && bumpPass) {
              gl.activeTexture(gl.TEXTURE5);
              size(gl, bump, area[0], area[1]);
              gl.activeTexture(gl.TEXTURE0);
              render(gl, bumpPass, bump, 1, 0);
            }
          }
          gl.activeTexture(gl.TEXTURE4);
          size(gl, layer.rocks, area[0], area[1]);
          gl.activeTexture(gl.TEXTURE0);
          rocked = null;
          if (reef) {
            gl.activeTexture(gl.TEXTURE2);
            size(gl, reef, area[0], area[1]);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // the canvas's top row is the window's top
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, drawReef(REEF, area[0], area[1]));
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.activeTexture(gl.TEXTURE0);
          }
        }
        // The reef's heights: for the floor (the caustics drape over the coral) and the swell.
        const heights = drawReefHeight(REEF, area[0], area[1]);
        reefHeights = { data: heights.getContext('2d')!.getImageData(0, 0, area[0], area[1]).data, w: area[0], h: area[1] };
        for (const { gl, reefBump } of layers) {
          if (!reefBump) continue;
          gl.activeTexture(gl.TEXTURE6);
          size(gl, reefBump, area[0], area[1]);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, heights);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.activeTexture(gl.TEXTURE0);
        }
      }
      // The reef's surf, worked out again for a new layout or window size.
      const key = `${stage.w}x${stage.h}`;
      if (reefHeights && (reefFor !== key || !reefGrid)) {
        reefFor = key;
        const { data, w, h } = reefHeights;
        reefGrid = buildSurf(REEF_SWELL, stage.w, stage.h, reefBed(data, w, h));
        upload(reefGrid, 7, (L) => L.reefSurf, layers);
      }
      if (rocked !== flecks.grid) {
        rocked = flecks.grid;
        for (const layer of layers) drawRocks(layer);
        // ... and where they hide the flecks behind them (the surface's map, read back once).
        const L = layers.find((l) => l.layer);
        if (L) {
          const [w, h] = [Math.min(stage.w, area[0]), Math.min(stage.h, area[1])];
          const data = new Uint8Array(w * h * 4);
          L.gl.bindFramebuffer(L.gl.FRAMEBUFFER, L.rocks.fb);
          L.gl.readPixels(0, 0, w, h, L.gl.RGBA, L.gl.UNSIGNED_BYTE, data);
          L.gl.bindFramebuffer(L.gl.FRAMEBUFFER, null);
          flecks.rocks = { w, data };
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
        quality.settle(); // the crossfade's two scenes at once aren't a slow machine
        scene = s;
        show();
      },
      setTime(t: Time) {
        quality.settle();
        time = t;
        show();
      },
      // A new random layout, and new fish (fish.ts watches water.generation), laid out while the
      // water and fish dip out for a moment. The maps are made again from scratch (area reset).
      reroll() {
        quality.settle(3000);
        const go = () => {
          ({ DIR, SEED, STONES, POOLS, REEF, REEF_SWELL, SURF } = layout());
          reefGrid = null;
          ({ surface, pads, flecks, reefFlecks, life } = extras());
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
