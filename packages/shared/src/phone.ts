/**
 * Нормализация телефонных номеров Казахстана в E.164 (+7XXXXXXXXXX).
 * Мобильные номера Казахстана: +7 7XX XXX XX XX. Городские: +7 7XX/6XX.
 * Логика вынесена в отдельный модуль, чтобы при выходе на другие рынки добавить правила.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let d = digits.startsWith('+') ? digits.slice(1) : digits;
  if (!/^\d+$/.test(d)) return null;
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  if (d.length !== 11 || !d.startsWith('7')) return null;
  return '+' + d;
}

/**
 * Мобильный номер Казахстана (используется для OTP).
 * Коды операторов: 700–709, 747, 750–751, 760–764, 771, 775–778.
 * Городские коды (+7 71x/72x/73x…) сюда не входят.
 */
export function isKzMobile(e164: string): boolean {
  return /^\+77(0\d|47|5[01]|6[0-4]|7[1578])\d{7}$/.test(e164);
}

/** Любой номер Казахстана (мобильный или городской), например для телефона филиала. */
export function isKzPhone(e164: string): boolean {
  return /^\+7[67]\d{9}$/.test(e164);
}

export function normalizeKzMobile(input: string): string | null {
  const n = normalizePhone(input);
  return n && isKzMobile(n) ? n : null;
}

/** Маскирование номера для логов: +7701*****67 */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return '***';
  return e164.slice(0, 5) + '*'.repeat(e164.length - 7) + e164.slice(-2);
}

/** Формат для отображения: +7 701 123 45 67 */
export function formatPhone(e164: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}
