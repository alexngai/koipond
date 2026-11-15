// Pond: still, deep green water over a dark bed, with water lilies floating on it (pond.ts) and koi
// (fish.ts) gliding between. In the ocean's flat style: solid colour in broad soft patches of
// depth, and faint caustics that the still water barely moves.
vec4 shade(vec2 p) {
  if (u_layer > 0.5) return vec4(0.0); // nothing on the surface but the lilies, on their own canvas
  float deep = smoothstep(-0.35, 0.45, noise(p * 0.3 + u_seed).x + 0.5 * noise(p * 0.8 - u_seed.yx).y);
  vec3 day = mix(vec3(0.28, 0.42, 0.31), vec3(0.085, 0.25, 0.24), deep); // olive shallows to deep jade
  vec3 night = mix(vec3(0.035, 0.075, 0.065), vec3(0.015, 0.04, 0.05), deep);
  vec3 col = mix(night, day, u_day);
  float light = 1.0 - smoothstep(0.012, 0.024, cells(p * 2.2 + 11.0, u_time * 0.25));
  col += mix(vec3(0.12, 0.2, 0.2), vec3(0.55, 0.62, 0.42), u_day) * light * mix(0.09, 0.05, deep);
  return vec4(col, 1.0);
}
