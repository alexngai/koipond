// The new tab page: the water and its fish, a clock and a search box over them, and a settings
// dialog behind the gear.
import './style.css';
import { NAMES, startWater, type Scene, type Time } from './water/scene';
import { startFish } from './water/fish';
import { load, save, valid, type Settings } from './settings';
import { timeAt } from './time';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

let settings = await load();
// The page's address can set them for this tab alone, unsaved (as the store's screenshots do):
// newtab.html?scene=pond&time=night&clock=0&search=0
const query = new URLSearchParams(location.search);
const flag = (name: string) => (query.has(name) ? query.get(name) !== '0' : undefined);
settings = { ...settings, ...valid({ scene: query.get('scene'), time: query.get('time'), clock: flag('clock'), search: flag('search') }) };
const pick = (): Scene => (settings.scene === 'random' ? NAMES[Math.floor(Math.random() * NAMES.length)] : settings.scene);
const timeNow = (): Time => (settings.time === 'auto' ? timeAt(settings.dayFrom, settings.nightFrom) : settings.time);

let time = timeNow();
const water = startWater({ scene: pick(), time });
startFish();

// The clock, and the time of day when it's set by the clock: checked every second, eased into when
// it turns.
const clock = $('[data-clock]');
const tick = () => {
  const now = new Date();
  $('[data-clock-time]').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('[data-clock-date]').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  if (timeNow() !== time) water?.setTime((time = timeNow()));
};
tick();
setInterval(tick, 1000);

// Search with the browser's own search engine (chrome.search, in the extension), or Google when the
// page runs on its own.
const search = $<HTMLFormElement>('[data-search]');
search.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = (search.elements.namedItem('q') as HTMLInputElement).value.trim();
  if (!text) return;
  if (typeof chrome !== 'undefined' && chrome.search?.query) void chrome.search.query({ text, disposition: 'CURRENT_TAB' });
  else location.href = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
});

// What shows, after the settings change (or on opening).
const times = $('[data-times]');
const show = () => {
  clock.hidden = !settings.clock;
  search.hidden = !settings.search;
  times.hidden = settings.time !== 'auto';
};
show();

// The settings dialog: each change applies (and is saved) as it's made.
const dialog = $<HTMLDialogElement>('[data-settings]');
const form = $<HTMLFormElement>('[data-form]');
const fill = () => {
  for (const [name, value] of Object.entries(settings)) {
    const field = form.elements.namedItem(name);
    if (field instanceof RadioNodeList) field.value = String(value);
    else if (field instanceof HTMLInputElement) {
      if (field.type === 'checkbox') field.checked = Boolean(value);
      else field.value = String(value);
    }
  }
};
form.addEventListener('input', () => {
  const data = new FormData(form);
  const was = settings;
  settings = {
    scene: data.get('scene') as Settings['scene'],
    time: data.get('time') as Settings['time'],
    dayFrom: (data.get('dayFrom') as string) || was.dayFrom, // (blank while being typed)
    nightFrom: (data.get('nightFrom') as string) || was.nightFrom,
    clock: data.has('clock'),
    search: data.has('search'),
  };
  save(settings);
  // Random keeps the scene that's showing, for now: the next tab picks a new one.
  if (settings.scene !== was.scene && settings.scene !== 'random') water?.setScene(settings.scene);
  tick();
  show();
});
$('[data-open-settings]').addEventListener('click', () => {
  fill();
  dialog.showModal();
});
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close(); // a click on the backdrop
});
