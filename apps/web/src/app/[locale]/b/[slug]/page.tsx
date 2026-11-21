import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { serverGet } from '@/lib/server-api';
import type { PublicPageData } from '@/lib/types';
import { isLang, pt } from '@/lib/i18n-public';
import { PublicPageView } from '@/components/public/PublicPageView';

type Params = Promise<{ locale: string; slug: string }>;

/**
 * Данные страницы — без кэша между запросами: блокировка, отключение, архивация филиала и окончание подписки
 * должны действовать сразу (§2.4). С кэшем `revalidate` Next продолжал отдавать прежнюю версию с кнопкой записи,
 * когда API уже отвечал 404. `cache()` объединяет запрос метаданных и страницы в рамках одного обращения.
 */
const load = cache(async (locale: string, slug: string) => {
  if (!isLang(locale) || !/^[a-z0-9-]{3,60}$/.test(slug)) notFound();
  return serverGet<PublicPageData>(`/public/pages/${slug}?locale=${locale}`);
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  const r = await load(locale, slug);
  return { title: r.data ? `${r.data.content.title} — ${pt(locale, 'book')}` : pt(locale, 'notFound') };
}

/** Публичная страница филиала по постоянной ссылке /{locale}/b/{slug} (§13). */
export default async function BranchPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  const r = await load(locale, slug);
  if (!r.ok || !r.data) {
    const reason = r.error?.details?.reason;
    // Причина недоступности сохраняется для корректного отображения посетителю (§2.4).
    if (r.status === 404 && reason && reason !== 'page_disabled') {
      return (
        <main className="flex min-h-screen items-center justify-center p-6 text-center">
          <div>
            <h1 className="text-2xl font-semibold">{pt(locale, 'unavailable')}</h1>
          </div>
        </main>
      );
    }
    notFound();
  }
  return <PublicPageView data={r.data} />;
}
