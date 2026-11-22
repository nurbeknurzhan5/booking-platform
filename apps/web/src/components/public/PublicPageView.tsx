'use client';

import { Clock, MapPin, Phone } from 'lucide-react';
import { DARK_BRANDS, SocialIcon } from './SocialIcon';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicPageData } from '@/lib/types';
import { pt } from '@/lib/i18n-public';
import { money, minutesLabel, weekdayName, formatPhone, shortDate } from '@/lib/format';
import { captureUtm, track } from '@/lib/analytics';
import { themeRoot } from '@/lib/theme';
import { MapBlock } from './MapBlock';


type Key = Parameters<typeof pt>[1];

/** Звёзды рейтинга. */
const Stars = ({ value }: { value: number }) => (
  <span className="tpl-accent" aria-label={`${value} / 5`}>
    {'★'.repeat(Math.round(value))}
    <span className="opacity-25">{'★'.repeat(5 - Math.round(value))}</span>
  </span>
);

/** Публичная страница филиала (§13) в выбранной теме (макет + стиль + цветовая схема). */
export function PublicPageView({ data, preview = false, device }: { data: PublicPageData; preview?: boolean; device?: 'mobile' | 'desktop' }) {
  const lang = data.locale;
  const t = (k: Key) => pt(lang, k);
  const { style, className, theme } = themeRoot(data.template);
  const c = data.template.colors;
  const bookingOpen = data.availability.bookingEnabled && data.availability.mode === 'open';
  const bookHref = `/${lang}/b/${data.slug}/book`;
  const pos = data.template.bookingButtonPosition;
  const centered = theme.hero === 'centered' || data.template.layout === 'luxe';
  const [canEdit, setCanEdit] = useState<{ canEdit: boolean; organizationId?: string; branchId?: string } | null>(null);
  // День недели по часовому поясу филиала — только в браузере, чтобы разметка сервера и клиента совпадала.
  const [todayWd, setTodayWd] = useState<number | null>(null);

  useEffect(() => {
    const wd = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: data.branch.timezone }).format(new Date());
    setTodayWd(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd) + 1);
    if (preview) return;
    const utm = captureUtm(new URLSearchParams(location.search));
    track(data.slug, 'page_view', { utm });
    fetch(`/api/v1/public/pages/${data.slug}/can-edit`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then(setCanEdit)
      .catch(() => undefined);
  }, [data.slug, data.branch.timezone, preview]);

  const onBookClick = () => {
    if (!preview) track(data.slug, 'booking_click');
  };

  const BookButton = ({ big }: { big?: boolean }) =>
    bookingOpen ? (
      <Link
        href={preview ? '#' : bookHref}
        onClick={onBookClick}
        className={`tpl-btn tpl-pill inline-flex items-center justify-center gap-2 font-semibold shadow-lg transition-transform hover:-translate-y-0.5 ${big ? 'px-8 py-4 text-base sm:text-lg' : 'px-5 py-2.5 text-sm'}`}
        data-testid="book-button"
      >
        {t('book')} <span aria-hidden>→</span>
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

  const order = data.template.sectionOrder;
  const has = (s: string) => order.includes(s);
  const nav = (
    [
      ['services', 'services'],
      ['resources', 'resourcesTitle'],
      ['specialists', 'specialists'],
      ['reviews', 'reviews'],
      ['contacts', 'contacts'],
    ] as Array<[string, Key]>
  ).filter(([s]) => has(s) && (s !== 'resources' || !!data.resources?.length) && (s !== 'specialists' || data.specialists.length > 0));

  const Section = ({ id, title, children, soft }: { id: string; title: string; children: ReactNode; soft?: boolean }) => (
    <section id={id} className={`scroll-mt-16 px-4 py-12 sm:py-16 ${soft ? 'tpl-soft' : ''}`}>
      <div className="mx-auto max-w-6xl">
        <h2 className={`tpl-heading mb-8 text-2xl sm:text-3xl ${centered ? 'text-center' : ''}`}>{title}</h2>
        {children}
      </div>
    </section>
  );

  const cover = data.content.cover;
  const heroInfo = (light: boolean) => (
    <>
      {data.content.logo && <img src={data.content.logo.thumb} alt="" className={`tpl-r mb-5 h-16 w-16 object-cover shadow-md ${centered ? 'mx-auto' : ''}`} />}
      <h1 className="tpl-heading text-4xl leading-[1.05] sm:text-6xl">{data.content.title}</h1>
      {data.content.tagline && <p className={`mt-4 max-w-2xl text-lg sm:text-xl ${light ? 'text-white/85' : 'tpl-muted'} ${centered ? 'mx-auto' : ''}`}>{data.content.tagline}</p>}
      <div className={`mt-5 flex flex-wrap gap-2 text-sm ${centered ? 'justify-center' : ''}`}>
        {data.branch.address && <span className={`tpl-pill px-3 py-1 ${light ? 'bg-white/15 text-white backdrop-blur' : 'tpl-chip'}`}><MapPin className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />{data.branch.address}</span>}
        {data.reviews.average !== null && (
          <span className={`tpl-pill px-3 py-1 ${light ? 'bg-white/15 text-white backdrop-blur' : 'tpl-chip'}`}>★ {data.reviews.average} · {data.reviews.count} {t('reviews').toLowerCase()}</span>
        )}
      </div>
      <div className={`mt-8 flex flex-wrap items-center gap-3 ${centered ? 'justify-center' : ''}`}>
        <BookButton big />
        {has('services') && (
          <a href="#services" className={`tpl-pill px-6 py-4 text-base font-semibold ${light ? 'border border-white/50 text-white hover:bg-white/10' : 'tpl-border border hover:opacity-80'}`}>
            {t('seePrices')}
          </a>
        )}
      </div>
    </>
  );

  const hero = (): ReactNode => {
    if (theme.hero === 'cover') {
      return (
        <header key="hero" className="relative isolate overflow-hidden">
          {cover ? (
            <img src={cover.large ?? cover.medium} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 -z-10" style={{ background: `linear-gradient(135deg, ${c.primary}, ${c.accent})` }} />
          )}
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/45 to-black/15" />
          <div className={`mx-auto flex min-h-[64vh] max-w-6xl flex-col justify-end px-4 pb-14 pt-24 text-white ${centered ? 'items-center text-center' : ''}`}>{heroInfo(true)}</div>
        </header>
      );
    }
    if (theme.hero === 'split') {
      return (
        <header key="hero" className="relative overflow-hidden px-4 py-14 sm:py-20">
          <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-25 blur-3xl" style={{ background: c.primary }} />
          <div className="pointer-events-none absolute -bottom-40 -left-24 h-80 w-80 rounded-full opacity-20 blur-3xl" style={{ background: c.accent }} />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-[1.1fr_1fr]">
            <div>{heroInfo(false)}</div>
            {cover && <img src={cover.medium} alt="" className="tpl-r aspect-[4/3] w-full object-cover shadow-2xl" />}
          </div>
        </header>
      );
    }
    if (theme.hero === 'centered') {
      return (
        <header
          key="hero"
          className="px-4 py-20 text-center sm:py-28"
          style={cover ? { backgroundImage: `linear-gradient(color-mix(in srgb, ${c.background} 84%, transparent), ${c.background}), url(${cover.large ?? cover.medium})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
          <div className="mx-auto max-w-4xl">{heroInfo(false)}</div>
        </header>
      );
    }
    return (
      <header key="hero" className="px-4 pb-8 pt-14 sm:pt-20">
        <div className="mx-auto max-w-6xl">{heroInfo(false)}</div>
      </header>
    );
  };

  const sections: Record<string, () => ReactNode> = {
    hero,
    about: () =>
      data.content.about ? (
        <Section key="about" id="about" title={t('about')}>
          <p className={`max-w-3xl whitespace-pre-line text-lg leading-relaxed ${centered ? 'mx-auto text-center' : ''}`}>{data.content.about}</p>
        </Section>
      ) : null,
    gallery: () =>
      data.content.gallery.length ? (
        <Section key="gallery" id="gallery" title={t('gallery')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.content.gallery.map((g, i) => (
              <img key={i} src={g.medium} alt="" loading="lazy" className={`tpl-r w-full object-cover ${i === 0 && data.content.gallery.length % 2 === 1 ? 'col-span-2 aspect-[2/1] sm:col-span-1 sm:aspect-square' : 'aspect-square'}`} />
            ))}
          </div>
        </Section>
      ) : null,
    services: () => (
      <Section key="services" id="services" title={t('services')} soft>
        {byCategory.map(([cat, list]) => (
          <div key={cat} className="mb-8 last:mb-0">
            {cat && <h3 className="tpl-primary mb-3 text-sm font-semibold uppercase tracking-wider">{cat}</h3>}
            <ul className={theme.cards === 'flat' ? '' : 'grid gap-3 md:grid-cols-2'}>
              {list.map((s) => (
                <li key={s.id} className={`tpl-card flex items-start gap-4 ${theme.cards === 'flat' ? 'py-4' : 'p-4 sm:p-5'}`}>
                  {s.photo && theme.cards !== 'flat' && <img src={s.photo.thumb} alt="" loading="lazy" className="tpl-r-sm h-16 w-16 flex-none object-cover" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{s.name}</div>
                    {s.description && <p className="tpl-muted mt-1 text-sm">{s.description}</p>}
                    <p className="tpl-muted mt-1.5 flex items-center gap-1 text-xs"><Clock className="h-3.5 w-3.5" aria-hidden />{minutesLabel(s.durationMinutes, lang)}</p>
                  </div>
                  <div className="flex flex-none flex-col items-end gap-2">
                    <div className="whitespace-nowrap text-lg font-bold">{money(s.price)}</div>
                    {bookingOpen && s.onlineBooking && (
                      <Link href={preview ? '#' : `${bookHref}?service=${s.id}`} onClick={onBookClick} className="tpl-chip tpl-pill whitespace-nowrap px-3 py-1 text-xs font-semibold" data-testid="book-service">
                        {t('bookThis')}
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {pos === 'after_services' && <div className="mt-8 text-center"><BookButton big /></div>}
      </Section>
    ),
    resources: () =>
      data.resources?.length ? (
        <Section key="resources" id="resources" title={t('resourcesTitle')}>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="public-resources">
            {resourceGroups.map(({ r, count, name }) => {
              const tariffs = data.services.filter((s) => r.serviceIds.includes(s.id));
              return (
                <li key={r.id} className="tpl-card overflow-hidden">
                  {r.photo && <img src={r.photo.medium} alt="" loading="lazy" className="aspect-[3/2] w-full object-cover" />}
                  <div className="p-5">
                    <div className="tpl-muted text-xs uppercase tracking-wide">
                      {t(`rt_${r.type}` as Key)}
                      {count > 1 && ` · ${count} ${t('placesCount')}`}
                    </div>
                    <div className="tpl-heading mt-1 text-xl">{name}</div>
                    {r.description && <p className="tpl-muted mt-2 whitespace-pre-line text-sm">{r.description}</p>}
                    {tariffs.length > 0 && (
                      <ul className="mt-4 space-y-1.5 border-t tpl-border pt-3 text-sm">
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
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {data.specialists.map((s) => (
              <li key={s.id} className="tpl-card flex flex-col items-center p-5 text-center">
                {s.photo ? (
                  <img src={s.photo.medium} alt="" loading="lazy" className="mx-auto mb-3 h-24 w-24 rounded-full object-cover shadow-md" />
                ) : (
                  <div className="mx-auto mb-3 flex h-24 w-24 items-center justify-center rounded-full text-3xl font-bold text-white shadow-md" style={{ background: `linear-gradient(135deg, ${c.primary}, ${c.accent})` }}>
                    {s.name.slice(0, 1)}
                  </div>
                )}
                <div className="font-semibold">{s.name}</div>
                {s.specialization && <div className="tpl-muted text-sm">{s.specialization}</div>}
                {s.description && <p className="tpl-muted mt-2 line-clamp-3 text-xs">{s.description}</p>}
                {data.availability.bookingEnabled && (
                  <Link href={preview ? '#' : `${bookHref}?specialist=${s.id}`} onClick={onBookClick} className="tpl-chip tpl-pill mt-3 inline-block whitespace-nowrap px-3 py-1 text-xs font-semibold" data-testid="book-specialist">
                    {t('bookThis')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ) : null,
    promotions: () =>
      data.promotions.length ? (
        <Section key="promotions" id="promotions" title={t('promotions')} soft>
          <ul className="grid gap-4 sm:grid-cols-2">
            {data.promotions.map((p) => (
              <li key={p.id} className="tpl-card relative overflow-hidden p-5 pl-7">
                <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: c.accent }} />
                <div className="tpl-accent text-3xl font-black">−{p.discountType === 'percent' ? `${p.discountValue}%` : money(p.discountValue)}</div>
                <div className="mt-1 font-semibold">{p.name}</div>
                {p.description && <p className="tpl-muted text-sm">{p.description}</p>}
                {p.code && (
                  <p className="mt-3 text-sm">
                    {t('promoCode')}: <code className="tpl-chip tpl-pill px-2.5 py-1 font-mono font-semibold">{p.code}</code>
                  </p>
                )}
                {p.endsAt && <p className="tpl-muted mt-2 text-xs">{t('until')} {shortDate(p.endsAt, lang)}</p>}
              </li>
            ))}
          </ul>
        </Section>
      ) : null,
    reviews: () => (
      <Section key="reviews" id="reviews" title={t('reviews')}>
        {data.reviews.average !== null && (
          <div className={`mb-6 flex items-center gap-3 ${centered ? 'justify-center' : ''}`}>
            <span className="tpl-heading text-5xl">{data.reviews.average}</span>
            <div className="text-xl">
              <Stars value={data.reviews.average} />
              <div className="tpl-muted text-sm">{data.reviews.count} {t('reviews').toLowerCase()}</div>
            </div>
          </div>
        )}
        {data.reviews.items.length === 0 ? (
          <p className={`tpl-muted ${centered ? 'text-center' : ''}`}>{t('noReviews')}</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {data.reviews.items.map((r) => (
              <li key={r.id} className="tpl-card p-5">
                <Stars value={r.rating} />
                {r.text && <p className="mt-2">{r.text}</p>}
                <p className="tpl-muted mt-3 text-xs">{r.authorName} · {shortDate(r.createdAt, lang)}</p>
                {r.reply && <p className="tpl-muted mt-3 border-l-2 tpl-border pl-3 text-sm">{r.reply}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    ),
    schedule: () => (
      <Section key="schedule" id="schedule" title={t('schedule')} soft>
        <ul className={`tpl-card max-w-lg divide-y tpl-border p-2 text-sm ${centered ? 'mx-auto' : ''}`}>
          {data.schedule.map((d) => (
            <li key={d.weekday} className={`flex justify-between gap-4 px-3 py-2.5 ${d.weekday === todayWd ? 'tpl-chip tpl-r-sm font-semibold' : ''}`}>
              <span>{weekdayName(d.weekday, lang)}</span>
              <span>{d.intervals.length ? d.intervals.map((i) => `${i.start}–${i.end}`).join(', ') : t('dayOff')}</span>
            </li>
          ))}
        </ul>
      </Section>
    ),
    contacts: () => (
      <Section key="contacts" id="contacts" title={t('contacts')}>
        <div className={`flex flex-wrap gap-3 ${centered ? 'justify-center' : ''}`}>
          {data.branch.address && <span className="tpl-card inline-flex items-center gap-2 px-5 py-3"><MapPin className="tpl-primary h-4 w-4" aria-hidden />{data.branch.address}</span>}
          {data.branch.phone && (
            <a className="tpl-card inline-flex items-center gap-2 px-5 py-3 font-semibold hover:opacity-80" href={`tel:${data.branch.phone}`}>
              <Phone className="tpl-primary h-4 w-4" aria-hidden />{formatPhone(data.branch.phone)}
            </a>
          )}
        </div>
      </Section>
    ),
    map: () =>
      data.branch.map ? (
        <Section key="map" id="map" title={t('map')}>
          <MapBlock map={data.branch.map} label={t('openIn2gis')} routeLabel={t('route2gis')} title={data.branch.name} />
        </Section>
      ) : null,
    socials: () =>
      data.content.socials.length ? (
        <Section key="socials" id="socials" title={t('socials')}>
          <ul className={`flex flex-wrap gap-2 ${centered ? 'justify-center' : ''}`}>
            {data.content.socials.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="tpl-card tpl-pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium hover:opacity-80">
                  <span className={DARK_BRANDS.has(s.platform) ? 'tpl-brand-dark' : ''}>
                    <SocialIcon platform={s.platform} />
                  </span>
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null,
  };

  return (
    <div className={`${className} min-h-screen ${device === 'mobile' ? 'mx-auto max-w-[390px] border-x' : ''}`} style={style} lang={lang}>
      <div className="sticky top-0 z-30 border-b tpl-border backdrop-blur" style={{ background: `color-mix(in srgb, ${c.surface} 88%, transparent)` }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <a href="#top" className="flex min-w-0 items-center gap-2">
            {data.content.logo && <img src={data.content.logo.thumb} alt="" className="tpl-r-sm h-8 w-8 flex-none object-cover" />}
            <span className="tpl-heading truncate text-sm sm:text-base">{data.branch.name}</span>
          </a>
          <nav className="hidden items-center gap-5 text-sm md:flex" aria-label="sections">
            {nav.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="tpl-muted hover:opacity-100">{t(label)}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <nav aria-label="language" className="flex gap-1 text-xs">
              {data.availableLocales.map((l) => (
                <Link key={l} href={preview ? '#' : `/${l}/b/${data.slug}`} className={`tpl-pill px-2 py-0.5 uppercase ${l === lang ? 'tpl-btn' : 'tpl-muted'}`}>{l}</Link>
              ))}
            </nav>
            {pos === 'header' && <BookButton />}
          </div>
        </div>
      </div>
      <span id="top" />

      {preview && <div className="bg-amber-200 px-4 py-1 text-center text-xs text-amber-900">Предпросмотр черновика — посетители видят опубликованную версию</div>}
      {canEdit?.canEdit && (
        <div className="fixed left-3 top-16 z-40">
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
          <div className="tpl-card mx-auto max-w-5xl p-5 text-center" data-testid="closed-notice">
            <h2 className="tpl-heading text-xl">{t('closedTitle')}</h2>
            <p className="tpl-muted mt-2">{data.content.closedMessage ?? t('closedText')}</p>
            {data.branch.phone && <a className="tpl-primary mt-2 inline-block font-semibold" href={`tel:${data.branch.phone}`}>{formatPhone(data.branch.phone)}</a>}
          </div>
        </div>
      )}

      <main>{order.map((s) => sections[s]?.())}</main>

      <footer className="tpl-muted border-t tpl-border px-4 pb-28 pt-8 text-center text-xs">
        <div className="font-medium">{data.branch.organizationName}</div>
        <Link href="/" className="mt-1 inline-block opacity-70 hover:opacity-100">{t('poweredBy')}</Link>
      </footer>

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
