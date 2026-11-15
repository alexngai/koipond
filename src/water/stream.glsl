// Stream: clear water running over a pebbly bed and boulders, in the ocean's flat style: solid
// fills, hard offset shadows and caustic lines, no shading or texture. The current (flow()) parts
// around the boulders and sheds eddies behind them; for now it shows in the caustics it carries.
// Foam and bubbles come next.
#define MAX_STONES 32 // matches scene.ts
uniform vec4 u_stones[MAX_STONES]; // x, y, radius (cells), random seed
uniform int u_stoneCount;
#define MAX_POOLS 16 // matches stream.ts
uniform vec4 u_pools[MAX_POOLS]; // hollows (+) and rises (-) in the bed: x, y, radius (cells), amount
uniform int u_poolCount;
uniform float u_debug; // 1 with ?flow in the URL: draw the current as arrows
uniform sampler2D u_foam; // the surface foam (see foamStep), only on the surface canvas
uniform vec2 u_foamView;  // how much of the stream the foam map covers, in cells (the window)
uniform float u_dt;       // seconds since the last foam step
uniform sampler2D u_bed;     // the bed, drawn once (BED_PASS): colour, and depth in alpha
uniform sampler2D u_flowMap; // the current at quarter resolution (CURRENT_PASS): velocity / 3 + 0.5
uniform vec2 u_bedView;      // how much of the stream those two maps cover, in cells
uniform float u_current; // cells per second, along u_dir: set per visit by stream.ts
#define CURRENT u_current

#define GAP vec3(0.30, 0.37, 0.42) // the shadowy blue-grey gaps between pebbles

vec3 hsv(float h, float s, float v) {
  return v * mix(vec3(1.0), clamp(abs(fract(h + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0), s);
}

// A pebble per Voronoi cell, packed close like a lake shore: a disc around the cell's point,
// trimmed where it meets its neighbours. Mostly pale blue-greys and whites, with about one in six a
// warm amber, peach or rust. Returns its colour and coverage.
vec4 pebble(vec2 p, float scale) {
  p *= scale;
  vec2 n = floor(p), f = fract(p), id = n;
  float d1 = 8.0, d2 = 8.0;
  for (int k = 0; k < 9; k++) {
    vec2 g = vec2(float(k - k / 3 * 3 - 1), float(k / 3 - 1));
    float d = length(g + hash(n + g) - f);
    if (d < d1) { d2 = d1; d1 = d; id = n + g; } else if (d < d2) d2 = d;
  }
  vec2 h = hash(id + 31.7), k = hash(id + 77.1);
  float px = scale / u_cell; // one canvas pixel, in this layer's units
  float cover = smoothstep(0.06, 0.06 + 2.0 * px, d2 - d1) * smoothstep(0.0, px, 0.42 + 0.16 * h.y - d1);
  vec3 c = fract(h.x * 13.0 + k.x * 7.0) > 0.83 ? hsv(0.03 + 0.08 * h.x, mix(0.35, 0.6, k.x), mix(0.62, 0.88, k.y))
                      : hsv(0.55 + 0.06 * h.x, mix(0.03, 0.14, k.x), mix(0.58, 0.9, k.y));
  return vec4(c, cover);
}

// How far p is outside a lumpy, stretched stone, in units of its radius (negative inside).
float stone(vec2 p, vec4 s) {
  vec2 h = hash(vec2(s.w, 7.1));
  float a = 6.2831 * h.x;
  vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a)) * (p - s.xy) / s.z;
  q.x *= 0.75 + 0.5 * h.y;
  float ang = atan(q.y, q.x + 1e-5);
  return length(q) - 1.0 - 0.07 * sin(3.0 * ang + 20.0 * h.x) - 0.04 * sin(5.0 * ang + 30.0 * h.y);
}

vec3 stoneColor(vec4 s) {
  vec2 h = hash(vec2(s.w, 3.3)); // the pebbles' colours, a step darker
  return fract(h.x * 13.0 + h.y * 7.0) > 0.83
    ? hsv(0.03 + 0.08 * h.x, mix(0.35, 0.6, h.y), mix(0.5, 0.66, h.y))
    : hsv(0.55 + 0.06 * h.x, mix(0.03, 0.14, h.y), mix(0.46, 0.64, fract(h.x * 7.0)));
}

float tanh1(float x) { // GLSL ES 1.0 has no tanh
  float e = exp(2.0 * clamp(x, -9.0, 9.0));
  return (e - 1.0) / (e + 1.0);
}

// How deep the water is at p (0 shallow to 1 deep): broad smooth hollows and rises in the bed,
// shelving up around each boulder to its top, the shallowest water of all. stream.ts has the
// same (depth()) for the bubbles and fish: change both together.
float depthAt(vec2 p) {
  float d = 0.6;
  for (int i = 0; i < MAX_POOLS; i++) {
    if (i >= u_poolCount) break;
    vec2 o = p - u_pools[i].xy;
    d += u_pools[i].w * exp(-dot(o, o) / (u_pools[i].z * u_pools[i].z));
  }
  for (int i = 0; i < MAX_STONES; i++) {
    if (i >= u_stoneCount) break;
    vec2 o = p - u_stones[i].xy;
    d -= 0.6 * exp(-0.25 * dot(o, o) / (u_stones[i].z * u_stones[i].z));
  }
  return smoothstep(0.1, 0.9, d);
}

// Shallow water runs a little faster and deep water a little slower, as the same flow squeezes
// through less or more depth: subtly, from about 1.14x over the shallowest bed to about 0.93x in
// the deepest pools (1x at a typical depth).
float pace(float depth) {
  return 1.0 / (0.88 + 0.2 * depth);
}

// The water's velocity at p, in cells per second. Worked out in each boulder's frame (x
// downstream, y across) and summed. Every part comes from a stream function or a vortex, so the
// water is never squeezed into or out of anywhere: bubbles swirl round and carry on, never pile up.
// - The current parts around it: ideal flow past a cylinder, slow in front and fast at the sides,
//   easing smoothly (no hard edge at the rim) into a slowed flow over its submerged top.
// - Slack water behind it: a wake that builds up gently and fills back in downstream, the water
//   drawn in from the sides as it does.
// - Eddies it sheds every few seconds, alternately off each side, broad and gentle, that drift
//   away spreading and fading (a vortex street).
// Each boulder's influence fades out smoothly towards the edge of the box it is worked out in.
// The whole of it then runs faster in the shallows and slower in the pools (pace()).
// stream.ts has the same maths for the bubbles (and the fish): change both together.
#define ALPHA 0.8 // how much each boulder blocks the current
vec2 flowAt(vec2 p, float depth) {
  vec2 across = vec2(-u_dir.y, u_dir.x);
  vec2 v = vec2(CURRENT, 0.0);
  for (int i = 0; i < MAX_STONES; i++) {
    if (i >= u_stoneCount) break;
    vec4 s = u_stones[i];
    float R = s.z;
    vec2 q = vec2(dot(p - s.xy, u_dir), dot(p - s.xy, across));
    if (q.x < -5.0 * R || q.x > 12.0 * R || abs(q.y) > 5.0 * R) continue;
    // Around it: stream function -ALPHA U y f(r^2) with f = R^2 / sqrt(r^4 + R^4), which is
    // R^2 / r^2 (flow past a cylinder) away from it and eases to 1 (a slowed current) over its top.
    float s2 = dot(q, q), R2 = R * R, den = s2 * s2 + R2 * R2;
    float f = R2 / sqrt(den), df = -R2 * s2 / (den * sqrt(den));
    vec2 b = -ALPHA * CURRENT * vec2(f + 2.0 * q.y * q.y * df, -2.0 * q.x * q.y * df);
    // The wake: stream function -U g(x) w tanh(y / w), g rising behind the boulder then decaying.
    float w = 1.2 * R;
    float t = clamp((q.x - 0.3 * R) / (2.0 * R), 0.0, 1.0), rise = t * t * (3.0 - 2.0 * t);
    float decay = exp(-q.x / (4.0 * R));
    float g = 0.6 * rise * decay;
    float dg = 0.6 * decay * (6.0 * t * (1.0 - t) / (2.0 * R) - rise / (4.0 * R));
    float th = tanh1(q.y / w);
    b += CURRENT * vec2(-g * (1.0 - th * th), dg * w * th);
    // Eddies: one shed every T seconds (bigger boulders, slower), the latest two still turning.
    float T = 6.0 * R / CURRENT;
    float phase = u_time / T + s.w;
    for (int e = 0; e < 2; e++) {
      float n = floor(phase) - float(e);
      float age = (phase - n) * T;
      float side = 2.0 * mod(n, 2.0) - 1.0;
      vec2 d = q - vec2(1.1 * R + 0.7 * CURRENT * age, 0.45 * R * side);
      float core = 0.6 * R + 0.1 * age;
      float spin = -side * 1.6 * CURRENT * R * exp(-age / (1.5 * T))
                 * smoothstep(0.0, 0.3 * T, age) * smoothstep(2.0 * T, 1.6 * T, age);
      float d2 = dot(d, d) + 1e-5;
      b += spin / 6.2831 * vec2(-d.y, d.x) / d2 * (1.0 - exp(-d2 / (core * core)));
    }
    v += b * (1.0 - smoothstep(3.5 * R, 5.0 * R, -q.x)) * (1.0 - smoothstep(9.0 * R, 12.0 * R, q.x))
           * (1.0 - smoothstep(3.5 * R, 5.0 * R, abs(q.y)));
  }
  return (u_dir * v.x + across * v.y) * pace(depth);
}
vec2 flow(vec2 p) {
  return flowAt(p, depthAt(p));
}

// Where foam forms, per second: water piling up against the upstream face and sides of each
// boulder and breaking round it, and the churn in its wake; in gusts, so it comes off in clumps.
float churn(vec2 p) {
  vec2 across = vec2(-u_dir.y, u_dir.x);
  float f = 0.0;
  for (int i = 0; i < MAX_STONES; i++) {
    if (i >= u_stoneCount) break;
    vec4 s = u_stones[i];
    vec2 q = vec2(dot(p - s.xy, u_dir), dot(p - s.xy, across)) / s.z; // in its radii
    if (q.x < -2.0 || q.x > 8.0 || abs(q.y) > 3.0) continue;
    float r = length(q);
    f += exp(-pow((r - 1.07) / 0.11, 2.0)) * (0.6 - 0.4 * q.x / max(r, 1e-3)); // round the rim
    f += 0.5 * exp(-q.y * q.y / 0.5) * smoothstep(0.8, 1.6, q.x) * exp(-q.x / 4.0); // the wake
  }
  return f * smoothstep(0.45, 0.75, 0.5 + noise(p * 2.5 + u_time * vec2(0.6, -0.4)).x + 0.5 * noise(p * 6.0 - u_time).y);
}

// Foam rides the current but also drifts in towards the line down the middle of each wake (the
// slack water behind a boulder), the way real foam gathers there. Only the foam does this: unlike
// the current it isn't conserved, so it's kept out of flow() and the bubbles.
vec2 gather(vec2 p) {
  vec2 across = vec2(-u_dir.y, u_dir.x);
  float v = 0.0;
  for (int i = 0; i < MAX_STONES; i++) {
    if (i >= u_stoneCount) break;
    vec4 s = u_stones[i];
    vec2 q = vec2(dot(p - s.xy, u_dir), dot(p - s.xy, across)) / s.z;
    if (q.x < 0.5 || q.x > 12.0 || abs(q.y) > 4.0) continue;
    v -= 0.25 * CURRENT * tanh1(q.y) * exp(-q.y * q.y / 4.0) * smoothstep(1.0, 2.0, q.x) * exp(-q.x / 8.0);
  }
  return across * v;
}

// Caustics carried by the current: two copies of the pattern, each pushed along the flow and
// reset every cycle, half a cycle apart and crossfaded so neither reset ever shows (a flow map).
float flowingCaustics(vec2 p, vec2 v) {
  float t = u_time / 2.0; // 2 s cycles
  float a = fract(t), b = fract(t + 0.5);
  float c1 = caustics(p - v * a * 2.0 + 7.31 * floor(t), 0.024);
  float c2 = caustics(p - v * b * 2.0 + 7.31 * floor(t + 0.5) + 3.1, 0.024);
  return mix(c1, c2, abs(1.0 - 2.0 * a));
}

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0));
}

// Debug: an arrow per grid square, as long as the water there is fast (full current = 0.2 cells).
float arrows(vec2 p) {
  float g = 0.25, px = 1.0 / u_cell;
  vec2 c = (floor(p / g) + 0.5) * g;
  vec2 v = flow(c) / CURRENT * g * 0.4;
  float d = min(segment(p, c - v, c + v) - 0.5 * px, length(p - c - v) - 2.5 * px);
  return smoothstep(px, 0.0, d);
}

#if defined(FOAM_STEP)
// One step of the surface foam, on a map a quarter of the window's resolution: each point takes
// the foam from where its water just came from, which fades a little, and new foam forms where
// the water churns. (8-bit, so the fade is dithered or faint foam would never quite go.)
vec4 shade(vec2 p) {
  vec2 from = (p - (flow(p) + gather(p)) * u_dt) / u_foamView;
  float inside = step(0.0, from.x) * step(from.x, 1.0) * step(0.0, from.y) * step(from.y, 1.0);
  float f = texture2D(u_foam, from).r * inside; // none drifts in from off screen
  f = f * exp(-u_dt / 6.0) + u_dt * 0.85 * churn(p);
  f += (hash(gl_FragCoord.xy + fract(u_time * 7.3) * vec2(57.0, 113.0)).x - 0.5) / 255.0;
  return vec4(clamp(f, 0.0, 1.0), 0.0, 0.0, 1.0);
}
#elif defined(CURRENT_PASS)
// The current at a quarter of the floor's resolution, worked out once a frame for the caustics to
// read (worked out at every pixel, it was nearly half the floor's cost).
vec4 shade(vec2 p) {
  return vec4(flow(p) / 3.0 + 0.5, 0.0, 1.0);
}
#elif defined(BED_PASS)
// The bed, drawn once since it never changes: pebbles, boulders and their shadows, tinted by the
// water over them, with that depth in alpha for the caustics.
vec4 shade(vec2 p) {
  // Small pebbles down in the gaps, larger ones packed on top.
  vec2 b = p + u_seed;
  vec4 peb = pebble(b + 40.0, 8.0);
  vec3 col = mix(GAP, peb.rgb * 0.8, peb.a);
  peb = pebble(b, 3.5);
  col = mix(col, peb.rgb, peb.a);
  float depth = depthAt(p);
  // Boulders (the current parts around them), each with a hard shadow cast down and to the right.
  for (int i = 0; i < MAX_STONES; i++) {
    if (i >= u_stoneCount) break;
    vec4 s = u_stones[i];
    vec2 o = p - s.xy;
    if (dot(o, o) > 3.0 * s.z * s.z) continue; // too far for the stone or its shadow to reach
    float px = 1.0 / (u_cell * s.z);         // one canvas pixel, in stone radii
    col *= 1.0 - 0.4 * smoothstep(px, -px, stone(p + vec2(-0.3, 0.3) * s.z, s));
    col = mix(col, stoneColor(s), smoothstep(px, -px, stone(p, s)));
  }
  // Seen through the water: clear and pale cyan in the shallows, deepening to teal.
  col = mix(col, mix(vec3(0.66, 0.88, 0.88), vec3(0.04, 0.44, 0.54), depth), 0.2 + 0.65 * depth);
  return vec4(col, depth);
}
#else
vec4 shade(vec2 p) {
  if (u_layer > 0.5) {
    // Surface: the foam the current carries (see FOAM_STEP above), flat with crisp edges, and its
    // hard shadow on the bed, cast down and to the right.
    vec2 uv = p / u_foamView;
    float a = smoothstep(0.3, 0.32, texture2D(u_foam, uv).r) * mix(0.55, 0.9, u_day);
    float sh = smoothstep(0.3, 0.32, texture2D(u_foam, uv - vec2(0.1, -0.14) / u_foamView).r) * (1.0 - a) * 0.22;
    return vec4(mix(vec3(0.5, 0.58, 0.66), vec3(0.95, 0.98, 1.0), u_day) * a + vec3(0.02, 0.07, 0.09) * sh, a + sh);
  }
  // The floor: the bed (BED_PASS) and thin lines of light over it, carried by the current
  // (CURRENT_PASS) and strongest where the bed is closest to the ripples; cool and faint by
  // moonlight, warm sunlight by day.
  vec4 bed = texture2D(u_bed, p / u_bedView);
  vec2 v = (texture2D(u_flowMap, p / u_bedView).rg - 0.5) * 3.0;
  vec3 col = bed.rgb + mix(vec3(0.85, 0.96, 0.88) * 0.22, vec3(1.0, 0.9, 0.62) * 0.22, u_day)
           * flowingCaustics(p, v) * mix(1.4, 0.6, bed.a);
  col *= mix(vec3(0.24, 0.30, 0.38), vec3(1.0), u_day); // moonlit at night
  if (u_debug > 0.5) col = mix(col, vec3(1.0, 0.25, 0.2), arrows(p));
  return vec4(col, 1.0);
}
#endif
