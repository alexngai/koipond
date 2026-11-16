# Koi Pond Simulator

A Chrome extension that puts a living water scene on every new tab: a coral reef, a mountain
stream, a koi pond or a beach, by day or by night, with fish that swim away from your cursor. Over
it, a clock and a search box (each optional), a settings dialog behind the gear in the corner, and a
button beside it that lays the scene out afresh. The water also runs on its own as a
[wallpaper](#as-a-wallpaper).

Version 1.0 is a rebuild of the 2019 Koi Pond Simulator (Manifest V2, taken down with it), ported
from the background of the [About page of alexngai.com](https://alexngai.com/about/).

## Settings

- **Scene**: Random (a new one for each tab), Reef, Stream, Pond or Beach.
- **Time of day**: Auto (day from 07:00 to 19:00, both adjustable), or always Day or Night.
- **Show**: the clock, the search box (it searches with Chrome's default search engine).

They're kept in Chrome's synced storage, so they follow you between computers.

## As a wallpaper

The water also runs on its own, full screen, with nothing over it, at
[alexngai.github.io/koipond](https://alexngai.github.io/koipond/): for a desktop wallpaper, a
screen saver or a TV's browser. Its address sets it up:

- `scene`: `reef`, `stream`, `pond` or `beach` every time, or `random` (the default), a new one each
  load.
- `time`: `day` or `night` always, or `auto` (the default) by the clock: day from `day` until
  `night` (`HH:MM`, 07:00 and 19:00 unless given).
- `cycle`: minutes between new layouts (0, the default: never). With a random scene, each is a
  different scene too.

For example `?scene=beach&day=06:30&night=20:00&cycle=15`. On a Mac,
[Plash](https://sindresorhus.com/plash) shows it as the desktop wallpaper. It keeps the GPU busy,
so on battery it costs some power.

It's `index.html` and `src/wallpaper.ts`, built on its own into `pages/` (`npm run build:pages`) and
deployed to GitHub Pages on each push to `main` (`.github/workflows/pages.yml`).

## Developing

```sh
npm install
npm run dev     # the page on its own at http://localhost:5173/newtab.html (settings in localStorage)
npm test        # the day/night timing
npm run build   # type-checks, then builds the extension into dist/
npm run build:pages  # ... or the wallpaper into pages/ (at http://localhost:5173/ in dev)
npm run zip     # builds, then packs dist/ into release/koi-pond-simulator-<version>.zip for the store
npm run store   # builds, then renders the icons and the store's screenshots and promo tile (needs
                # Google Chrome and Pillow)
```

The page's address can set the scene, time of day, clock and search box for that tab alone:
`newtab.html?scene=pond&time=night&clock=0&search=0`.

To try the extension: build, open `chrome://extensions`, turn on Developer mode, then
**Load unpacked** and pick `dist/`. After rebuilding, press the reload icon on its card. The first
time a new tab opens, Chrome asks whether to keep the change: keep it.

## Layout

- `newtab.html`: the page: the water's canvases, the clock, search box, reroll button, gear and
  settings dialog.
- `src/main.ts`: starts it all and wires up the settings.
- `index.html`, `src/wallpaper.ts`: the wallpaper: the same water and fish with nothing over them,
  set up by its address. `vite.config.ts` builds it on its own with `--mode pages`, and
  `.github/workflows/pages.yml` deploys it to GitHub Pages.
- `src/settings.ts`, `src/time.ts`: the settings and their storage; day or night by the clock.
- `src/water/`: the scenes. `scene.ts` runs the WebGL water (`*.glsl`, one shader per scene,
  crossfaded), `fish.ts` the schools of fish, and `stream.ts`, `reef.ts`, `pond.ts` each scene's
  extras (the stream's boulders, leaves and bubbles, the reef's coral, the pond's lilies and rain).
  The reef and the beach ride a surf model (`surf.ts`, `surf.glsl`): a seabed and the swell crossing
  it, worked out once per layout, that both shade their water from and `beach.ts` rides its
  particles on; `shore.ts` has the beach's crab and gulls, and `glints.glsl` the caustics painted
  onto the fish. `newtab.html?scene=beach&flow` draws the beach's surf model instead.
- `public/manifest.json`: the extension's manifest (Manifest V3), copied into `dist/` as is. Its
  `version` names the zip; raise it for each store upload.
- `store/`: what the Chrome Web Store needs: the listing and privacy answers (`listing.md`), a
  privacy policy, screenshots, the promo tile, the icon's source (`icon.svg`) and `render.py`, which
  renders them.
