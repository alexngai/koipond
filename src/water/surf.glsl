// The surf (surf.ts) as the shaders read it, shared by the beach (beach.glsl) and the reef
// (ocean.glsl), each with its own grid: worked out once per layout, so that each frame only has to look
// up where the crests are now. surf.ts: surfAt() has the same sums for what rides them (beach.ts):
// change both together.
uniform sampler2D u_surfTex; // surf.ts: packSurf(): four tiles stacked, half floats
uniform vec4 u_surfGrid;     // the grid's first point (u, v: m in the beach's frame), m between points, and the screen's height (m)
uniform vec4 u_surfSize;     // points along and across the grid, and the swell's period (s) and seed
uniform vec4 u_surfFrame;    // the beach's frame: the screen's middle (m from its top left), and the way up the beach

#define LIFT 10.0 // surf.ts: LIFT
#define GAMMA 0.78
#define CSS 220.0 // CSS px per cell (scene.ts: CELL)

// The shore's frame (surf.ts: shoreFrame): m from the screen's top left to (along the shore,
// towards it) from the screen's middle.
vec2 shore(vec2 m) {
  vec2 rel = m - u_surfFrame.xy;
  return vec2(dot(rel, vec2(-u_surfFrame.w, u_surfFrame.z)), dot(rel, u_surfFrame.zw));
}
// Tile k of the grid at g (in the beach's frame).
vec4 tile(vec2 g, float k) {
  vec2 n = u_surfSize.xy;
  vec2 uv = ((g - u_surfGrid.xy) / u_surfGrid.z + 0.5) / n;
  uv.y = clamp(uv.y, 0.5 / n.y, 1.0 - 0.5 / n.y);
  return texture2D(u_surfTex, vec2(uv.x, (uv.y + k) / 4.0));
}
float waveSize(float n) {
  return 1.0 + 0.18 * sin(2.39996 * n + u_surfSize.w) + 0.14 * sin(0.8976 * n + 1.7 * u_surfSize.w);
}
// surf.ts: profile()
float profile(float th, float ratio) {
  float near = clamp(ratio, 0.0, 1.0);
  float phi = th - 0.6 * near * near * (1.0 - cos(th));
  // (Clamped: in a trough cos() can come back a hair under -1 on the GPU, and pow() of a negative
  // number is NaN, which turned whole pixels black through the tilt.)
  return 2.0 * pow(max(0.5 + 0.5 * cos(phi), 0.0), 1.0 + 3.0 * near * near) - 1.0;
}

struct Surf { float th, H, run, foam, xi, d, reef, fromEdge, ratio, shape, z; }; // fromEdge: m out from the water's edge
// surf.ts: surfAt()
Surf surfAt(vec2 m) {
  Surf s;
  vec2 g = shore(m);
  vec4 a = tile(g, 0.0);
  s.d = a.y;
  s.reef = a.z;
  s.fromEdge = a.w;
  float ph = u_time / u_surfSize.z - a.x + 0.04 * sin(g.x * 0.05 + u_time * 0.1 + u_surfSize.w);
  float n = floor(ph + 0.5), f = ph - n;
  float size = waveSize(n);
  size = mix(size, 0.5 * (size + waveSize(n + 1.0)), smoothstep(0.35, 0.5, f));
  size = mix(size, 0.5 * (waveSize(n) + waveSize(n - 1.0)), 1.0 - smoothstep(-0.5, -0.35, f));
  float c = clamp(size < 1.0 ? (size - 0.7) / 0.3 : 1.0 + (size - 1.0) / 0.35, 0.0, 2.0);
  float c0 = min(floor(c), 1.0);
  vec4 v = mix(tile(g, 1.0 + c0), tile(g, 2.0 + c0), c - c0);
  s.H = v.x;
  s.run = v.y;
  s.foam = v.z;
  s.xi = v.w;
  s.th = 6.2831853 * f;
  s.ratio = s.H / max(GAMMA * s.d, 0.05);
  s.shape = profile(s.th, s.ratio);
  s.z = LIFT * 0.5 * s.H * s.shape;
  return s;
}

