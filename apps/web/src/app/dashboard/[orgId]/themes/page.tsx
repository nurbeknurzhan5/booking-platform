'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Modal, PageHeader, Spinner, cx } from '@/components/ui';
import { apiPath } from '@/lib/api-path';

interface Scheme {
  key: string;
  name: string;
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
}
interface Theme {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isNew: boolean;
  config: { layout: string; tags?: string[]; colorSchemes: Scheme[]; bookingButtonPositions: string[] };
}
interface Editor {
  page: { publishedPublicationId: string | null; moderationBlocked: boolean };
  draft: { content: unknown; templateId: string; colorScheme: string; bookingButtonPosition: string; primaryLocale: string };
}

type Filter = 'all' | 'recommended' | 'new';

/** Живой предпросмотр страницы филиала в теме: настоящая страница в iframe, уменьшенная до карточки. */
function ThemePreview({ src, mobile }: { src: string; mobile?: boolean }) {
  return mobile ? (
    <div className="relative mx-auto h-[560px] w-[300px] overflow-hidden rounded-[2rem] border-[10px] border-slate-900 bg-white shadow-xl">
      <iframe title="preview" src={src} loading="lazy" className="pointer-events-none absolute left-0 top-0 h-[700px] w-[375px] origin-top-left scale-[0.746]" />
    </div>
  ) : (
    <div className="relative h-[240px] overflow-hidden bg-slate-100">
      <iframe title="preview" src={src} loading="lazy" tabIndex={-1} className="pointer-events-none absolute left-0 top-0 h-[800px] w-[1280px] origin-top-left scale-[0.3]" />
    </div>
  );
}

/**
 * Магазин оформлений (задача 23): каталог тем для публичной страницы и онлайн-записи. Каталог ведёт администратор
 * платформы — новые темы появляются с меткой «Новинка». Живой предпросмотр показывает страницу филиала владельца.
 */
export default function ThemesPage() {
  const { base, org, branch, can, canManage } = useOrg();
  const { t } = useT();
  const themes = useApi<Theme[]>(apiPath`/templates`);
  const orgInfo = useApi<{ businessCategory: { code: string } | null }>(base);
  const editor = useApi<Editor>(branch ? apiPath`${base}/branches/${branch.id}/page` : null);
  const [filter, setFilter] = useState<Filter>('all');
  const [scheme, setScheme] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Theme | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (!branch) return <Card><p className="text-sm text-slate-500">{t('noBranchSelected')}</p></Card>;
  const canEdit = can('pages.edit', branch.id) && canManage;
  const category = orgInfo.data?.businessCategory?.code;
  const current = editor.data?.draft;
  const recommended = (x: Theme) => !!category && !!x.config.tags?.includes(category);
  const list = (themes.data ?? []).filter((x) => (filter === 'new' ? x.isNew : filter === 'recommended' ? recommended(x) : true));
  const schemeOf = (x: Theme) => scheme[x.id] ?? (current?.templateId === x.id ? current.colorScheme : x.config.colorSchemes[0]!.key);
  const previewSrc = (x: Theme, dev: 'desktop' | 'mobile' = 'desktop') => `/preview/${org.id}/${branch.id}?device=${dev}&templateId=${x.id}&colorScheme=${schemeOf(x)}`;

  async function apply(x: Theme) {
    if (!editor.data) return;
    setBusy(x.id);
    setMsg({});
    try {
      const d = editor.data.draft;
      await api(apiPath`${base}/branches/${branch!.id}/page/draft`, {
        method: 'PUT',
        body: {
          content: d.content,
          templateId: x.id,
          colorScheme: schemeOf(x),
          bookingButtonPosition: x.config.bookingButtonPositions.includes(d.bookingButtonPosition) ? d.bookingButtonPosition : x.config.bookingButtonPositions[0],
          primaryLocale: d.primaryLocale,
        },
      });
      if (confirm(t('themePublishNow'))) {
        await api(apiPath`${base}/branches/${branch!.id}/page/publish`, { method: 'POST' });
        setMsg({ ok: `${x.name}: ${t('themePublished')}` });
      } else setMsg({ ok: `${x.name}: ${t('themeSavedDraft')}` });
      setOpen(null);
      await editor.reload();
    } catch (e) {
      setMsg({ err: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  const SchemeDots = ({ x }: { x: Theme }) => (
    <div className="flex flex-wrap gap-2">
      {x.config.colorSchemes.map((s) => (
        <button
          key={s.key}
          type="button"
          title={s.name}
          aria-label={s.name}
          onClick={() => setScheme({ ...scheme, [x.id]: s.key })}
          className={cx('h-7 w-7 rounded-full border-2 transition-transform hover:scale-110', schemeOf(x) === s.key ? 'border-slate-900 ring-2 ring-slate-900/20' : 'border-white shadow')}
          style={{ background: `linear-gradient(135deg, ${s.primary} 0 50%, ${s.background} 50% 100%)` }}
        />
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader
        title={t('themesTitle')}
        subtitle={t('themesSubtitle')}
        actions={<Link href={`/dashboard/${org.id}/branches/${branch.id}/page-editor`}><Button variant="secondary">{t('editPage')}</Button></Link>}
      />
      <Alert>{msg.err}</Alert>
      {msg.ok && <Alert tone="green">{msg.ok}</Alert>}
      <div className="mb-5 flex flex-wrap gap-2">
        {(['all', 'recommended', 'new'] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cx('rounded-full px-4 py-1.5 text-sm font-medium', filter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50')}>
            {t(`themeFilter_${f}` as 'themeFilter_all')}
          </button>
        ))}
      </div>
      {themes.loading || editor.loading ? <Spinner /> : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" data-testid="theme-store">
          {list.map((x) => {
            const isCurrent = current?.templateId === x.id;
            return (
              <div key={x.id} className={cx('overflow-hidden rounded-2xl border bg-white shadow-sm', isCurrent ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-slate-200')} data-testid={`theme-${x.key}`}>
                <button type="button" className="block w-full text-left" onClick={() => setOpen(x)} aria-label={`${t('preview')}: ${x.name}`}>
                  <ThemePreview src={previewSrc(x)} />
                </button>
                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">{x.name}</h3>
                    {x.isNew && <Badge tone="amber">{t('themeNew')}</Badge>}
                    {recommended(x) && <Badge tone="blue">{t('themeRecommended')}</Badge>}
                    {isCurrent && <Badge tone="green">{t('themeCurrent')}</Badge>}
                  </div>
                  {x.description && <p className="text-sm text-slate-600">{x.description}</p>}
                  <SchemeDots x={x} />
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="secondary" onClick={() => setOpen(x)}>{t('preview')}</Button>
                    {canEdit && (
                      <Button size="sm" loading={busy === x.id} onClick={() => apply(x)} disabled={isCurrent && schemeOf(x) === current?.colorScheme} data-testid={`apply-${x.key}`}>
                        {isCurrent && schemeOf(x) === current?.colorScheme ? '✓' : t('themeApply')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {list.length === 0 && <Card><p className="text-sm text-slate-500">{t('empty')}</p></Card>}
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} wide>
        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SchemeDots x={open} />
              <div className="flex gap-2">
                <Button size="sm" variant={device === 'desktop' ? 'primary' : 'secondary'} onClick={() => setDevice('desktop')}>{t('desktop')}</Button>
                <Button size="sm" variant={device === 'mobile' ? 'primary' : 'secondary'} onClick={() => setDevice('mobile')}>{t('mobile')}</Button>
              </div>
            </div>
            {device === 'mobile' ? (
              <ThemePreview src={previewSrc(open, 'mobile')} mobile />
            ) : (
              <div className="relative h-[420px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                <iframe title="preview" src={previewSrc(open)} className="absolute left-0 top-0 h-[1050px] w-[1280px] origin-top-left scale-[0.4] sm:scale-[0.55]" />
              </div>
            )}
            {canEdit && (
              <div className="flex justify-end">
                <Button loading={busy === open.id} onClick={() => apply(open)}>{t('themeApply')}</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
