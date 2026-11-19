'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui';
import { DashI18nProvider, useT } from '@/lib/i18n-dashboard';

interface Profile {
  isSuperadmin: boolean;
  mustChangePassword: boolean;
  memberships: Array<{ organizationId: string }>;
}

function LoginForm() {
  const { t, lang, setLang } = useT();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [mustChange, setMustChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = (p: Profile) => {
    if (p.isSuperadmin) router.push('/admin');
    else if (p.memberships.length === 1) router.push(`/dashboard/${p.memberships[0]!.organizationId}`);
    else router.push('/dashboard');
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mustChange) {
        await api('/auth/staff/change-password', { method: 'POST', body: { currentPassword: password, newPassword } });
        go(await api<Profile>('/auth/me'));
        return;
      }
      const r = await api<{ mfaRequired?: boolean; user?: Profile }>('/auth/staff/login', {
        method: 'POST',
        body: { email, password, ...(needTotp ? { totpCode: totp } : {}) },
      });
      if (r.mfaRequired) {
        setNeedTotp(true);
        return;
      }
      if (r.user?.mustChangePassword) {
        setMustChange(true);
        return;
      }
      go(r.user!);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{mustChange ? t('changePassword') : t('login')}</h1>
          <button type="button" onClick={() => setLang(lang === 'ru' ? 'kk' : 'ru')} className="text-xs uppercase text-slate-500">{lang === 'ru' ? 'kk' : 'ru'}</button>
        </div>
        <Alert>{error}</Alert>
        {!mustChange && (
          <>
            <Field label={t('email')}>
              <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="email" />
            </Field>
            <Field label={t('password')}>
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="password" />
            </Field>
            {needTotp && (
              <Field label={t('totp')}>
                <Input inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" value={totp} onChange={(e) => setTotp(e.target.value)} data-testid="totp" />
              </Field>
            )}
          </>
        )}
        {mustChange && (
          <Field label={t('newPassword')}>
            <Input type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} data-testid="new-password" />
          </Field>
        )}
        <Button type="submit" loading={busy} className="w-full" data-testid="login-submit">
          {mustChange ? t('save') : t('signIn')}
        </Button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <DashI18nProvider>
      <LoginForm />
    </DashI18nProvider>
  );
}
