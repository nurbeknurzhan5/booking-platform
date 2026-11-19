export type Lang = 'ru' | 'kk' | 'en';

const intlLocale = (l: string) => (l === 'kk' ? 'kk-KZ' : l === 'en' ? 'en-GB' : 'ru-RU');

export function money(v: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(v)} ₸`;
}

export function dateTime(iso: string, tz: string, lang: string = 'ru'): string {
  return new Intl.DateTimeFormat(intlLocale(lang), { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function dateOnly(iso: string, tz: string, lang: string = 'ru'): string {
  return new Intl.DateTimeFormat(intlLocale(lang), { timeZone: tz, weekday: 'short', day: 'numeric', month: 'long' }).format(new Date(iso));
}

export function timeOnly(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** Локальная дата YYYY-MM-DD в часовом поясе филиала. */
export function localISODate(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** ISO-момент начала локального дня в часовом поясе филиала (без хардкода смещения). */
export function zonedStartOfDay(date: string, tz: string): string {
  const guess = new Date(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const offset = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayName(isoWeekday: number, lang: string = 'ru'): string {
  // 2024-01-01 — понедельник
  const d = new Date(Date.UTC(2024, 0, isoWeekday));
  return new Intl.DateTimeFormat(intlLocale(lang), { weekday: 'long', timeZone: 'UTC' }).format(d);
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

export function minutesLabel(m: number, lang: string = 'ru'): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const H = lang === 'en' ? 'h' : lang === 'kk' ? 'сағ' : 'ч';
  const M = lang === 'en' ? 'min' : 'мин';
  return [h ? `${h} ${H}` : '', mm ? `${mm} ${M}` : ''].filter(Boolean).join(' ') || `0 ${M}`;
}
