'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, statusTone } from '@/components/ui';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { apiPath } from '@/lib/api-path';

interface Template {
  id: string;
  key: string;
  name: string;
  description: string | null;
  config: { layout: string; sectionOrder: string[]; colorSchemes: Array<{ key: string; name: string; primary: string; background: string; accent: string }>; bookingButtonPositions: string[] };
}
type I18n = Partial<Record<'ru' | 'kk' | 'en', string>>;
interface Content {
  title?: I18n;
  tagline?: I18n;
  about?: I18n;
  closedMessage?: I18n;
  logoAssetId?: string | null;
  coverAssetId?: string | null;
  galleryAssetIds: string[];
  socials: Array<{ url: string; label?: string }>;
  hiddenSections: string[];
}
interface Editor {
  page: { id: string; slug: string; status: string; moderationBlocked: boolean; moderationReason: string | null; publishedPublicationId: string | null };
  draft: { content: Content; templateId: string; colorScheme: string; bookingButtonPosition: string; primaryLocale: 'ru' | 'kk' | 'en'; hasUnpublishedChanges: boolean };
  publications: Array<{ id: string; version: number; templateId: string; createdAt: string }>;
  translations: Array<{ id: string; entityType: string; entityId: string; field: string; locale: string; text: string | null; status: string; isOutdated: boolean }>;
  previouslyUsedTemplateIds: string[];
}

const SECTIONS = ['about', 'gallery', 'services', 'specialists', 'resources', 'promotions', 'reviews', 'schedule', 'contacts', 'map', 'socials'];
type Tab = 'content' | 'design' | 'translations' | 'versions';

export default function PageEditor() {
  const { branchId } = useParams<{ branchId: string }>();
  const { base, org, canManage } = useOrg();
  const { t } = useT();
  const editor = useApi<Editor>(apiPath`${base}/branches/${branchId}/page`);
  const templates = useApi<Template[]>(apiPath`/templates`);
  const [tab, setTab] = useState<Tab>('content');
  const [d, setD] = useState<Editor['draft'] | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [previewTpl, setPreviewTpl] = useState<string | null>(null);

  useEffect(() => {
    if (editor.data) setD(editor.data.draft);
  }, [editor.data]);

  if (editor.loading || !d || !editor.data) return editor.error ? <Alert>{editor.error}</Alert> : <Spinner />;
  const e = editor.data;
  const loc = d.primaryLocale;
  const tpl = templates.data?.find((x) => x.id === d.templateId);
  const c = d.content;
  const setC = (patch: Partial<Content>) => setD({ ...d, content: { ...c, ...patch } });
  const text = (k: 'title' | 'tagline' | 'about' | 'closedMessage') => c[k]?.[loc] ?? '';
  const setText = (k: 'title' | 'tagline' | 'about' | 'closedMessage', v: string) => setC({ [k]: { [loc]: v } } as Partial<Content>);

  async function save() {
    setBusy(true);
    setMsg({});
    try {
      const r = await api<Editor>(apiPath`${base}/branches/${branchId}/page/draft`, {
        method: 'PUT',
        body: { content: d!.content, templateId: d!.templateId, colorScheme: d!.colorScheme, bookingButtonPosition: d!.bookingButtonPosition, primaryLocale: d!.primaryLocale },
      });
      editor.setData(r);
      setMsg({ ok: t('draftSaved') });
      return true;
    } catch (err) {
      setMsg({ err: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const previewUrl = (templateId?: string) =>
    `/preview/${org.id}/${branchId}?device=${device}&locale=${loc}${templateId ? `&templateId=${templateId}` : ''}`;

  return (
    <div>
      <PageHeader
        title={t('editPage')}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <a href={`/ru/b/${e.page.slug}`} target="_blank" rel="noreferrer" className="text-brand-700 underline">/ru/b/{e.page.slug}</a>
            <Badge tone={statusTone(e.page.status)}>{t(`st_${e.page.status}` as 'st_active')}</Badge>
            {d.hasUnpublishedChanges && <Badge tone="amber">{t('unpublished')}</Badge>}
            {e.page.moderationBlocked && <Badge tone="red">{t('moderation')}: {e.page.moderationReason}</Badge>}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={async () => { if (await save()) window.open(previewUrl(), '_blank'); }}>{t('preview')}</Button>
            <Button variant="secondary" loading={busy} onClick={save} disabled={!canManage} data-testid="save-draft">{t('save')}</Button>
            <Button
              disabled={!canManage || e.page.moderationBlocked}
              onClick={async () => {
                if (!(await save())) return;
                try {
                  await api(apiPath`${base}/branches/${branchId}/page/publish`, { method: 'POST' });
                  setMsg({ ok: t('published') });
                  await editor.reload();
                } catch (err) {
                  setMsg({ err: errorMessage(err) });
                }
              }}
              data-testid="publish"
            >
              {t('publish')}
            </Button>
          </>
        }
      />
      <Alert>{msg.err}</Alert>
      {msg.ok && <Alert tone="green">{msg.ok}</Alert>}
      <div className="mt-4">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'content', label: t('description') }, { value: 'design', label: t('template') }, { value: 'translations', label: t('translations') }, { value: 'versions', label: t('versions') }]} />
      </div>

      {tab === 'content' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="space-y-3">
              <Field label={t('primaryLocale')}>
                <Select value={loc} onChange={(ev) => setD({ ...d, primaryLocale: ev.target.value as 'ru' })}>
                  <option value="ru">Русский</option>
                  <option value="kk">Қазақша</option>
                  <option value="en">English</option>
                </Select>
              </Field>
              <Field label={t('titleField')}><Input value={text('title')} onChange={(ev) => setText('title', ev.target.value)} data-testid="page-title" /></Field>
              <Field label={t('tagline')}><Input value={text('tagline')} onChange={(ev) => setText('tagline', ev.target.value)} /></Field>
              <Field label={t('description')}><Textarea rows={5} value={text('about')} onChange={(ev) => setText('about', ev.target.value)} /></Field>
              <Field label={t('closedMessage')}><Textarea rows={2} value={text('closedMessage')} onChange={(ev) => setText('closedMessage', ev.target.value)} /></Field>
            </div>
          </Card>
          <Card>
            <div className="space-y-3">
              <Field label={t('logo')}><ImageUpload kind="logo" value={c.logoAssetId} onChange={(id) => setC({ logoAssetId: id })} /></Field>
              <Field label={t('cover')}><ImageUpload kind="cover" value={c.coverAssetId} onChange={(id) => setC({ coverAssetId: id })} /></Field>
              <Field label={t('photos')}>
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">{c.galleryAssetIds.length} / 30</p>
                  <ImageUpload kind="gallery" value={null} onChange={(id) => id && setC({ galleryAssetIds: [...c.galleryAssetIds, id] })} />
                  {c.galleryAssetIds.length > 0 && <Button size="sm" variant="ghost" onClick={() => setC({ galleryAssetIds: [] })}>{t('delete')} ({c.galleryAssetIds.length})</Button>}
                </div>
              </Field>
              <Field label={t('socialLinks')}>
                <div className="space-y-2">
                  {c.socials.map((s, i) => (
                    <div key={i} className="flex gap-2">
                      <Input value={s.url} placeholder="https://instagram.com/..." onChange={(ev) => setC({ socials: c.socials.map((x, k) => (k === i ? { ...x, url: ev.target.value } : x)) })} />
                      <Input value={s.label ?? ''} placeholder={t('label')} onChange={(ev) => setC({ socials: c.socials.map((x, k) => (k === i ? { ...x, label: ev.target.value || undefined } : x)) })} className="max-w-[9rem]" />
                      <Button size="sm" variant="ghost" onClick={() => setC({ socials: c.socials.filter((_, k) => k !== i) })}>×</Button>
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" onClick={() => setC({ socials: [...c.socials, { url: '' }] })}>+ {t('add')}</Button>
                </div>
              </Field>
              <Field label={t('hiddenSections')}>
                <div className="grid grid-cols-2 gap-1">
                  {SECTIONS.map((s) => (
                    <Checkbox key={s} checked={c.hiddenSections.includes(s)} onChange={(ev) => setC({ hiddenSections: ev.target.checked ? [...c.hiddenSections, s] : c.hiddenSections.filter((x) => x !== s) })} label={t(`sec_${s}` as 'sec_about')} />
                  ))}
                </div>
              </Field>
              <Field label={t('pageStatus')}>
                <Select
                  value={e.page.status}
                  onChange={async (ev) => {
                    try {
                      await api(apiPath`${base}/branches/${branchId}/page/status`, { method: 'PUT', body: { status: ev.target.value } });
                      await editor.reload();
                    } catch (err) {
                      setMsg({ err: errorMessage(err) });
                    }
                  }}
                >
                  {['active', 'temporarily_closed', 'disabled'].map((s) => <option key={s} value={s}>{t(`st_${s}` as 'st_active')}</option>)}
                </Select>
              </Field>
            </div>
          </Card>
        </div>
      )}

      {tab === 'design' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <div className="space-y-3">
            {(templates.data ?? []).map((x) => (
              <Card key={x.id} className={x.id === d.templateId ? 'border-brand-500 ring-1 ring-brand-500' : ''}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{x.name} {e.previouslyUsedTemplateIds.includes(x.id) && <Badge>↺</Badge>}</div>
                    <p className="text-sm text-slate-500">{x.description}</p>
                    <div className="mt-2 flex gap-1">
                      {x.config.colorSchemes.map((s) => <span key={s.key} title={s.name} className="h-5 w-5 rounded-full border" style={{ background: `linear-gradient(135deg, ${s.primary} 50%, ${s.background} 50%)` }} />)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setPreviewTpl(x.id)}>{t('preview')}</Button>
                    <Button size="sm" onClick={() => setD({ ...d, templateId: x.id, colorScheme: x.config.colorSchemes[0]!.key, bookingButtonPosition: x.config.bookingButtonPositions.includes(d.bookingButtonPosition) ? d.bookingButtonPosition : x.config.bookingButtonPositions[0]! })} disabled={x.id === d.templateId} data-testid={`template-${x.key}`}>
                      {x.id === d.templateId ? '✓' : t('edit')}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
            {tpl && (
              <Card>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('colorScheme')}>
                    <Select value={d.colorScheme} onChange={(ev) => setD({ ...d, colorScheme: ev.target.value })}>
                      {tpl.config.colorSchemes.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                    </Select>
                  </Field>
                  <Field label={t('buttonPosition')}>
                    <Select value={d.bookingButtonPosition} onChange={(ev) => setD({ ...d, bookingButtonPosition: ev.target.value })}>
                      {tpl.config.bookingButtonPositions.map((p) => <option key={p}>{p}</option>)}
                    </Select>
                  </Field>
                </div>
              </Card>
            )}
          </div>
          <div>
            <div className="mb-2 flex gap-2">
              <Button size="sm" variant={device === 'mobile' ? 'primary' : 'secondary'} onClick={() => setDevice('mobile')}>{t('mobile')}</Button>
              <Button size="sm" variant={device === 'desktop' ? 'primary' : 'secondary'} onClick={() => setDevice('desktop')}>{t('desktop')}</Button>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-inner">
              <iframe key={`${previewTpl}-${device}`} title="preview" src={previewUrl(previewTpl ?? d.templateId)} className={device === 'mobile' ? 'h-[720px] w-full' : 'h-[720px] w-[1280px] origin-top-left scale-[0.33]'} />
            </div>
          </div>
        </div>
      )}

      {tab === 'translations' && (
        <Card
          actions={['kk', 'en', 'ru'].filter((l) => l !== loc).map((l) => (
            <Button key={l} size="sm" variant="secondary" onClick={async () => { try { await api(apiPath`/organizations/${org.id}/translations/auto`, { method: 'POST', body: { locale: l } }); setMsg({ ok: 'OK' }); } catch (err) { setMsg({ err: errorMessage(err) }); } }}>
              {t('autoTranslate')} → {l.toUpperCase()}
            </Button>
          ))}
        >
          <Table head={['', 'lang', t('translations'), t('status')]} empty={!e.translations.length}>
            {e.translations.map((tr) => (
              <TranslationRow key={tr.id} tr={tr} onSaved={editor.reload} />
            ))}
          </Table>
        </Card>
      )}

      {tab === 'versions' && (
        <Card>
          <Table head={['#', t('template'), t('date'), '']} empty={!e.publications.length}>
            {e.publications.map((p) => (
              <tr key={p.id}>
                <Td>v{p.version} {p.id === e.page.publishedPublicationId && <Badge tone="green">{t('published')}</Badge>}</Td>
                <Td>{templates.data?.find((x) => x.id === p.templateId)?.name}</Td>
                <Td>{new Date(p.createdAt).toLocaleString('ru-RU')}</Td>
                <Td>
                  <Button size="sm" variant="secondary" onClick={async () => { editor.setData(await api<Editor>(apiPath`${base}/branches/${branchId}/page/versions/${p.id}/restore`, { method: 'POST' })); setMsg({ ok: t('draftSaved') }); }}>
                    {t('restore')}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function TranslationRow({ tr, onSaved }: { tr: Editor['translations'][number]; onSaved: () => void }) {
  const { org } = useOrg();
  const { t } = useT();
  const [v, setV] = useState(tr.text ?? '');
  return (
    <tr>
      <Td className="text-xs text-slate-500">{tr.field}</Td>
      <Td className="uppercase">{tr.locale}</Td>
      <Td><Textarea rows={2} value={v} onChange={(e) => setV(e.target.value)} /></Td>
      <Td>
        <Badge tone={tr.status === 'missing' ? 'amber' : tr.status === 'auto_translated' ? 'blue' : 'green'}>{t(`tr_${tr.status}` as 'tr_missing')}</Badge>
        {tr.isOutdated && <div className="text-xs text-amber-700">{t('outdated')}</div>}
        <div className="mt-1 flex gap-1">
          <Button size="sm" variant="secondary" onClick={async () => { await api(apiPath`/organizations/${org.id}/translations`, { method: 'PUT', body: { items: [{ entityType: tr.entityType, entityId: tr.entityId, field: tr.field, locale: tr.locale, text: v, verified: false }] } }); onSaved(); }}>{t('save')}</Button>
          {tr.status === 'auto_translated' && <Button size="sm" variant="ghost" onClick={async () => { await api(apiPath`/organizations/${org.id}/translations`, { method: 'PUT', body: { items: [{ entityType: tr.entityType, entityId: tr.entityId, field: tr.field, locale: tr.locale, text: v, verified: true }] } }); onSaved(); }}>✓</Button>}
        </div>
      </Td>
    </tr>
  );
}
