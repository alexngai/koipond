// Reef: a long, slow swell rolling in over coral (reef.ts) towards the sand on one side of the
// screen, seen straight from above. It rides the surf model (surf.ts, surf.glsl) over the reef's own
// seabed (reef.ts: reefBed()): the waves slow and bend round the coral, and over the shallowest heads
// (and at the sand's edge) they build and spill a little, leaving lace that thins as they run on.
// By day the floor shelves from cyan depths up to sandy shallows; the swell shows in it as faint
// broad bands, and the caustics brighten under each crest and drape over the coral: on anything
// standing up they fall a little down and to the right of where they'd fall on the sand, so they
// break at each tier's edge.
uniform sampler2D u_reef;     // the coral (reef.ts), drawn once: its colour, and how much covers each point in alpha
uniform sampler2D u_reefBump; // how high it stands (reef.ts: drawReefHeight()): 1 at TALLEST px
uniform vec2 u_bedView;       // how much of the floor those cover, in cells
#define TALLEST 42.0 // reef.ts: TALLEST
const vec3 LIGHT = vec3(-0.38, -0.38, 0.844); // towards the light: up and to the top left

// How much white water there is: where a wave spills over the shallow coral or at the sand's edge,
// and the lace it leaves as it runs on, thinning out (beach.glsl: whiteAt(), gentler: no plunging
// lip, and never solid white).
float foamAt(Surf s) {
  float broken = smoothstep(0.2, 0.8, s.foam) * smoothstep(0.0, 4.0, s.run);
  float ahead = -s.th; // > 0 ahead of the crest
  float reach = min(1.1, s.run / 12.0);
  float spill = broken * smoothstep(-0.35, -0.15, ahead) * (1.0 - smoothstep(0.7 * reach, reach, ahead));
  float wake = s.foam * smoothstep(0.0, 2.0, s.run) * smoothstep(-0.35, -0.15, s.th) * exp(-max(s.th, 0.0) / 0.9);
  return 0.6 * max(spill, wake);
}
// ... drawn as lace at m: as much of the cells' edges as there is foam.
float white(vec2 m, Surf s) {
  float amount = foamAt(s);
  float c = cells(m / 6.0 + u_surfSize.w, u_time * 0.3);
  return amount < 0.02 ? 0.0 : 1.0 - smoothstep(amount * 0.45 - 0.01, amount * 0.45 + 0.01, c);
}

vec4 shade(vec2 p) {
  float hpx = u_res.y / u_cell * CSS; // the screen's height, CSS px
  vec2 m = vec2(p.x, u_res.y / u_cell - p.y) * CSS * u_surfGrid.w / hpx; // this pixel, m from the top left
  Surf s = surfAt(m);
  if (u_layer > 0.5) {
    // Surface: the white water, near-white by day, dim by night.
    float a = white(m, s) * mix(0.55, 0.85, u_day);
    return vec4(mix(vec3(0.30, 0.43, 0.46), vec3(0.92, 0.98, 1.0), u_day) * a, a);
  }
  // Floor. x: 0 at the screen's furthest point along u_dir (the sand), 1 at the furthest point back.
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
  // The swell, in faint broad bands: through more water a crest reads a touch deeper and bluer,
  // through less a trough a touch lighter; and lit from the top left on its slopes.
  float v = smoothstep(0.1, 0.9, s.H);
  col *= mix(vec3(1.0), s.shape > 0.0 ? vec3(0.9, 0.95, 1.0) : vec3(1.05, 1.04, 1.02), 0.5 * v * abs(s.shape));
  float slope = (profile(s.th + 0.25, s.ratio) - profile(s.th - 0.25, s.ratio)) / 0.5;
  vec2 dS = vec2(tile(shore(m + vec2(2.0, 0.0)), 0.0).x - tile(shore(m - vec2(2.0, 0.0)), 0.0).x,
                 tile(shore(m + vec2(0.0, 2.0)), 0.0).x - tile(shore(m - vec2(0.0, 2.0)), 0.0).x) / 4.0; // periods per m
  vec2 grad = -LIFT * 0.5 * s.H * slope * 6.2831853 * dS;
  float lit = dot(normalize(vec3(-grad, 1.0)), LIGHT) - LIGHT.z;
  col *= 1.0 + (lit > 0.0 ? 0.5 : 0.3) * lit;
  // The caustics: brighter under each crest and in the shallows, draping over the coral (falling
  // down and to the right, as the coral's shadows do, reef.ts: drawReef(), as far as it stands up).
  float lift = texture2D(u_reefBump, p / u_bedView).r * TALLEST; // px
  vec2 q = p + vec2(0.6, -0.8) * 0.8 * lift / CSS;
  float caustic = caustics(q, 0.045) * (0.15 + 0.09 * cos(s.th)) * mix(1.0, 1.6 - 0.8 * x, u_day);
  col += mix(vec3(0.20, 0.42, 0.48), vec3(0.40, 0.75, 0.85), u_day) * caustic;
  // The white water's shadow, cast down and to the right: deep water, so long and soft.
  col *= 1.0 - mix(0.2, 0.14, u_day) * foamAt(surfAt(m - vec2(17.0, 24.0)));
  return vec4(col, 1.0);
}
