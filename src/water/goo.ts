// The foam's blobs (after css-tricks.com/gooey-effect), for beach.ts: where the surface's particles
// bunch up they fuse into blobs of foam with a crisp edge, casting a hard shadow down and to the
// right. The particles are drawn twice: sharp, on their own canvas, and here on `ctx`, small, to be
// blurred (at half the resolution: a blur loses nothing to it), then cut off hard where the blur thins
// out, at the screen's resolution, onto `canvas`, beneath the sharp ones. It was an SVG filter over
// the sharp canvas: run over the whole screen each frame, it cost more than all the water.
const SMALL = 0.5; // canvas px per CSS px the particles are blurred at
// CSS px: the blur (its standard deviation: 4 in all, with what the small canvas and stretching it
// back up add), and where the shadows fall.
const BLUR = 3.87;
const SHADOW = [3, 4];

const VERT = 'attribute vec2 p; varying vec2 uv; void main() { uv = 0.5 * p + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
// One way of a Gaussian blur, `sigma` texels across, `step` apart.
const BLUR_FRAG = `precision mediump float;
uniform sampler2D tex; uniform vec2 step; uniform float sigma; varying vec2 uv;
void main() {
  vec4 sum = vec4(0.0); float total = 0.0;
  for (int i = -6; i <= 6; i++) {
    float k = exp(-float(i * i) / (2.0 * sigma * sigma));
    sum += k * texture2D(tex, uv + float(i) * step);
    total += k;
  }
  gl_FragColor = sum / total;
}`;
// The blobs (as the SVG filter's colour matrix did: alpha 16a - 5, keeping the blur's colour), over
// their shadow (dark teal, 0.18 of theirs, cast by `shadow`).
const BLOB_FRAG = `precision mediump float;
uniform sampler2D tex; uniform vec2 shadow; varying vec2 uv;
float cut(float a) { return clamp(16.0 * a - 5.0, 0.0, 1.0); }
void main() {
  vec4 c = texture2D(tex, uv);
  float a = cut(c.a);
  float s = 0.18 * cut(texture2D(tex, uv - shadow).a);
  vec3 col = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  gl_FragColor = vec4(col * a, a) + vec4(0.0, 0.1, 0.16, 1.0) * s * (1.0 - a);
}`;

// One per canvas, however often the layout's rerolled (each would hold its own textures).
const made = new WeakMap<HTMLCanvasElement, ReturnType<typeof make>>();
export const blobs = (canvas: HTMLCanvasElement) => {
  if (!made.has(canvas)) made.set(canvas, make(canvas));
  return made.get(canvas)!;
};

function make(canvas: HTMLCanvasElement) {
  const small = document.createElement('canvas');
  const ctx = small.getContext('2d')!;
  const gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true });
  if (!gl) return null;
  const build = (frag: string) => {
    const prog = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VERT],
      [gl.FRAGMENT_SHADER, frag],
    ] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      gl.attachShader(prog, s);
    }
    gl.bindAttribLocation(prog, 0, 'p');
    gl.linkProgram(prog);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    return { prog, tex: u('tex'), step: u('step'), sigma: u('sigma'), shadow: u('shadow') };
  };
  const blur = build(BLUR_FRAG);
  const blob = build(BLOB_FRAG);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one triangle covering it all
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // blurred premultiplied, so no dark fringes
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // the canvas the right way up, for GL
  // The particles, uploaded (a), blurred across into (b), then down back into (a).
  const [a, b] = [0, 1].map(() => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fb = gl.createFramebuffer()!;
    return { tex, fb };
  });
  let [w, h] = [0, 0]; // CSS px

  const pass = (p: ReturnType<typeof build>, from: WebGLTexture, into: WebGLFramebuffer | null, vw: number, vh: number) => {
    gl.useProgram(p.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, into);
    gl.viewport(0, 0, vw, vh);
    gl.bindTexture(gl.TEXTURE_2D, from);
    gl.uniform1i(p.tex, 0);
  };

  return {
    ctx, // the particles go on this (in CSS px), between clear() and draw()
    resize(cw: number, ch: number, dpr: number) {
      [w, h] = [cw, ch];
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      small.width = Math.ceil(w * SMALL);
      small.height = Math.ceil(h * SMALL);
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, small.width, small.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.tex, 0);
      gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, small.width, small.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    clear() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, small.width, small.height);
      ctx.setTransform(SMALL, 0, 0, SMALL, 0, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    draw() {
      const [sw, sh] = [small.width, small.height];
      gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, small);
      gl.disable(gl.BLEND);
      pass(blur, a.tex, b.fb, sw, sh);
      gl.uniform1f(blur.sigma, BLUR * SMALL);
      gl.uniform2f(blur.step, 1 / sw, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(blur, b.tex, a.fb, sw, sh);
      gl.uniform2f(blur.step, 0, 1 / sh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(blob, a.tex, null, canvas.width, canvas.height);
      gl.uniform2f(blob.shadow, SHADOW[0] / w, -SHADOW[1] / h); // down the screen is down the texture
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
