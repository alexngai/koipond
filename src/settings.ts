// The settings: kept in Chrome's synced storage, so they follow you between computers, or in the
// browser's local storage when the page runs on its own (npm run dev).
import { NAMES, type Scene, type Time } from './water/scene';

export type Settings = {
  scene: Scene | 'random'; // random: a new one for each tab
  time: Time | 'auto'; // auto: by the clock, between dayFrom and nightFrom
  dayFrom: string; // 'HH:MM'
  nightFrom: string;
  clock: boolean;
  search: boolean;
};

export const DEFAULTS: Settings = { scene: 'random', time: 'auto', dayFrom: '07:00', nightFrom: '19:00', clock: true, search: true };

// What each may be, so whatever an older version (or a hand) left in storage can't break the page.
const hhmm = (v: unknown) => typeof v === 'string' && /^\d\d:\d\d$/.test(v);
const VALID: { [K in keyof Settings]: (v: unknown) => boolean } = {
  scene: (v) => v === 'random' || NAMES.includes(v as Scene),
  time: (v) => v === 'auto' || v === 'day' || v === 'night',
  dayFrom: hhmm,
  nightFrom: hhmm,
  clock: (v) => typeof v === 'boolean',
  search: (v) => typeof v === 'boolean',
};

const KEY = 'settings';
const sync = typeof chrome !== 'undefined' ? chrome.storage?.sync : undefined;

export async function load(): Promise<Settings> {
  try {
    const saved: unknown = sync ? (await sync.get(KEY))[KEY] : JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const known = Object.entries(saved && typeof saved === 'object' ? saved : {}).filter(([k, v]) => k in VALID && VALID[k as keyof Settings](v));
    return { ...DEFAULTS, ...Object.fromEntries(known) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(settings: Settings) {
  try {
    if (sync) void sync.set({ [KEY]: settings });
    else localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}
