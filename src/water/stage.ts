// The scene's own px. On a small screen (a phone) the water and the fish are laid out as on a bigger
// one and drawn smaller, `zoom` CSS px for each of theirs, so as much of each scene shows, and
// everything crosses the screen at the pace it does on a laptop. All of water/ and the fish work in
// these px (the "CSS px" their comments speak of, which they are on anything bigger than a tablet):
// the window's size in them is (w, h), the screen's (sw, sh), and dpr(cap) is canvas px per one of
// them, for a canvas drawn at most `cap` canvas px per CSS px.
// The zoom goes by the size of the screen, not the window: a phone's address bar coming and going, or
// a desktop window made small, doesn't change it.
// About 0.65 on a phone (as if it were half again as wide), 1 from a tablet up.
const zoom = Math.min(1, Math.max(0.5, Math.sqrt(screen.width * screen.height) / 900));

export const stage = {
  zoom,
  get w() {
    return window.innerWidth / zoom;
  },
  get h() {
    return window.innerHeight / zoom;
  },
  get sw() {
    return screen.width / zoom;
  },
  get sh() {
    return screen.height / zoom;
  },
  dpr: (cap: number) => Math.min(window.devicePixelRatio || 1, cap) * zoom,
};
