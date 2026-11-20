import { notFound } from 'next/navigation';
import { isLang } from '@/lib/i18n-public';
import { WaitlistOfferClient } from './WaitlistOfferClient';

export const metadata = { title: 'Освободилось время', referrer: 'no-referrer', robots: { index: false } };

export default async function WaitlistOfferPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  if (!isLang(locale) || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) notFound();
  return <WaitlistOfferClient token={token} lang={locale} />;
}
