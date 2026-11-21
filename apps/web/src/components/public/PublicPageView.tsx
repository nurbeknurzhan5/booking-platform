'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { PublicPageData } from '@/lib/types';
import { pt } from '@/lib/i18n-public';
import { money, minutesLabel, weekdayName, formatPhone, shortDate } from '@/lib/format';
import { captureUtm, track } from '@/lib/analytics';
import { MapBlock } from './MapBlock';

const SOCIAL_ICONS: Record<string, string> = {
  instagram: '📸',
  whatsapp: '💬',
  telegram: '✈️',
  tiktok: '🎵',
  facebook: '📘',
  youtube: '▶️',
  vk: '🅥',
  threads: '🧵',
  x: '✖️',
  '2gis': '🗺️',
  link: '🔗',
};

type Layout = PublicPageData['template']['layout'];

const L: Record<Layout, { hero: string; h1: string; section: string; card: string; radius: string; heading: string }> = {
  classic: { hero: 'text-center py-14 sm:py-20', h1: 'text-3xl sm:text-5xl font-serif', section: 'py-10', card: 'border tpl-border', radius: 'rounded-lg', heading: 'text-2xl font-serif text-center mb-6' },
  modern: { hero: 'py-12 sm:py-16', h1: 'text-3xl sm:text-5xl font-bold tracking-tight', section: 'py-10', card: 'shadow-md', radius: 'rounded-2xl', heading: 'text-2xl font-bold mb-5' },
  minimal: { hero: 'py-10', h1: 'text-2xl sm:text-4xl font-semibold', section: 'py-8 border-t tpl-border', card: '', radius: 'rounded-none', heading: 'text-lg font-semibold uppercase tracking-widest mb-4' },
  bold: { hero: 'py-16 sm:py-24 text-center', h1: 'text-4xl sm:text-6xl font-black uppercase', section: 'py-12', card: 'border-2 tpl-border', radius: 'rounded-xl', heading: 'text-3xl font-black uppercase mb-6 tpl-accent' },
};

export function PublicPageView({ data, preview = false, device }: { data: PublicPageData; preview?: boolean; device?: 'mobile' | 'desktop' }) {
  const lang = data.locale;
  const t = (k: Parameters<typeof pt>[1]) => pt(lang, k);
  const lay = L[data.template.layout] ?? L.classic;
  const c = data.template.colors;
  const style = { '--tpl-primary': c.primary, '--tpl-accent': c.accent, '--tpl-bg': c.background, '--tpl-surface': c.surface, '--tpl-text': c.text } as CSSProperties;
  const bookingOpen = data.availability.bookingEnabled && data.availability.mode === 'open';
  const bookHref = `/${lang}/b/${data.slug}/book`;
  const pos = data.template.bookingButtonPosition;
  const [canEdit, setCanEdit] = useState<{ canEdit: boolean; organizationId?: string; branchId?: string } | null>(null);

  useEffect(() => {
    if (preview) return;
    const utm = captureUtm(new URLSearchParams(location.search));
    track(data.slug, 'page_view', { utm });
    fetch(`/api/v1/public/pages/${data.slug}/can-edit`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then(setCanEdit)
      .catch(() => undefined);
  }, [data.slug, preview]);

  const onBookClick = () => {
    if (!preview) track(data.slug, 'booking_click');
  };

  const BookButton = ({ big }: { big?: boolean }) =>
    bookingOpen ? (
      <Link href={preview ? '#' : bookHref} onClick={onBookClick} className={`tpl-btn inline-flex items-center justify-center font-semibold shadow-sm ${lay.radius} ${big ? 'px-8 py-4 text-lg' : 'px-5 py-2.5 text-sm'}`} data-testid="book-button">
        {t('book')}
      </Link>
    ) : null;

  const byCategory = useMemo(() => {
    const groups = new Map<string, typeof data.services>();
    for (const s of data.services) {
      const k = s.category?.name ?? '';
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    return [...groups.entries()];
  }, [data.services]);

  // Одинаковые места (ПК 1…6 с одним описанием и фото) показываются одной карточкой «ПК · 6 мест».
  const resourceGroups = useMemo(() => {
    const groups = new Map<string, { r: (typeof data.resources)[number]; count: number; name: string }>();
    for (const r of data.resources ?? []) {
      const key = [r.type, r.description ?? '', r.photo?.medium ?? '', [...r.serviceIds].sort().join(',')].join('|');
      const g = groups.get(key);
      if (g) g.count++;
      else groups.set(key, { r, count: 1, name: r.name });
    }
    return [...groups.values()].map((g) => ({ ...g, name: g.count > 1 ? g.name.replace(/\s*№?\d+$/, '') : g.name }));
  }, [data.resources]);

  const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
    <section id={id} className={`${lay.section} px-4`}>
      <div className="mx-auto max-w-5xl">
        <h2 className={lay.heading}>{title}</h2>
        {children}
      </div>
    </section>
  );

  const sections: Record<string, () => ReactNode> = {
    hero: () => (
      <header key="hero" className={`relative overflow-hidden px-4 ${lay.hero}`}>
        {data.content.cover && data.template.layout !== 'minimal' && (
          <div className="absolute inset-0 -z-0 opacity-25" style={{ backgroundImage: `url(${data.content.cover.large})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        )}
        <div className={`relative mx-auto max-w-5xl ${data.template.layout === 'modern' ? 'grid items-center gap-8 sm:grid-cols-2' : ''}`}>
          <div>
            {data.content.logo && <img src={data.content.logo.thumb} alt="" className={`mb-4 h-16 w-16 object-cover ${data.template.layout === 'classic' || data.template.layout === 'bold' ? 'mx-auto' : ''} ${lay.radius}`} />}
            <h1 className={lay.h1}>{data.content.title}</h1>
            {data.content.tagline && <p className="tpl-muted mt-3 text-lg">{data.content.tagline}</p>}
            {data.branch.address && <p className="tpl-muted mt-2 text-sm">📍 {data.branch.address}</p>}
            {data.reviews.average !== null && (
              <p className="mt-2 text-sm"><span className="tpl-accent">★</span> {data.reviews.average} · {data.reviews.count} {t('reviews').toLowerCase()}</p>
            )}
            <div className="mt-6">{(pos === 'header' || pos === 'bottom' || pos === 'floating' || pos === 'after_services') && <BookButton big />}</div>
          </div>
          {data.template.layout === 'modern' && data.content.cover && <img src={data.content.cover.medium} alt="" className={`hidden w-full object-cover sm:block ${lay.radius}`} />}
        </div>
      </header>
    ),
    about: () =>
      data.content.about ? (
        <Section key="about" id="about" title={t('about')}>
          <p className="whitespace-pre-line leading-relaxed">{data.content.about}</p>
        </Section>
      ) : null,
    gallery: () =>
      data.content.gallery.length ? (
        <Section key="gallery" id="gallery" title={t('gallery')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.content.gallery.map((g, i) => (
              <img key={i} src={g.medium} alt="" loading="lazy" className={`aspect-square w-full object-cover ${lay.radius}`} />
            ))}
          </div>
        </Section>
      ) : null,
    services: () => (
      <Section key="services" id="services" title={t('services')}>
        {byCategory.map(([cat, list]) => (
          <div key={cat} className="mb-6">
            {cat && <h3 className="tpl-primary mb-3 font-semibold">{cat}</h3>}
            <ul className={data.template.layout === 'minimal' ? 'divide-y tpl-border' : 'grid gap-3 sm:grid-cols-2'}>
              {list.map((s) => (
                <li key={s.id} className={data.template.layout === 'minimal' ? 'flex items-start justify-between gap-4 py-3' : `tpl-surface flex gap-3 p-4 ${lay.card} ${lay.radius}`}>
                  {s.photo && data.template.layout !== 'minimal' && <img src={s.photo.thumb} alt="" loading="lazy" className={`h-16 w-16 flex-none object-cover ${lay.radius}`} />}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{s.name}</div>
                    {s.description && <p className="tpl-muted mt-1 text-sm">{s.description}</p>}
                    <p className="tpl-muted mt-1 text-xs">{minutesLabel(s.durationMinutes, lang)}</p>
                  </div>
                  <div className="whitespace-nowrap font-semibold">{money(s.price)}</div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {pos === 'after_services' && <div className="mt-6 text-center"><BookButton big /></div>}
      </Section>
    ),
    resources: () =>
      data.resources?.length ? (
        <Section key="resources" id="resources" title={t('resourcesTitle')}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="public-resources">
            {resourceGroups.map(({ r, count, name }) => {
              const tariffs = data.services.filter((s) => r.serviceIds.includes(s.id));
              return (
                <li key={r.id} className={`tpl-surface overflow-hidden ${lay.card} ${lay.radius}`}>
                  {r.photo && <img src={r.photo.medium} alt="" loading="lazy" className="aspect-[3/2] w-full object-cover" />}
                  <div className="p-4">
                    <div className="tpl-muted text-xs uppercase tracking-wide">
                      {t(`rt_${r.type}` as Parameters<typeof pt>[1])}
                      {count > 1 && ` · ${count} ${t('placesCount')}`}
                    </div>
                    <div className="mt-0.5 text-lg font-semibold">{name}</div>
                    {r.description && <p className="tpl-muted mt-1 whitespace-pre-line text-sm">{r.description}</p>}
                    {tariffs.length > 0 && (
                      <ul className="mt-3 space-y-1 text-sm">
                        {tariffs.map((s) => (
                          <li key={s.id} className="flex justify-between gap-3">
                            <span>{s.name}</span>
                            <b className="whitespace-nowrap">{money(s.price)}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null,
    specialists: () =>
      data.specialists.length ? (
        <Section key="specialists" id="specialists" title={t('specialists')}>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {data.specialists.map((s) => (
              <li key={s.id} className={`tpl-surface p-3 text-center ${lay.card} ${lay.radius}`}>
                {s.photo ? (
                  <img src={s.photo.medium} alt="" loading="lazy" className={`mx-auto mb-2 aspect-square w-full object-cover ${lay.radius}`} />
                ) : (
                  <div className={`tpl-btn mx-auto mb-2 flex aspect-square w-full items-center justify-center text-3xl font-bold ${lay.radius}`}>{s.name.slice(0, 1)}</div>
                )}
                <div className="font-medium">{s.name}</div>
                {s.specialization && <div className="tpl-muted text-xs">{s.specialization}</div>}
              </li>
            ))}
          </ul>
        </Section>
      ) : null,
    promotions: () =>
      data.promotions.length ? (
        <Section key="promotions" id="promotions" title={t('promotions')}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.promotions.map((p) => (
              <li key={p.id} className={`tpl-surface p-4 ${lay.card} ${lay.radius}`}>
                <div className="tpl-accent text-2xl font-bold">−{p.discountType === 'percent' ? `${p.discountValue}%` : money(p.discountValue)}</div>
                <div className="font-medium">{p.name}</div>
                {p.description && <p className="tpl-muted text-sm">{p.description}</p>}
                {p.code && <p className="mt-1 text-sm">{t('promoCode')}: <code className="font-mono font-semibold">{p.code}</code></p>}
                {p.endsAt && <p className="tpl-muted text-xs">{t('until')} {shortDate(p.endsAt, lang)}</p>}
              </li>
            ))}
          </ul>
        </Section>
      ) : null,
    reviews: () => (
      <Section key="reviews" id="reviews" title={t('reviews')}>
        {data.reviews.items.length === 0 ? (
          <p className="tpl-muted">{t('noReviews')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.reviews.items.map((r) => (
              <li key={r.id} className={`tpl-surface p-4 ${lay.card} ${lay.radius}`}>
                <div className="tpl-accent">{'★'.repeat(r.rating)}<span className="opacity-30">{'★'.repeat(5 - r.rating)}</span></div>
                {r.text && <p className="mt-1 text-sm">{r.text}</p>}
                <p className="tpl-muted mt-2 text-xs">{r.authorName} · {shortDate(r.createdAt, lang)}</p>
                {r.reply && <p className="tpl-muted mt-2 border-l-2 tpl-border pl-2 text-sm">{r.reply}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    ),
    schedule: () => (
      <Section key="schedule" id="schedule" title={t('schedule')}>
        <ul className="max-w-md space-y-1 text-sm">
          {data.schedule.map((d) => (
            <li key={d.weekday} className="flex justify-between gap-4 border-b tpl-border py-1.5">
              <span className="capitalize">{weekdayName(d.weekday, lang)}</span>
              <span>{d.intervals.length ? d.intervals.map((i) => `${i.start}–${i.end}`).join(', ') : t('dayOff')}</span>
            </li>
          ))}
        </ul>
      </Section>
    ),
    contacts: () => (
      <Section key="contacts" id="contacts" title={t('contacts')}>
        <div className="space-y-2">
          {data.branch.address && <p>📍 {data.branch.address}</p>}
          {data.branch.phone && <p>📞 <a className="tpl-primary underline" href={`tel:${data.branch.phone}`}>{formatPhone(data.branch.phone)}</a></p>}
        </div>
      </Section>
    ),
    map: () =>
      data.branch.map ? (
        <Section key="map" id="map" title={t('map')}>
          <MapBlock map={data.branch.map} label={t('openIn2gis')} />
        </Section>
      ) : null,
    socials: () =>
      data.content.socials.length ? (
        <Section key="socials" id="socials" title={t('socials')}>
          <ul className="flex flex-wrap gap-2">
            {data.content.socials.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className={`tpl-surface inline-flex items-center gap-2 px-4 py-2 text-sm ${lay.card} ${lay.radius}`}>
                  <span aria-hidden>{SOCIAL_ICONS[s.platform] ?? SOCIAL_ICONS.link}</span>
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null,
  };

  return (
    <div className={`tpl min-h-screen ${device === 'mobile' ? 'mx-auto max-w-[390px] border-x' : ''}`} style={style} lang={lang}>
      <div className="sticky top-0 z-30 border-b tpl-border tpl-surface/90 backdrop-blur" style={{ background: c.surface }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2">
          <span className="truncate font-semibold">{data.branch.name}</span>
          <div className="flex items-center gap-2">
            <nav aria-label="language" className="flex gap-1 text-xs">
              {data.availableLocales.map((l) => (
                <Link key={l} href={preview ? '#' : `/${l}/b/${data.slug}`} className={`rounded px-1.5 py-0.5 uppercase ${l === lang ? 'tpl-btn' : 'tpl-muted'}`}>{l}</Link>
              ))}
            </nav>
            {pos === 'header' && <BookButton />}
          </div>
        </div>
      </div>

      {preview && <div className="bg-amber-200 px-4 py-1 text-center text-xs text-amber-900">Предпросмотр черновика — посетители видят опубликованную версию</div>}
      {canEdit?.canEdit && (
        <div className="fixed left-3 top-14 z-40">
          <Link href={`/dashboard/${canEdit.organizationId}/branches/${canEdit.branchId}/page-editor`} className="rounded-full bg-slate-900 px-3 py-1.5 text-xs text-white shadow-lg">✏️ {t('editPage')}</Link>
        </div>
      )}
      {(data.autoTranslated || data.missingTranslation) && (
        <div className="bg-sky-100 px-4 py-2 text-center text-xs text-sky-900" role="note">
          {data.autoTranslated ? t('autoTranslated') : t('missingTranslation')}
        </div>
      )}
      {data.availability.mode === 'closed_notice' && (
        <div className="px-4 pt-6">
          <div className={`tpl-surface mx-auto max-w-5xl p-5 text-center ${lay.card} ${lay.radius}`} data-testid="closed-notice">
            <h2 className="text-xl font-semibold">{t('closedTitle')}</h2>
            <p className="tpl-muted mt-2">{data.content.closedMessage ?? t('closedText')}</p>
            {data.branch.phone && <a className="tpl-primary mt-2 inline-block font-semibold" href={`tel:${data.branch.phone}`}>{formatPhone(data.branch.phone)}</a>}
          </div>
        </div>
      )}

      <main>{data.template.sectionOrder.map((s) => sections[s]?.())}</main>

      <footer className="tpl-muted px-4 py-8 pb-28 text-center text-xs">{data.branch.organizationName}</footer>

      {bookingOpen && (pos === 'floating' || pos === 'bottom') && (
        <div className={pos === 'floating' ? 'fixed bottom-5 right-5 z-40' : 'fixed inset-x-0 bottom-0 z-40 border-t tpl-border p-3'} style={pos === 'bottom' ? { background: c.surface } : undefined}>
          <div className={pos === 'bottom' ? 'mx-auto flex max-w-5xl justify-center' : ''}>
            <BookButton big={pos === 'bottom'} />
          </div>
        </div>
      )}
    </div>
  );
}
