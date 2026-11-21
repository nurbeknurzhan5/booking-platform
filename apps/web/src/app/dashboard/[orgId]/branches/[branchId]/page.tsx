'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, Tabs, Textarea } from '@/components/ui';
import { SpecialistsTab, ResourcesTab } from '@/components/dashboard/BranchStaffTabs';
import { ScheduleTab } from '@/components/dashboard/ScheduleTab';

type Tab = 'settings' | 'rules' | 'specialists' | 'resources' | 'schedule';

interface BranchFull {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  mapUrl: string | null;
  mapEnabled: boolean;
}

export default function BranchDetailPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const { base, org, can, isOwner, setBranchId } = useOrg();
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('settings');
  useEffect(() => setBranchId(branchId), [branchId, setBranchId]);
  const branch = useApi<BranchFull>(`${base}/branches/${branchId}`);
  if (branch.loading) return <Spinner />;
  if (!branch.data) return <Alert>{branch.error}</Alert>;
  const b = branch.data;

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'settings', label: t('settings') },
    ...(isOwner ? [{ value: 'rules' as Tab, label: t('bookingRules') }] : []),
    { value: 'specialists', label: t('specialists') },
    { value: 'resources', label: t('resources') },
    { value: 'schedule', label: t('schedule') },
  ];

  return (
    <div>
      <PageHeader
        title={b.name}
        subtitle={<a href={`/ru/b/${b.slug}`} target="_blank" rel="noreferrer" className="text-brand-700 underline">/ru/b/{b.slug}</a>}
        actions={can('pages.edit', b.id) && <Link href={`/dashboard/${org.id}/branches/${b.id}/page-editor`}><Button variant="secondary">{t('editPage')}</Button></Link>}
      />
      <Tabs value={tab} onChange={setTab} items={tabs} />
      {tab === 'settings' && <BranchSettings branch={b} onSaved={branch.reload} canEdit={can('branch.settings.manage', b.id)} />}
      {tab === 'settings' && isOwner && can('branches.manage') && <ArchiveBranch branch={b} />}
      {tab === 'rules' && <BookingRules branchId={b.id} />}
      {tab === 'specialists' && <SpecialistsTab branchId={b.id} />}
      {tab === 'resources' && <ResourcesTab branchId={b.id} />}
      {tab === 'schedule' && <ScheduleTab branchId={b.id} />}
    </div>
  );
}

function BranchSettings({ branch, onSaved, canEdit }: { branch: BranchFull; onSaved: () => void; canEdit: boolean }) {
  const { base } = useOrg();
  const { t } = useT();
  const [f, setF] = useState(branch);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  return (
    <Card>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg({});
          try {
            await api(`${base}/branches/${branch.id}`, {
              method: 'PATCH',
              body: {
                name: f.name,
                address: f.address || undefined,
                phone: f.phone || undefined,
                timezone: f.timezone,
                description: f.description || undefined,
                latitude: f.latitude === null || (f.latitude as unknown) === '' ? undefined : Number(f.latitude),
                longitude: f.longitude === null || (f.longitude as unknown) === '' ? undefined : Number(f.longitude),
                mapUrl: f.mapUrl || undefined,
                mapEnabled: f.mapEnabled,
              },
            });
            setMsg({ ok: t('saved') });
            onSaved();
          } catch (err) {
            setMsg({ err: errorMessage(err) });
          }
        }}
      >
        <div className="sm:col-span-2"><Alert>{msg.err}</Alert>{msg.ok && <Alert tone="green">{msg.ok}</Alert>}</div>
        <Field label={t('name')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!canEdit} /></Field>
        <Field label={t('phone')}><Input value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} disabled={!canEdit} /></Field>
        <Field label={t('address')} className="sm:col-span-2"><Input value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} disabled={!canEdit} /></Field>
        <Field label={t('description')} className="sm:col-span-2"><Textarea rows={3} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} disabled={!canEdit} /></Field>
        <Field label={t('timezone')}>
          <Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} disabled={!canEdit}>
            {['Asia/Almaty', 'Asia/Qostanay', 'Asia/Aqtobe', 'Asia/Aqtau', 'Asia/Atyrau', 'Asia/Oral', 'Asia/Qyzylorda'].map((z) => <option key={z}>{z}</option>)}
          </Select>
        </Field>
        <Field label={t('mapUrl')}><Input value={f.mapUrl ?? ''} onChange={(e) => setF({ ...f, mapUrl: e.target.value })} disabled={!canEdit} placeholder="https://2gis.kz/..." /></Field>
        <Field label={t('latitude')}><Input type="number" step="any" value={f.latitude ?? ''} onChange={(e) => setF({ ...f, latitude: e.target.value === '' ? null : Number(e.target.value) })} disabled={!canEdit} placeholder="43.2389" /></Field>
        <Field label={t('longitude')}><Input type="number" step="any" value={f.longitude ?? ''} onChange={(e) => setF({ ...f, longitude: e.target.value === '' ? null : Number(e.target.value) })} disabled={!canEdit} placeholder="76.8897" /></Field>
        <div className="sm:col-span-2">
          <Checkbox checked={f.mapEnabled} onChange={(e) => setF({ ...f, mapEnabled: e.target.checked })} label={t('mapEnabled')} disabled={!canEdit} />
          <p className="mt-1 text-xs text-slate-500">{t('mapHint')}</p>
        </div>
        {canEdit && <div className="flex justify-end sm:col-span-2"><Button type="submit">{t('save')}</Button></div>}
      </form>
    </Card>
  );
}

interface Rules {
  slotIntervalMinutes: number;
  holdMinutes: number;
  holdExtensionAllowed: boolean;
  minLeadMinutes: number;
  maxHorizonDays: number;
  rescheduleDeadlineMinutes: number;
  cancelDeadlineMinutes: number;
  allowLateCancelException: boolean;
  maxActiveAppointmentsPerClient: number;
  allowRebookWithActive: boolean;
  adminCanOverrideClientLimits: boolean;
  multiServiceMode: 'sequential' | 'parallel';
  loadBalancing: boolean;
  specialistPricingEnabled: boolean;
  reminderHoursBefore: number;
  onlineBookingEnabled: boolean;
  waitlistEnabled: boolean;
  waitlistOfferMinutes: number;
  waitlistRecipients: number;
  waitlistPriority: 'fifo' | 'priority';
  waitlistAfterExpiry: 'offer_next' | 'release';
}

function BookingRules({ branchId }: { branchId: string }) {
  const { base } = useOrg();
  const { t } = useT();
  const { data, setData } = useApi<Rules>(`${base}/branches/${branchId}/booking-settings`);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  if (!data) return <Spinner />;
  const num = (k: keyof Rules, label: Parameters<typeof t>[0]) => (
    <Field label={t(label)}><Input type="number" min={0} value={data[k] as number} onChange={(e) => setData({ ...data, [k]: Number(e.target.value) })} /></Field>
  );
  const bool = (k: keyof Rules, label: Parameters<typeof t>[0]) => <Checkbox checked={data[k] as boolean} onChange={(e) => setData({ ...data, [k]: e.target.checked })} label={t(label)} />;
  return (
    <Card>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg({});
          try {
            const { slotIntervalMinutes, holdMinutes, holdExtensionAllowed, minLeadMinutes, maxHorizonDays, rescheduleDeadlineMinutes, cancelDeadlineMinutes, allowLateCancelException, maxActiveAppointmentsPerClient, allowRebookWithActive, adminCanOverrideClientLimits, multiServiceMode, loadBalancing, specialistPricingEnabled, reminderHoursBefore, onlineBookingEnabled, waitlistEnabled, waitlistOfferMinutes, waitlistRecipients, waitlistPriority, waitlistAfterExpiry } = data;
            setData(await api<Rules>(`${base}/branches/${branchId}/booking-settings`, { method: 'PUT', body: { slotIntervalMinutes, holdMinutes, holdExtensionAllowed, minLeadMinutes, maxHorizonDays, rescheduleDeadlineMinutes, cancelDeadlineMinutes, allowLateCancelException, maxActiveAppointmentsPerClient, allowRebookWithActive, adminCanOverrideClientLimits, multiServiceMode, loadBalancing, specialistPricingEnabled, reminderHoursBefore, onlineBookingEnabled, waitlistEnabled, waitlistOfferMinutes, waitlistRecipients, waitlistPriority, waitlistAfterExpiry } }));
            setMsg({ ok: t('saved') });
          } catch (err) {
            setMsg({ err: errorMessage(err) });
          }
        }}
      >
        <Alert>{msg.err}</Alert>
        {msg.ok && <Alert tone="green">{msg.ok}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          {num('slotIntervalMinutes', 'slotInterval')}
          {num('holdMinutes', 'holdMinutes')}
          {num('minLeadMinutes', 'minLead')}
          {num('maxHorizonDays', 'maxHorizon')}
          {num('rescheduleDeadlineMinutes', 'rescheduleDeadline')}
          {num('cancelDeadlineMinutes', 'cancelDeadline')}
          {num('maxActiveAppointmentsPerClient', 'maxActive')}
          {num('reminderHoursBefore', 'reminderHours')}
          <Field label={t('multiMode')}>
            <Select value={data.multiServiceMode} onChange={(e) => setData({ ...data, multiServiceMode: e.target.value as Rules['multiServiceMode'] })}>
              <option value="sequential">{t('sequential')}</option>
              <option value="parallel">{t('parallel')}</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {bool('onlineBookingEnabled', 'onlineBooking')}
          {bool('holdExtensionAllowed', 'holdExtension')}
          {bool('allowLateCancelException', 'lateCancel')}
          {bool('allowRebookWithActive', 'rebookWithActive')}
          {bool('adminCanOverrideClientLimits', 'adminOverride')}
          {bool('loadBalancing', 'loadBalancing')}
          {bool('specialistPricingEnabled', 'specialistPricing')}
        </div>
        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium">{t('waitlist')}</legend>
          <p className="text-xs text-slate-500">{t('wlHint')}</p>
          {bool('waitlistEnabled', 'waitlistEnabled')}
          {data.waitlistEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              {num('waitlistOfferMinutes', 'waitlistOfferMinutes')}
              {num('waitlistRecipients', 'waitlistRecipients')}
              <Field label={t('waitlistPriority')}>
                <Select value={data.waitlistPriority} onChange={(e) => setData({ ...data, waitlistPriority: e.target.value as Rules['waitlistPriority'] })}>
                  <option value="fifo">{t('wlFifo')}</option>
                  <option value="priority">{t('wlPriority')}</option>
                </Select>
              </Field>
              <Field label={t('waitlistAfterExpiry')}>
                <Select value={data.waitlistAfterExpiry} onChange={(e) => setData({ ...data, waitlistAfterExpiry: e.target.value as Rules['waitlistAfterExpiry'] })}>
                  <option value="offer_next">{t('wlOfferNext')}</option>
                  <option value="release">{t('wlRelease')}</option>
                </Select>
              </Field>
            </div>
          )}
        </fieldset>
        <div className="flex justify-end"><Button type="submit">{t('save')}</Button></div>
      </form>
    </Card>
  );
}

/** Архивация филиала (только владелец): страница отключается, история записей сохраняется. */
function ArchiveBranch({ branch }: { branch: BranchFull }) {
  const { base, org, reloadBranches } = useOrg();
  const { t } = useT();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card title={t('archiveBranch')} className="mt-4 border-rose-200">
      <p className="text-sm text-slate-600">{t('archiveBranchHint')}</p>
      <div className="mt-3"><Alert>{err}</Alert></div>
      <Button
        variant="danger"
        className="mt-3"
        data-testid="archive-branch"
        onClick={async () => {
          if (!confirm(`${t('archiveBranch')}: ${branch.name}?`)) return;
          setErr(null);
          try {
            await api(`${base}/branches/${branch.id}`, { method: 'DELETE' });
            await reloadBranches();
            router.push(`/dashboard/${org.id}/branches`);
          } catch (e) {
            setErr(errorMessage(e));
          }
        }}
      >
        {t('archiveBranch')}
      </Button>
    </Card>
  );
}
