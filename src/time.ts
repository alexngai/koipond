// Day or night by the clock, for the 'auto' time of day: day from dayFrom until nightFrom ('HH:MM',
// local time), night the rest. If day starts after night does (a night owl's settings), day runs
// past midnight.
export function timeAt(dayFrom: string, nightFrom: string, now = new Date()): 'day' | 'night' {
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const [t, day, night] = [now.getHours() * 60 + now.getMinutes(), minutes(dayFrom), minutes(nightFrom)];
  const isDay = day <= night ? t >= day && t < night : t >= day || t < night;
  return isDay ? 'day' : 'night';
}
