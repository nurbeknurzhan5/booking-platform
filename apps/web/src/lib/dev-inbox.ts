/**
 * «Тестовый телефон» (/dev/phone, ссылка open-test-phone): только при явном флаге NEXT_PUBLIC_DEV_INBOX_ENABLED=true.
 * Переменная NEXT_PUBLIC_* подставляется при сборке (next build / next dev), поэтому флаг задаётся до сборки;
 * в production по умолчанию выключено. Сам ящик сообщений на стороне API включается отдельно (DEV_INBOX_ENABLED=true).
 */
export const DEV_INBOX_ENABLED = process.env.NEXT_PUBLIC_DEV_INBOX_ENABLED === 'true';
