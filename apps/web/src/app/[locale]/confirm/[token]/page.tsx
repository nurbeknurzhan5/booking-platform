import { notFound } from 'next/navigation';
import { isLang } from '@/lib/i18n-public';
import { ConfirmClient } from './ConfirmClient';

// Ссылка одноразовая: не передаём её в Referer и не индексируем.
export const metadata = { title: 'Подтверждение записи', referrer: 'no-referrer', robots: { index: false, follow: false } };

export default async function ConfirmPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  if (!isLang(locale) || !/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,80}$/.test(token)) notFound();
  return <ConfirmClient token={token} lang={locale} />;
}
