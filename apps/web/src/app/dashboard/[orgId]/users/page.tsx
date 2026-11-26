'use client';

import { useState } from 'react';
import { useOrg } from '@/components/dashboard/OrgContext';
import { useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n-dashboard';
import { api, errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Modal, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { apiPath } from '@/lib/api-path';

const BRANCH_PERMISSIONS = [
  'appointments.view',
  'appointments.manage',
  'clients.view',
  'services.manage',
  'specialists.manage',
  'resources.manage',
  'schedules.manage',
  'reviews.manage',
  'analytics.view',
  'pages.edit',
  'branch.settings.manage',
];
const DEFAULT = ['appointments.view', 'appointments.manage', 'clients.view', 'resources.manage', 'analytics.view'];

/** Названия прав по филиалу (§3.2). */
const PERM_LABELS: Record<'ru' | 'kk', Record<string, string>> = {
  ru: {
    'appointments.view': 'Просмотр записей',
    'appointments.manage': 'Управление записями (создание, перенос, отмена, выполнение)',
    'clients.view': 'Просмотр клиентов',
    'services.manage': 'Услуги',
    'specialists.manage': 'Специалисты',
    'resources.manage': 'Ресурсы (кабинеты, посты, оборудование)',
    'schedules.manage': 'Расписания',
    'reviews.manage': 'Ответы на отзывы',
    'analytics.view': 'Статистика филиала',
    'pages.edit': 'Редактирование страницы',
    'branch.settings.manage': 'Настройки и правила записи филиала',
  },
  kk: {
    'appointments.view': 'Жазбаларды қарау',
    'appointments.manage': 'Жазбаларды басқару (құру, ауыстыру, болдырмау, орындау)',
    'clients.view': 'Клиенттерді қарау',
    'services.manage': 'Қызметтер',
    'specialists.manage': 'Мамандар',
    'resources.manage': 'Ресурстар (кабинеттер, бекеттер, жабдықтар)',
    'schedules.manage': 'Кестелер',
    'reviews.manage': 'Пікірлерге жауап беру',
    'analytics.view': 'Филиал статистикасы',
    'pages.edit': 'Бетті өңдеу',
    'branch.settings.manage': 'Филиал баптаулары мен жазылу ережелері',
  },
};

interface Staff {
  userId: string;
  role: string;
  name: string;
  email: string;
  phone: string | null;
  blocked: boolean;
  lastLoginAt: string | null;
  branchAccess: Array<{ branchId: string; permissions: string[] }>;
}
type Access = Record<string, string[]>;

/** Пользователи и права: администраторы филиалов, выдача и отзыв прав (§3.3). */
export default function UsersPage() {
  const { base, branches } = useOrg();
  const { t, st, lang } = useT();
  const list = useApi<Staff[]>(apiPath`${base}/users`);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const [create, setCreate] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', temporaryPassword: '' });
  const [access, setAccess] = useState<Access>({});
  const [editUser, setEditUser] = useState<Staff | null>(null);

  const AccessEditor = ({ value, onChange }: { value: Access; onChange: (v: Access) => void }) => (
    <div className="space-y-3">
      {branches.map((b) => {
        const perms = value[b.id];
        return (
          <div key={b.id} className="rounded-lg border border-slate-200 p-3">
            <Checkbox checked={!!perms} onChange={(e) => { const n = { ...value }; if (e.target.checked) n[b.id] = [...DEFAULT]; else delete n[b.id]; onChange(n); }} label={<b>{b.name}</b>} />
            {perms && (
              <div className="mt-2 grid gap-1 pl-6 sm:grid-cols-2">
                {BRANCH_PERMISSIONS.map((p) => (
                  <Checkbox key={p} checked={perms.includes(p)} onChange={(e) => onChange({ ...value, [b.id]: e.target.checked ? [...perms, p] : perms.filter((x) => x !== p) })} label={<span className="text-xs">{PERM_LABELS[lang][p] ?? p}</span>} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
  const toArray = (a: Access) => Object.entries(a).map(([branchId, permissions]) => ({ branchId, permissions }));

  return (
    <div>
      <PageHeader title={t('users')} actions={<Button onClick={() => { setCreate(true); setAccess({}); }} data-testid="invite-admin">+ {t('inviteAdmin')}</Button>} />
      {!create && !editUser && <Alert>{error}</Alert>}
      <Alert tone="green">{notice}</Alert>
      <Card>
        {list.loading ? <Spinner /> : (
          <Table head={[t('personName'), t('email'), t('status'), t('branches'), '']} empty={!list.data?.length}>
            {(list.data ?? []).map((u) => (
              <tr key={u.userId}>
                <Td className="font-medium">{u.name}</Td>
                <Td>{u.email}</Td>
                <Td><Badge tone={u.role === 'OWNER' ? 'blue' : 'slate'}>{t(`role_${u.role}` as 'role_OWNER')}</Badge>{u.blocked && <Badge tone="red">{st('blocked')}</Badge>}</Td>
                <Td className="text-xs">{u.role === 'OWNER' ? t('allBranches') : u.branchAccess.map((a) => `${branches.find((b) => b.id === a.branchId)?.name} (${a.permissions.length})`).join(', ')}</Td>
                <Td>
                  {u.role === 'BRANCH_ADMIN' && (
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="secondary" onClick={() => { setEditUser(u); setAccess(Object.fromEntries(u.branchAccess.map((a) => [a.branchId, a.permissions]))); }}>{t('permissions')}</Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const temporaryPassword = prompt(t('temporaryPasswordPrompt'));
                          if (temporaryPassword) void run(() => api(apiPath`${base}/users/${u.userId}/reset-password`, { method: 'POST', body: { temporaryPassword } }), t('passwordResetDone'));
                        }}
                      >
                        {t('resetPassword')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm(`${t('revoke')}?`)) void run(() => api(apiPath`${base}/users/${u.userId}`, { method: 'DELETE' })); }}>{t('revoke')}</Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={create} onClose={() => setCreate(false)} title={t('inviteAdmin')} wide>
        <div className="space-y-3">
          <Alert>{error}</Alert>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('personName')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('email')}><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label={t('temporaryPassword')}><Input value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} minLength={10} /></Field>
          </div>
          <AccessEditor value={access} onChange={setAccess} />
          <div className="flex justify-end">
            <Button onClick={async () => { setError(null); try { await api(apiPath`${base}/users`, { method: 'POST', body: { ...form, role: 'BRANCH_ADMIN', branchAccess: toArray(access) } }); setCreate(false); setForm({ email: '', name: '', temporaryPassword: '' }); await list.reload(); } catch (e) { setError(errorMessage(e)); } }}>{t('create')}</Button>
          </div>
        </div>
      </Modal>
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={`${t('permissions')}: ${editUser?.name ?? ''}`} wide>
        <div className="space-y-3">
          <Alert>{error}</Alert>
          <AccessEditor value={access} onChange={setAccess} />
          <div className="flex justify-end">
            <Button onClick={async () => { setError(null); try { await api(apiPath`${base}/users/${editUser!.userId}/access`, { method: 'PUT', body: { branchAccess: toArray(access) } }); setEditUser(null); await list.reload(); } catch (e) { setError(errorMessage(e)); } }}>{t('save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
