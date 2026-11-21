import { notFound } from 'next/navigation';
import { serverGet } from '@/lib/server-api';
import type { PublicPageData } from '@/lib/types';
import { isLang } from '@/lib/i18n-public';
import { BookingFlow } from '@/components/public/BookingFlow';

export const metadata = { title: 'Онлайн-запись' };

export default async function BookPage({ params, searchParams }: { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<{ service?: string }> }) {
  const { locale, slug } = await params;
  const { service } = await searchParams;
  if (!isLang(locale) || !/^[a-z0-9-]{3,60}$/.test(slug)) notFound();
  const r = await serverGet<PublicPageData>(`/public/pages/${slug}?locale=${locale}`);
  if (!r.ok || !r.data) notFound();
  // ?service= — переход к записи по кнопке у конкретной услуги на странице
  return <BookingFlow data={r.data} initialServiceId={r.data.services.some((s) => s.id === service && s.onlineBooking) ? service : undefined} />;
}
