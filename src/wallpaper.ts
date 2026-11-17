// The wallpaper: the water on its own, full screen, for a desktop wallpaper (Plash, on macOS), a
// screen saver or a TV's browser. Built on its own into pages/ (npm run build:pages) and hosted on
// GitHub Pages as the site's index.html. Its address sets it up:
// - scene: reef, stream, pond or beach, every time; or random (the default), a new one each load.
// - time: day or night, always; or auto (the default), by the clock: day from `day` until `night`
//   (HH:MM, 07:00 and 19:00 unless given).
// - cycle: minutes between new layouts (0, the default: never). With a random scene each is a
//   different scene too, crossfading in.
// e.g. ?scene=beach&time=auto&day=06:30&night=20:00&cycle=15
import './style.css';
import { createPond, SCENES, type Scene, type Time } from './index';
import { timeAt } from './time';

const query = new URLSearchParams(location.search);
const asked = query.get('scene')?.toLowerCase();
const named = (asked === 'ocean' ? 'reef' : asked) as Scene; // the reef's shader is the ocean
const fixed = SCENES.includes(named) ? named : null;
const pick = (not?: Scene): Scene => {
  const options = SCENES.filter((n) => n !== not);
  return fixed ?? options[Math.floor(Math.random() * options.length)];
};
const hhmm = (v: string | null, fallback: string) => (v && /^\d\d:\d\d$/.test(v) ? v : fallback);
const [dayFrom, nightFrom] = [hhmm(query.get('day'), '07:00'), hhmm(query.get('night'), '19:00')];
const always = query.get('time');
const timeNow = (): Time => (always === 'day' || always === 'night' ? always : timeAt(dayFrom, nightFrom));

// In the page's own order; ?quality=N holds its detail, ?flow draws the stream's current.
let time = timeNow();
const water = createPond({ scene: pick(), time, zIndex: 'auto', quality: query.has('quality') ? Number(query.get('quality')) : undefined, flow: query.has('flow') });

// By the clock: checked every few seconds, eased into when it turns.
setInterval(() => {
  if (timeNow() !== time) water?.setTime((time = timeNow()));
}, 5000);

// A new layout every `cycle` minutes (and with a random scene, a new scene).
const cycle = Number(query.get('cycle')) || 0;
if (water && cycle > 0)
  setInterval(() => {
    if (!fixed) water.setScene(pick(water.scene));
    water.reroll();
  }, cycle * 60_000);
