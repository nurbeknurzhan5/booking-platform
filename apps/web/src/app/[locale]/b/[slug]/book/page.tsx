import { notFound } from 'next/navigation';
import { serverGet } from '@/lib/server-api';
import type { PublicPageData } from '@/lib/types';
import { isLang } from '@/lib/i18n-public';
import { BookingFlow } from '@/components/public/BookingFlow';

export const metadata = { title: 'Онлайн-запись' };

export default async function BookPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isLang(locale) || !/^[a-z0-9-]{3,60}$/.test(slug)) notFound();
  const r = await serverGet<PublicPageData>(`/public/pages/${slug}?locale=${locale}`);
  if (!r.ok || !r.data) notFound();
  return <BookingFlow data={r.data} />;
}
