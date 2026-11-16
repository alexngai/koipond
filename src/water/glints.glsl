// Glints: the caustics falling on the fish, for fish.ts to paint onto them (only where a fish
// is), worked out each frame at half resolution on a canvas of their own (scene.ts). A fish
// swims above the bottom, so the light falling on it would have fallen further down and to the
// right, as far as its shadow: the pattern there, in each scene's own, less focused this much
// nearer the surface (broader, softer, fainter).
uniform vec4 u_scenes;       // how much of the reef, the stream, the beach and the pond is showing
uniform float u_current;     // the stream's speed (stream.glsl)
uniform sampler2D u_surfTex; // the beach's surf (beach.glsl), for how deep its water is
uniform vec4 u_surfGrid;
uniform vec4 u_surfSize;
uniform vec4 u_surfFrame;
#define CSS 220.0 // CSS px per cell (scene.ts: CELL)
#define SHADOW (vec2(30.0, -42.0) / CSS) // the fish's shadow (fish.ts), in cells

// How deep the beach's water is at p, m (beach.glsl: shade(), shore(), tile()).
float beachDepth(vec2 p) {
  float hpx = u_res.y / u_cell * CSS;
  vec2 ms = vec2(p.x, u_res.y / u_cell - p.y) * CSS * u_surfGrid.w / hpx;
  vec2 rel = ms - u_surfFrame.xy;
  vec2 g = vec2(dot(rel, vec2(-u_surfFrame.w, u_surfFrame.z)), dot(rel, u_surfFrame.zw));
  vec2 n = u_surfSize.xy;
  vec2 uv = ((g - u_surfGrid.xy) / u_surfGrid.z + 0.5) / n;
  uv.y = clamp(uv.y, 0.5 / n.y, 1.0 - 0.5 / n.y);
  return texture2D(u_surfTex, vec2(uv.x, uv.y / 4.0)).y;
}

vec4 shade(vec2 p) {
  // Each scene's in its own light, as on its bottom: cool, nearly white over the reef and the beach
  // (the fish there are saturated by day: fish.ts), warm over the stream, warm green and faint
  // in the pond.
  vec2 q = p + SHADOW;
  vec4 c = vec4(0.0); // light (premultiplied), how much
  if (u_scenes.x > 0.003) c += u_scenes.x * 0.5 * caustics(q, 0.08) * vec4(0.94, 0.98, 1.0, 1.0);
  if (u_scenes.y > 0.003) {
    // Drifting with the current, as on the bed (stream.glsl: flowingCaustics(), DRIFT_T, FADE).
    vec2 mean = u_dir * u_current;
    float t = mod(u_time, 600.0);
    float k = caustics(q - mean * t, 0.045);
    float w = smoothstep(596.0, 600.0, t);
    if (w > 0.0) k = mix(k, caustics(q - mean * (t - 600.0), 0.045), w);
    c += u_scenes.y * 0.55 * k * vec4(1.0, 0.95, 0.8, 1.0);
  }
  // On the beach, as on the bottom, brightest in the shallows, gone by 6 m.
  if (u_scenes.z > 0.003) c += u_scenes.z * 0.6 * (1.0 - smoothstep(1.0, 6.0, beachDepth(p))) * caustics(q * 1.5, 0.08) * vec4(0.94, 1.0, 0.98, 1.0);
  // The pond's, as faint and nearly as still as on its bed (pond.glsl).
  if (u_scenes.w > 0.003) c += u_scenes.w * 0.35 * (1.0 - smoothstep(0.02, 0.045, cells(q * 2.2 + 11.0, u_time * 0.25))) * vec4(0.95, 1.0, 0.8, 1.0);
  // By night, moonlit: cooler and fainter.
  return c * mix(0.4, 1.0, u_day) * vec4(mix(vec3(0.8, 0.88, 1.0), vec3(1.0), u_day), 1.0);
}
