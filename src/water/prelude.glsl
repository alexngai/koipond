// Shared by every water scene (see scene.ts). A scene defines shade(p): the floor under the fish
// when u_layer is 0 (opaque), the surface over them when it is 1 (premultiplied alpha). main()
// scales it by u_weight, so two scenes can be added together while one crossfades into the other.
precision highp float;
#define WARP 1.1   // how much cell lines curve
#define ROUND 14.0 // lower = rounder, fatter junctions

uniform float u_time, u_cell, u_layer, u_day, u_weight; // u_day: 0 night, 1 day, eased in between
uniform vec2 u_res, u_dir, u_seed; // canvas px; swell/current heading (unit vector); random per visit

vec4 shade(vec2 p); // p: position in cells (u_cell canvas px each)
void main() {
  gl_FragColor = shade(gl_FragCoord.xy / u_cell) * u_weight;
}

vec2 hash(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

// Smooth random field in [-0.5, 0.5]^2 (value noise, both channels at once).
vec2 noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y) - 0.5;
}

// How far this point is from a cell border, given the distance to each drifting cell point.
// A smooth min over (d - nearest) instead of a hard one: where three cells meet, two terms tie
// and the value dips, so the lines swell into rounded gaps at the junctions instead of sharp Ys.
float cells(vec2 p, float t) {
  // Bend the straight Voronoi edges: a broad slow warp curves them, a finer one makes them wander.
  p += WARP * (noise(p * 0.55 + 0.08 * t) + 0.45 * noise(p * 1.4 - 0.11 * t + 7.3));
  vec2 n = floor(p), f = fract(p);
  float d[9], d1 = 8.0;
  for (int k = 0; k < 9; k++) {
    vec2 g = vec2(float(k - k / 3 * 3 - 1), float(k / 3 - 1));
    d[k] = length(g + 0.5 + 0.4 * sin(t + 6.2831 * hash(n + g)) - f);
    d1 = min(d1, d[k]);
  }
  float s = 0.0;
  for (int k = 0; k < 9; k++)
    if (d[k] > d1) s += exp(-ROUND * (d[k] - d1));
  return -log(s) / ROUND;
}

// Light focused onto the floor by the ripples above: 1 on a line, 0 between. width sets how thick
// the lines are (the ocean's are 0.045).
float caustics(vec2 p, float width) {
  return 1.0 - smoothstep(0.55 * width, width, cells(p * 3.2 + 17.0, u_time * 0.675));
}
