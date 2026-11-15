# Koi Pond

A Chrome extension that puts a living water scene on every new tab: a coral reef, a mountain stream
or a koi pond, by day or by night, with fish that swim away from your cursor. Over it, a clock and a
search box (each optional), and a settings dialog behind the gear in the corner.

Ported from the About page of [alexngai.github.io](https://github.com/alexngai/portfolio).

## Settings

- **Scene**: Random (a new one for each tab), Reef, Stream or Pond.
- **Time of day**: Auto (day from 07:00 to 19:00, both adjustable), or always Day or Night.
- **Show**: the clock, the search box (it searches with Chrome's default search engine).

They're kept in Chrome's synced storage, so they follow you between computers.

## Developing

```sh
npm install
npm run dev     # the page on its own at http://localhost:5173/newtab.html (settings in localStorage)
npm test        # the day/night timing
npm run build   # type-checks, then builds the extension into dist/
```

To try the extension: build, open `chrome://extensions`, turn on Developer mode, then
**Load unpacked** and pick `dist/`. After rebuilding, press the reload icon on its card. The first
time a new tab opens, Chrome asks whether to keep the change: keep it.

## Layout

- `newtab.html`: the page: the water's canvases, the clock, search box, gear and settings dialog.
- `src/main.ts`: starts it all and wires up the settings.
- `src/settings.ts`, `src/time.ts`: the settings and their storage; day or night by the clock.
- `src/water/`: the scenes. `scene.ts` runs the WebGL water (`*.glsl`, one shader per scene,
  crossfaded), `fish.ts` the schools of fish, and `stream.ts`, `reef.ts`, `pond.ts` each scene's
  extras (the stream's boulders, leaves and bubbles, the reef's coral, the pond's lilies and rain).
- `public/manifest.json`: the extension's manifest (Manifest V3), copied into `dist/` as is.
