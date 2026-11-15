// Ocean: foam lines riding a slow swell, their shadows and caustics on the floor below. By day the
// floor shelves from cyan depths up to sandy shallows on the side the swell rolls towards.
#define SWELL_LEN 6.0     // cells from one wave crest to the next
#define SWELL_PERIOD 16.0 // seconds between crests
#define SWELL_AMP 0.12    // cells the foam surges forward and back with each wave
#define FOAM_CELL 0.7     // the foam's cells' size, in cells
uniform sampler2D u_reef; // the coral (reef.ts), drawn once: its colour, and how much covers each point in alpha
uniform vec2 u_bedView;   // how much of the floor that covers, in cells

// Phase of the swell rolling along u_dir; 0 at a crest.
float swell(vec2 p) {
  return 6.2831 * (dot(p, u_dir) / SWELL_LEN - u_time / SWELL_PERIOD);
}

// The foam rides the swell: each passing wave carries it forward and lets it slip back
// (bunching it up under the crests), with a slow net drift the same way. Its own shape
// changes far more slowly than the ripples below.
float foam(vec2 p) {
  p += u_dir * (SWELL_AMP * sin(swell(p)) - 0.04 * u_time);
  return cells(p / FOAM_CELL, u_time * 0.05); // (its lines, and their shadows, thin with the cells)
}

vec4 shade(vec2 p) {
  if (u_layer > 0.5) {
    // Surface: foam lines, transparent between them. Dim at night (it hides the fish
    // without glowing), near-white by day.
    float a = (1.0 - smoothstep(0.012, 0.022, foam(p))) * mix(0.425, 0.475, u_day);
    return vec4(mix(vec3(0.30, 0.43, 0.46), vec3(0.88, 0.98, 1.0), u_day) * a, a);
  }
  // Floor: caustics brighter under each crest and in the shallows, and the foam's shadow cast
  // down and to the right. x: 0 at the screen's furthest point along u_dir (the beach), 1 at the
  // furthest point back.
  float x = 0.5 - dot(gl_FragCoord.xy - 0.5 * u_res, u_dir) / dot(abs(u_dir), u_res);
  vec3 day = vec3(0.70, 0.86, 0.64);                                // sand at the water's edge
  day = mix(day, vec3(0.42, 0.87, 0.80), smoothstep(0.0, 0.35, x));  // turquoise shallows
  day = mix(day, vec3(0.14, 0.62, 0.82), smoothstep(0.2, 0.7, x));   // open water
  day = mix(day, vec3(0.08, 0.50, 0.76), smoothstep(0.6, 1.0, x));   // deeper, still cyan
  vec3 night = vec3(0.027, 0.10, 0.14);
  // The coral, seen through the water: bright in the shallows; deeper down the water takes its
  // reds first, then it fades into the blue. By night, dark and cool like the sand.
  vec4 reef = texture2D(u_reef, p / u_bedView);
  vec3 coral = reef.rgb * mix(vec3(1.0), vec3(0.6, 0.88, 1.0), smoothstep(0.1, 0.7, x));
  day = mix(day, mix(coral, day, 0.05 + 0.7 * smoothstep(0.1, 0.9, x)), reef.a);
  night = mix(night, reef.rgb * vec3(0.16, 0.24, 0.30) + 0.4 * night, reef.a);
  vec3 col = mix(night, day, u_day);
  float caustic = caustics(p, 0.045) * (0.15 + 0.09 * cos(swell(p))) * mix(1.0, 1.6 - 0.8 * x, u_day);
  col += mix(vec3(0.20, 0.42, 0.48), vec3(0.40, 0.75, 0.85), u_day) * caustic;
  float shadow = 1.0 - smoothstep(0.012, 0.10, foam(p + vec2(-0.24, 0.33))); // deep water: long, soft
  col *= 1.0 - mix(0.225, 0.15, u_day) * shadow; // half as dark as it was, as the foam is half as opaque
  return vec4(col, 1.0);
}
