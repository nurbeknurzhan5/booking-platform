import { notFound } from 'next/navigation';
import { isLang } from '@/lib/i18n-public';
import { ManageClient } from './ManageClient';

export const metadata = { title: 'Управление записью', referrer: 'no-referrer' };

export default async function ManagePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  if (!isLang(locale) || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) notFound();
  return <ManageClient token={token} lang={locale} />;
}
