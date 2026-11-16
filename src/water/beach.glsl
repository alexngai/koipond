// Beach: a swell coming in over a seabed laid out afresh each visit, seen from above at a slight tilt
// (a crest's height lifts it up the screen). surf.ts works out, once per layout, what the seabed does
// to the waves (how they bend, grow, break and reform) into a small grid this reads as a texture, so
// each frame it only has to look up where the crests are now (surf.glsl).
//
// The seabed shows through the water, as in the stream: rippled sand, reef rock, clear over the
// shallows and bluer with depth, with caustics. Over it each wave, shaded smoothly: its face lighter
// and greener (the light through it), its back a shade darker, its crest paler; as it nears breaking
// its crest peaks and its face steepens. Then, by the slope it breaks on, it plunges (a white lip thrown
// ahead of the crest, with a hard shadow on the face below) or spills (white water tumbling down its
// face), and rolls on as a bore of white water trailing lace that thins out as it reforms. The water
// is on the floor canvas; the lip and the white water on the surface.
uniform vec2 u_bedView;      // how much the rocks' map covers, in cells
#ifndef ROCK_PASS
uniform sampler2D u_rocks;   // the rocks standing out of the water, drawn once (ROCK_PASS)
#endif

#define TILT 0.6  // surf.ts: TILT
#define LIP 22.0  // surf.ts: LIP
#define CHURN vec3(0.58, 0.87, 0.83) // water churned up by a broken wave: paler and milkier
#define SHEET mix(vec3(0.68, 0.63, 0.49), CHURN, 0.55) // the swash's sheet: churned water over wet sand
const vec3 LIGHT = vec3(-0.38, -0.38, 0.844); // towards the light: up and to the top left (shadows fall down and right)
#define ROCK_LIFT 2.5 // rocks drawn this many times taller than they are (as LIFT is for the waves)
#define ZMAX 18.0     // m: the tallest a block can be drawn
#define SUN 1.0       // how fast the light climbs, per m towards it: a block's shadow as long as it's tall

// The white water at m (x), and the lip's shadow on the face below it (y), in the water and washing
// over low rock. How much white water
// there is comes from the lip (thrown ahead of the crest), foam spilling down the face, the bore and
// what it leaves behind, and a big wave's crest feathering just before it breaks; where there's less
// than solid white, a lace of foam (the cells' edges) shows as much as there is, so its edges fray.
vec2 whiteAt(vec2 m, Surf s) {
  float ahead = -s.th; // > 0 ahead of the crest
  float broken = smoothstep(0.2, 0.8, s.foam) * smoothstep(0.0, 4.0, s.run);
  float plunge = smoothstep(0.35, 0.65, s.xi);
  float throwing = 1.0 - smoothstep(0.7 * LIP, LIP, s.run); // the lip, until it lands
  float reach = mix(0.12, 0.7, clamp(s.run / LIP, 0.0, 1.0)); // radians ahead of the crest
  float edge = smoothstep(reach - 0.06, reach + 0.06, ahead);
  float lip = broken * plunge * throwing * smoothstep(-0.05, 0.05, ahead) * (1.0 - edge);
  float shadow = broken * plunge * throwing * edge * (1.0 - smoothstep(1.6 * reach - 0.06, 1.6 * reach + 0.06, ahead));
  float spillReach = min(1.1, s.run / 12.0);
  float spill = broken * (1.0 - plunge) * smoothstep(-0.35, -0.15, ahead) * (1.0 - smoothstep(0.7 * spillReach, spillReach, ahead));
  float wake = s.foam * smoothstep(0.0, 2.0, s.run) * smoothstep(-0.35, -0.15, s.th) * exp(-max(s.th, 0.0) / 0.9);
  wake *= mix(1.0, smoothstep(0.0, 0.7 * LIP, s.run), plunge); // a plunging wave's builds as its lip lands
  float feather = (1.0 - smoothstep(0.0, 2.0, s.run)) * smoothstep(0.85, 0.95, s.ratio) * smoothstep(0.9, 0.96, s.shape) * smoothstep(0.9, 1.1, s.H);
  float amount = max(max(lip, spill), max(wake, feather));
  float c = cells(m / 7.0 + u_surfSize.w, u_time * 0.4); // 0 on a cell's border
  float white = amount < 0.02 ? 0.0 : amount > 0.85 ? 1.0 : 1.0 - smoothstep(amount * 0.45 - 0.01, amount * 0.45 + 0.01, c);
  // On land, only low rock gets any: as each wave arrives the foam surges up over its edges and
  // lowest blocks and drains away, less the higher it stands, none past 0.7 m; on sand it spills a
  // few metres up the beach, where the swash's foamy front takes over.
  float washed = s.d > 0.05 ? 1.0 : max(smoothstep(0.3, 0.5, s.reef) * (1.0 - smoothstep(0.1, 0.7, -s.d)), 1.0 - smoothstep(0.0, 3.0, -s.d / 0.08));
  return vec2(white, shadow) * washed;
}

// One layer of boulders about `size` m across, one to each cell of a jittered grid, some bigger
// than others (they push their neighbours' edges back), each a rounded dome:
// x, how high this point is on its boulder (0 in the cracks, 1 on top); y, its light, lit from the
// top left like everything else (shadows fall down and to the right); z, a random value for its
// colour.
vec3 boulders(vec2 m, float size) {
  vec2 p = m / size;
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  vec2 toward = vec2(0.0), id = vec2(0.0);
  for (int k = 0; k < 9; k++) {
    vec2 g = vec2(float(k - k / 3 * 3 - 1), float(k / 3 - 1));
    vec2 r = g + 0.1 + 0.8 * hash(n + g) - f; // from here to that boulder's middle
    float d = length(r) - 0.55 * hash(n + g + 3.1).x; // less for a bigger one
    if (d < d1) {
      d2 = d1;
      d1 = d;
      toward = r;
      id = n + g;
    } else if (d < d2) d2 = d;
  }
  // Where this point is on its dome: q runs from 0 at its middle to 1 at its edge (about where the
  // next one starts), and the dome's slope there turns it towards or away from the light.
  vec2 q = -toward / max(length(toward) + 0.5 * (d2 - d1), 1e-3);
  float r2 = clamp(dot(q, q), 0.0, 1.0);
  vec3 normal = vec3(0.9 * q, sqrt(1.0 - 0.81 * r2));
  float light = 0.55 + 0.6 * max(dot(normal, vec3(-0.53, -0.53, 0.66)), 0.0);
  return vec3(sqrt(1.0 - r2), light, hash(id + 7.3).x);
}

// A pile of boulders seen from above, `up` m above the water (or under it): big ones, each casting
// a shadow down and to the right onto whatever's lower beside it, with smaller stones down in the
// shadowy gaps between them; greys and browns, the odd warm one, flecked with lichen on top; dark in
// the cracks; darker and wet near the water, green with weed just above it.
vec3 rockPile(vec2 m, float up, vec3 big) {
  vec3 small = boulders(m + 13.7, 3.5);
  vec3 b = big.x > 0.3 ? big : small;
  float sunk = big.x > 0.3 ? 1.0 : 0.45 + 0.35 * small.x; // the small ones sit down in the gaps
  vec3 col = mix(vec3(0.44, 0.42, 0.38), vec3(0.64, 0.60, 0.52), b.z);
  if (fract(b.z * 7.0) > 0.8) col = mix(col, vec3(0.62, 0.52, 0.40), 0.6);
  col *= b.y * mix(0.4, 1.0, smoothstep(0.0, 0.35, b.x)) * sunk * (0.92 + 0.16 * noise(m * 0.6).x);
  col *= 1.0 - 0.4 * smoothstep(0.05, 0.4, boulders(m - vec2(2.0), 11.0).x - big.x); // shadowed
  float lichen = step(0.85, noise(m * 0.9).x + 0.5) * smoothstep(0.5, 0.9, b.x);
  col = mix(col, vec3(0.80, 0.68, 0.36), 0.5 * lichen);
  col *= mix(0.6, 1.0, smoothstep(0.5, 3.0, up));
  return mix(col, vec3(0.25, 0.36, 0.22), 0.5 * (1.0 - smoothstep(0.5, 2.0, up)) * step(0.5, b.x));
}

// Above the water, rock is broken blocks, drawn flat like the stream's boulders: one layer of them
// about `size` m across, one to each cell of a jittered grid (some bigger than others): x, how far
// this point is in from its block's edge (0 at it, 1 in its middle); z, a random value for its
// colour; w, how far it is from the crack between this block and the next (or a cut corner).
// (y: unused.) `centre`: the block's middle, m; `side`: the way its nearest side faces (out of it).
// About half its corners are cut off, each by its own amount, for a side more each (the notch left
// is filled by smaller blocks, or is a crack).
vec4 crags(vec2 m, float size, out vec2 centre, out vec2 side) {
  vec2 p = m / size;
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, d3 = 8.0;
  vec2 toward = vec2(0.0), next = vec2(0.0), third = vec2(0.0), id = vec2(0.0), id2 = vec2(0.0), id3 = vec2(0.0);
  for (int k = 0; k < 9; k++) {
    vec2 g = vec2(float(k - k / 3 * 3 - 1), float(k / 3 - 1));
    vec2 r = g + 0.1 + 0.8 * hash(n + g) - f;
    float d = length(r) - 0.5 * hash(n + g + 3.1).x;
    if (d < d1) {
      d3 = d2;
      third = next;
      id3 = id2;
      d2 = d1;
      next = toward;
      id2 = id;
      d1 = d;
      toward = r;
      id = n + g;
    } else if (d < d2) {
      d3 = d2;
      third = next;
      id3 = id2;
      d2 = d;
      next = r;
      id2 = n + g;
    } else if (d < d3) {
      d3 = d;
      third = r;
      id3 = n + g;
    }
  }
  vec2 q = -toward / max(length(toward) + 0.5 * (d2 - d1), 1e-3); // 0 at its middle, 1 at its edge
  centre = m + toward * size;
  vec2 n2 = normalize(next - toward + 1e-5), n3 = normalize(third - toward + 1e-5);
  vec2 corner = hash(1.7 * id + id2 + id3 + 0.37); // this corner of this block
  float cut = step(0.5, corner.x) * (0.2 + 0.35 * corner.y);
  float w = d2 - d1, cw = 0.5 * (d2 + d3 - 2.0 * d1 - cut);
  side = n2;
  if (cut > 0.0 && cw < w) {
    w = cw;
    side = normalize(n2 + n3);
  }
  return vec4(1.0 - length(q), 1.0, hash(id + 5.7).y, w);
}

// How much rock the seabed has at m (surf.ts: seabed()'s reef and rock), roughened at a few scales
// so its outline isn't smooth.
float rockAt(vec2 m) {
  return tile(shore(m), 0.0).z + 0.2 * (noise(m * 0.035).x + 0.5 * noise(m * 0.08).y + 0.25 * noise(m * 0.19).x);
}

// The rock at m, above or just under the water: big blocks here and there (more of them in the
// thick of it), medium ones crowding round them and rubble filling in between and round their edges (inset
// along each block's own sides, so it stays angular),
// each block there or not as a whole, by how much rock there is where it sits, so the rock's edge
// follows its blocks and the odd stray lies out on the sand. Returns the block this point is on (see
// crags(); none if `size` comes back 0), its size, m, its middle and the way its nearest side faces.
vec4 cragAt(vec2 m, out float size, out vec2 centre, out vec2 side) {
  size = 15.0;
  vec4 c = crags(m, 15.0, centre, side);
  float here = rockAt(centre);
  if (here < 0.5 || c.z > mix(0.97, 0.6, smoothstep(0.5, 0.85, here)) || c.w < 0.18) {
    size = 6.0;
    c = crags(m + 13.7, 6.0, centre, side);
    centre -= 13.7;
    here = rockAt(centre);
    if (here < 0.46 || c.z > mix(0.9, 0.4, smoothstep(0.5, 0.85, here)) || c.w < 0.18) {
      size = 2.4;
      c = crags(m + 29.3, 2.4, centre, side);
      centre -= 29.3;
      if (rockAt(centre) < 0.4 + 0.1 * c.z) size = 0.0;
    }
  }
  return c;
}

// How tall a block stands, drawn (m): none if its middle is under the water (it lies flat on the
// bottom); otherwise by its size (big blocks stand tallest), how far into the rock it is (the
// headland's core stands tallest, its edges low), how far out of the water (those at the water's edge
// low, so the foam can wash over them), and at random: now and then a stack stands well above the rest.
float cragHeight(vec4 c, float size, vec2 centre) {
  float up = -tile(shore(centre), 0.0).y; // m out of the water
  if (size == 0.0 || up < 0.0) return 0.0;
  float core = smoothstep(0.5, 0.9, rockAt(centre));
  float stack = 1.0 + 0.7 * step(0.9, fract(c.z * 13.1));
  return ROCK_LIFT * size * (0.1 + 0.12 * fract(c.z * 5.3)) * (0.45 + 0.75 * core) * stack * (0.3 + 0.7 * smoothstep(0.0, 1.2, up));
}

// Whether m is in the hard shadow of a bigger block (bigger ones stand taller) cast down and to the
// right, onto a block `size` m across there: for the blocks under the water.
float castShadow(vec2 m, float size) {
  float other;
  vec2 centre, side;
  vec4 caster = cragAt(m - vec2(2.0), other, centre, side);
  return other > size ? smoothstep(0.0, 0.04, caster.w) : 0.0;
}

// A block's top, flat: one tone of weathered grey (the odd one brown), a thin dark line round its
// edge; darker and wet, `up` m from the water's edge (up the beach).
vec3 cragTone(vec4 c, float up) {
  float tone = fract(c.z * 9.7);
  vec3 col = mix(vec3(0.50, 0.49, 0.46), vec3(0.67, 0.64, 0.58), tone);
  if (fract(tone * 7.0) > 0.88) col = mix(col, vec3(0.62, 0.55, 0.45), 0.4);
  col *= mix(0.6, 1.0, smoothstep(0.0, 0.05, c.w)); // the line between blocks
  col *= mix(0.6, 1.0, smoothstep(0.5, 3.0, up));
  return mix(col, vec3(0.28, 0.27, 0.22), 0.4 * (1.0 - smoothstep(0.5, 1.8, up)));
}

#ifdef ROCK_PASS
// The rocks standing out of the water, drawn once (they never change) into a map the floor and
// surface read: each block raised up the screen by its height, as the tilt does the waves, showing
// its top and, below it, its front; their shadows, as long as they're tall, on what's lower. Flat,
// but cut into facets, each one tone, lit by which way it faces: a block's top is bevelled down all
// round to its sides, its middle peaked or ridged; its front is a face for each of its sides.

// A block's bevel (out of crags()' c): how far in from its side it runs (cells) and how much of
// its height it falls across that.
vec2 bevel(vec4 c) {
  return vec2(0.08 + 0.17 * fract(c.z * 3.7), 0.25 + 0.3 * fract(c.z * 7.9));
}

// How tall the rock at g stands, drawn (m; 0 for none, or the crack between two): its block's
// height, less on its bevel.
float blockZ(vec2 g, out vec4 c, out float size, out vec2 centre, out vec2 side) {
  size = 0.0;
  c = vec4(0.0);
  centre = g;
  side = vec2(0.0, 1.0);
  if (tile(shore(g), 0.0).z < 0.04) return 0.0; // no rock near: skip the search
  c = cragAt(g, size, centre, side);
  if (size == 0.0 || c.w < 0.02) return 0.0;
  vec2 b = bevel(c);
  return cragHeight(c, size, centre) * (1.0 - b.y * max(0.0, 1.0 - (c.w - 0.02) / b.x));
}

// Whether the point at g, z m up (drawn), is in the shadow of a block standing between it and the
// light (up and to the left) taller than the light's ray there.
float shadowAt(vec2 g, float z) {
  vec2 towards = normalize(LIGHT.xy); // towards the light, on the ground
  for (int i = 1; i <= 30; i++) {
    float t = float(i) * ZMAX / SUN / 30.0;
    float ray = z + SUN * t;
    if (ray > ZMAX) break;
    vec4 c;
    float size;
    vec2 centre, side;
    if (blockZ(g + towards * t, c, size, centre, side) > ray) return 1.0;
  }
  return 0.0;
}

// How light a facet facing n is: one facing straight up as it was, those turned to the light (up
// and to the left) lighter, those turned away darker.
float facet(vec3 n) {
  return 0.45 + 0.65 * clamp(dot(normalize(n), LIGHT), 0.0, 1.0);
}

vec4 shade(vec2 p) {
  float hpx = u_res.y / u_cell * CSS;
  vec2 ms = vec2(p.x, u_res.y / u_cell - p.y) * CSS * u_surfGrid.w / hpx; // this pixel on the ground, m
  // Along this pixel's line of sight, from the nearest point (furthest down the screen, highest) back
  // to the ground under it: the first rock it meets. It came down onto its top if it was over the
  // same block just before, else it met its front.
  float hit = -1.0, before = 0.0;
  bool front = false;
  vec2 was = vec2(1e5), centre = ms;
  for (int i = 0; i < 40; i++) {
    float s = TILT * ZMAX * (1.0 - float(i) / 39.0); // m down the screen from this pixel
    vec4 bc;
    float size;
    vec2 bcentre, bside;
    float bz = blockZ(ms + vec2(0.0, s), bc, size, bcentre, bside);
    if (bz > 0.0 && TILT * bz >= s) {
      hit = s;
      centre = bcentre;
      front = distance(bcentre, was) > 0.01;
      break;
    }
    was = bz > 0.0 ? bcentre : vec2(1e5);
    before = s;
  }
  float d = tile(shore(ms), 0.0).y;
  if (hit < 0.0) {
    // Ground: only shadow, fainter on the water. (Alpha: how much of what's beneath shows.)
    if (u_layer > 0.5) return vec4(0.0);
    return vec4(0.0, 0.0, 0.0, 1.0 - (d > 0.0 ? 0.25 : 0.35) * shadowAt(ms, 0.0));
  }
  // Closer, between there and the step before: where it meets the top, or crosses into the block.
  vec4 c;
  float size, z;
  vec2 bcentre, side;
  for (int k = 0; k < 5; k++) {
    float mid = 0.5 * (hit + before);
    float bz = blockZ(ms + vec2(0.0, mid), c, size, bcentre, side);
    bool inside = bz > 0.0 && distance(bcentre, centre) < 0.01 && (front || TILT * bz >= mid);
    if (inside) hit = mid;
    else before = mid;
  }
  vec2 g = ms + vec2(0.0, hit); // where on the ground it meets it
  z = blockZ(g, c, size, bcentre, side);
  // On the surface (and for beach.ts's flecks) it hides what's behind it: whatever's at this pixel's
  // own spot on the ground, unless that's where the line of sight meets it, near enough (the foam
  // washing over a low block).
  if (u_layer > 0.5) return vec4(0.0, 0.0, 0.0, smoothstep(0.3, 0.6, hit));
  vec3 col;
  if (!front) {
    // Its top: round its edge the bevel, a facet for each side, falling to it; in its middle, on
    // the bigger blocks three facets rising to a peak, on the rubble two either side of a ridge
    // running across it at random; the whole top tipped a little at random. Wet and dark only if it
    // stands low over the water.
    float top = cragHeight(c, size, centre);
    vec2 b = bevel(c);
    float rand = fract(c.z * 11.3);
    vec3 n = vec3(0.3 * (vec2(fract(c.z * 23.17), fract(c.z * 41.3)) - 0.5), 1.0); // tipped
    if (c.w - 0.02 < b.x) {
      n.xy += side * clamp(top * b.y / (b.x * size), 0.3, 1.5); // the bevel, down to this side
    } else if (size > 3.0) {
      // Three facets rising to a peak a little off its middle.
      vec2 to = g - centre - size * 0.15 * (vec2(fract(c.z * 29.3), fract(c.z * 37.1)) - 0.5);
      float k = floor(fract(atan(to.y, to.x) / 6.2831853 - rand) * 3.0);
      float a = 6.2831853 * (rand + (k + 0.5) / 3.0);
      n.xy += vec2(cos(a), sin(a)) * (0.2 + 0.3 * fract(c.z * 17.9));
    } else {
      vec2 across = vec2(cos(6.2831853 * rand), sin(6.2831853 * rand));
      n.xy += across * sign(dot(g - centre, across)) * (0.2 + 0.3 * fract(c.z * 17.9));
    }
    float up = (-tile(shore(centre), 0.0).y + top / ROCK_LIFT) / 0.08; // as m up the beach (cragTone())
    col = cragTone(vec4(c.xy, c.z, 1.0), up) * facet(n) * (1.0 - 0.35 * shadowAt(g, z));
    col *= mix(0.8, 1.0, smoothstep(0.02, 0.035, c.w)); // a fine dark line along its top edge
  } else {
    // Its front, facing us, a face for each side, lit as that side faces the light (left) or away
    // (right); darker and wet at its foot where it stands in the water, green with weed.
    col = cragTone(vec4(c.xy, c.z, 1.0), 10.0) * facet(vec3(side, 0.0));
    float wet = (1.0 - smoothstep(-0.1, 0.8, -tile(shore(g), 0.0).y)) * (1.0 - smoothstep(0.4, 1.4, hit / TILT));
    col = mix(col, vec3(0.20, 0.26, 0.18), 0.55 * wet);
  }
  return vec4(col, 0.0);
}
#else
// A block under the water, as cragTone() with the hard shadows of bigger blocks on it.
vec3 cragPile(vec2 m, vec4 c, float size) {
  return cragTone(c, 0.0) * (1.0 - 0.35 * castShadow(m, size));
}

// The swash, at a point `up` m up the beach at g (the beach's frame). Each wave, reaching the water's
// edge, runs on up the beach as a thin sheet of water and slides back down, as far as what it brings
// carries it: its height and its white water a little way out, for its size (surf.ts's grid), so a
// broken wave's bore runs well up with a foamy front and leaves a line of foam where it stops, and an
// unbroken one, or one in the lee of a rock, only laps the sand. It starts as the wave's white water
// reaches the edge (the same arrival as the waves themselves) and is pushed on up the sand faster than
// the wave was coming in, slowing as it climbs, then slides back down more slowly, gathering pace as
// it drains. The sand it covers stays dark and wet for a while
// after, drying back. The last three waves count, so the sand dries through several. Returns: x, how
// deep the water covering it is now (0 none; thin towards the running front, deepest at the water's
// edge); y, how wet the sand is; z, foam.
vec3 swash(vec2 g, float up) {
  float T = u_surfSize.z;
  vec2 edge = g - vec2(0.0, up); // the water's edge below it
  vec2 sea = edge - vec2(0.0, 12.0); // and a little way out, where each wave comes in from (clear of the grid's blur with the dry beach)
  float ph = u_time / T - tile(edge, 0.0).x + 0.04 * sin(edge.x * 0.05 + u_time * 0.1 + u_surfSize.w);
  float n = floor(ph); // the latest wave to reach the edge, ...
  float tau = (ph - n) * T; // ... this many s ago
  float c = sqrt(9.81 * max(tile(sea, 0.0).y, 0.3)); // m/s the waves come in at, out there
  float water = 0.0, wet = 0.0, foam = 0.0;
  for (int k = 0; k < 3; k++) {
    float nk = n - float(k);
    float age = tau + float(k) * T + 0.04 * T; // s since this wave's white water reached the edge
    float size = waveSize(nk);
    float c = clamp(size < 1.0 ? (size - 0.7) / 0.3 : 1.0 + (size - 1.0) / 0.35, 0.0, 2.0);
    float c0 = min(floor(c), 1.0);
    vec4 brings = mix(tile(sea, 1.0 + c0), tile(sea, 2.0 + c0), c - c0); // its height, run, white water
    float white = clamp(brings.z, 0.0, 1.0);
    float reach = 30.0 * brings.x * (0.3 + 0.7 * white); // m
    // Up in Tu s, starting half again as fast as the wave came in (or faster, to get up the beach
    // in time), slowing to a stop; back in Tb s, slowly at first.
    float Tu = clamp(2.0 * reach / (1.5 * c), 0.2 * T, 0.45 * T);
    float Tb = min(1.4 * Tu, 0.95 * T - Tu);
    if (up < reach) {
      float q = sqrt(1.0 - up / reach);
      float arrive = Tu * (1.0 - q), back = Tu + Tb * q; // when the front passes here going up, coming back
      if (age > arrive && age < back) {
        float a = age < Tu ? 1.0 - age / Tu : (age - Tu) / Tb;
        float front = reach * (1.0 - a * a);
        water = max(water, 0.15 + 0.85 * clamp(1.0 - up / max(front, 0.5), 0.0, 1.0));
        foam = max(foam, (0.25 + 0.75 * white) * (1.0 - smoothstep(0.5, 3.0, front - up))); // its front
      }
      wet = max(wet, age < back ? (age > arrive ? 1.0 : 0.0) : exp(-(age - back) / 7.0));
      foam = max(foam, white * (1.0 - smoothstep(0.0, 1.6, reach - up)) * step(Tu, age) * exp(-(age - Tu) / 5.0));
    }
  }
  return vec3(water, wet, foam);
}

vec4 shade(vec2 p) {
  float hpx = u_res.y / u_cell * CSS; // the screen's height, CSS px
  vec2 qs = vec2(p.x, u_res.y / u_cell - p.y) * CSS; // this pixel, CSS px, y down
  vec2 ms = qs * u_surfGrid.w / hpx; // ... in m
  // Which water this pixel shows: the tilt lifts each bit of it up the screen by its height. By
  // fixed-point iteration, damped, as steep crests can fold over in the view.
  vec2 m = ms;
  for (int i = 0; i < 8; i++) m = mix(m, ms + vec2(0.0, TILT * surfAt(m).z), 0.6);
  Surf s = surfAt(m);
  vec2 white = whiteAt(m, s);
  float nite = 1.0 - u_day;
  float d = s.d;
  float up = -d / 0.08; // on the beach: m up it from the water's edge (surf.ts: seabed())
  vec3 sw = d <= 0.0 && s.reef < 0.45 ? swash(shore(m), up) * (1.0 - smoothstep(0.15, 0.45, s.reef)) : vec3(0.0); // on the sand, fading out at rock

  vec4 rocks = texture2D(u_rocks, p / u_bedView); // the rocks standing out of the water (ROCK_PASS)
  if (u_layer > 0.5) {
    // Surface: the lip and the white water, near-white by day, moonlit grey by night, hidden behind
    // the rocks.
    float a = white.x * mix(0.9, 1.0, u_day) * (1.0 - rocks.a);
    return vec4(mix(vec3(0.42, 0.53, 0.60), vec3(0.95, 0.98, 1.0), u_day) * a, a);
  }
  vec3 sand = vec3(0.84, 0.78, 0.60); // the sand on the bottom: flat
  // Rock: under the water a reef, a pile of rounded boulders; out of it a headland, broken angular
  // blocks, big in its core and rubble round its edges. Either way its edge follows the rocks.
  // The angular blocks reach into the shallows; further out it's the reef's boulders, its outline
  // roughened like theirs. Those standing out of the water, and their shadows, are drawn over all
  // this at the end (ROCK_PASS); here only those lying under it.
  // Under and between the blocks, in the thick of the rock, the ground is the dark of their shadows
  // (base), not sand; beyond it the odd stray lies on the sand.
  float onReef = 0.0, base = 0.0;
  vec3 rock = sand, under = vec3(0.35, 0.34, 0.31);
  if (s.reef > 0.12) {
    base = smoothstep(0.46, 0.49, rockAt(m));
    if (d > 0.8) {
      vec3 big = boulders(m, 11.0);
      float rough = noise(m * 0.035).x + 0.5 * noise(m * 0.08).y + 0.25 * noise(m * 0.19).x;
      onReef = smoothstep(0.42, 0.48, s.reef + 0.15 * (big.x - 0.3) + 0.12 * rough);
      rock = rockPile(m, 1.2, big);
    } else if (d > 0.0) {
      float size;
      vec2 centre, side;
      vec4 c = cragAt(m, size, centre, side);
      if (size > 0.0 && cragHeight(c, size, centre) == 0.0) {
        onReef = smoothstep(0.0, 0.04, c.w);
        rock = cragPile(m, c, size);
      }
    }
  }
  vec3 col = mix(mix(sand, under, base), rock, onReef);
  if (d > 0.0) {
    // Seen through the water: clear over the shallows, turquoise, then blue in the deep, with
    // caustics brightest where it's shallowest.
    col = mix(col, vec3(0.30, 0.74, 0.72), (0.35 + 0.45 * smoothstep(0.0, 2.0, d)) * (1.0 - 0.45 * onReef));
    col = mix(col, vec3(0.10, 0.48, 0.62), smoothstep(1.5, 6.0, d));
    col = mix(col, vec3(0.06, 0.34, 0.50), smoothstep(5.0, 12.0, d));
    // Over its last few metres to the beach, the water turns into the swash's sheet (the churned
    // water over wet sand, its caustics fainter), so the two meet without a seam.
    float edge = 1.0 - smoothstep(0.0, 6.0, s.fromEdge);
    col = mix(col, SHEET, 0.85 * edge);
    col += mix(0.22 * (1.0 - smoothstep(0.5, 5.0, d)), 0.08, edge) * caustics(p * 1.5, 0.045) * vec3(0.9, 1.0, 0.95);
    // The waves, shaded continuously, and more so the taller they are.
    float v = smoothstep(0.15, 1.2, s.H);
    float near = smoothstep(0.5, 0.95, s.ratio); // how near breaking
    // (How fast its shape changes through the wave: taken over a span wide enough that a sharp
    // crest turns softly.)
    float slope = (profile(s.th + 0.25, s.ratio) - profile(s.th - 0.25, s.ratio)) / 0.5;
    // Through more water a crest reads deeper, bluer; through less a trough reads lighter.
    col *= mix(vec3(1.0), s.shape > 0.0 ? vec3(0.8, 0.89, 0.98) : vec3(1.1, 1.08, 1.04), 0.8 * v * abs(s.shape) * (1.0 - 0.6 * near));
    // Lit from the top left, like everything else, on its own slope (worked out from the crests'
    // arrival and the wave's shape): the slopes turned to the light catch more of the sky, and
    // those turned away darken.
    vec2 dS = vec2(tile(shore(m + vec2(2.0, 0.0)), 0.0).x - tile(shore(m - vec2(2.0, 0.0)), 0.0).x,
                   tile(shore(m + vec2(0.0, 2.0)), 0.0).x - tile(shore(m - vec2(0.0, 2.0)), 0.0).x) / 4.0; // periods per m
    vec2 grad = -LIFT * 0.5 * s.H * slope * 6.2831853 * dS; // its slope as drawn (m up per m)
    float lit = dot(normalize(vec3(-grad, 1.0)), LIGHT) - LIGHT.z; // + turned to the light, - away
    col *= 1.0 + (lit > 0.0 ? 0.9 : 0.45) * lit; // the shade on the slopes turned away kept light
    // Near breaking the crest pales.
    col = mix(col, vec3(0.78, 0.94, 0.90), 0.5 * near * v * smoothstep(0.4, 1.0, s.shape));
    // Once a wave has broken, the water it's churned up runs on with it: a paler, milkier sheet
    // just behind its crest, under its white water, showing more and more over its last 35 m to
    // the shore, where it runs on up the beach (swash()).
    float broken = smoothstep(0.2, 0.8, s.foam) * smoothstep(0.0, 4.0, s.run) * (1.0 - smoothstep(6.0, 35.0, s.fromEdge));
    col = mix(col, CHURN, 0.45 * broken * smoothstep(-0.15, 0.05, s.th) * (1.0 - smoothstep(0.2, 1.8, s.th)));
  } else {
    // The beach: dry sand, one smooth gradient paler further up, dark where the swash has wet it
    // (drying back) and glazed with its sheet of water where it's running.
    vec3 dry = mix(vec3(0.88, 0.82, 0.64), vec3(0.93, 0.89, 0.75), smoothstep(10.0, 80.0, up));
    col = mix(dry, vec3(0.68, 0.63, 0.49), sw.y);
    // The sheet: the churned water of the wave that brought it, thin and clear at its front, deeper
    // towards the water's edge; and its foam.
    col = mix(col, SHEET, sw.x) + 0.08 * sw.x * caustics(p * 1.5, 0.045) * vec3(0.9, 1.0, 0.95);
    float lace = 1.0 - smoothstep(sw.z * 0.42 - 0.01, sw.z * 0.42 + 0.01, cells(m / 4.0 + u_surfSize.w, u_time * 0.3));
    col = mix(col, vec3(0.95, 0.98, 1.0), sw.z > 0.85 ? 1.0 : sw.z > 0.02 ? lace : 0.0);
    col = mix(col, under * mix(0.75, 1.0, smoothstep(0.5, 3.0, up)), base); // between the rocks
  }
  // The lip's shadow on the face, and the white water's, cast down and to the right.
  col *= 1.0 - 0.38 * white.y;
  vec2 o = m - vec2(3.0, 4.5);
  col *= 1.0 - 0.22 * whiteAt(o, surfAt(o)).x * (1.0 - white.x);
  col = col * rocks.a + rocks.rgb; // the rocks standing out of the water, and their shadows
  col *= mix(vec3(1.0), vec3(0.24, 0.30, 0.38), nite); // moonlit at night
  return vec4(col, 1.0);
}
#endif
