'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useEffect } from 'react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  loading,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
    secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:opacity-50',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-600/50',
    ghost: 'text-slate-700 hover:bg-slate-100 disabled:opacity-50',
  };
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx(
        'focus-ring inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        size === 'sm' ? 'px-2.5 py-1.5 text-sm' : 'px-4 py-2.5 text-sm',
        styles[variant],
        className,
      )}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

/** Поля по умолчанию на всю ширину; переданная ширина (w-auto, w-40, max-w-…) заменяет w-full, а не конкурирует с ним. */
const field = (className?: string) =>
  cx('focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm', /(^|\s)w-/.test(className ?? '') ? null : 'w-full', className);

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={field(p.className)} />;
}

export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={field(p.className)} />;
}

export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={field(p.className)} />;
}

/** Постраничная навигация: «← 2 / 16 →». Не выводится, если страница одна. */
export function Pager({ page, pageSize, total, onChange, label }: { page: number; pageSize: number; total: number; onChange: (p: number) => void; label?: ReactNode }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm" data-testid="pager">
      <span className="text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="←">←</Button>
        <span className="tabular-nums">{page} / {pages}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="→">→</Button>
      </div>
    </div>
  );
}

export function Checkbox({ label, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" {...p} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600" />
      <span>{label}</span>
    </label>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-rose-100 text-rose-800',
    blue: 'bg-sky-100 text-sky-800',
  };
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function Alert({ children, tone = 'red' }: { children: ReactNode; tone?: 'red' | 'amber' | 'green' | 'blue' }) {
  if (!children) return null;
  const tones = {
    red: 'border-rose-200 bg-rose-50 text-rose-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    blue: 'border-sky-200 bg-sky-50 text-sky-900',
  };
  return (
    <div role="alert" className={cx('rounded-lg border px-3 py-2 text-sm', tones[tone])}>
      {children}
    </div>
  );
}

export function Spinner() {
  return <div className="flex justify-center py-8"><span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /></div>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button aria-label="close" onClick={onClose} className="focus-ring rounded p-1 text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: ReactNode }> }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {items.map((i) => (
        <button
          key={i.value}
          onClick={() => onChange(i.value)}
          className={cx(
            'focus-ring -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
            value === i.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, actions, subtitle }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <p className="py-6 text-center text-sm text-slate-500">—</p>}
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx('px-3 py-2 align-top', className)}>{children}</td>;
}

export function statusTone(s: string): 'slate' | 'green' | 'amber' | 'red' | 'blue' {
  if (s === 'confirmed' || s === 'active' || s === 'sent' || s === 'delivered' || s === 'read' || s === 'published') return 'green';
  if (s === 'completed') return 'blue';
  if (s === 'pending_otp' || s === 'grace_period' || s === 'pending' || s === 'failed' || s === 'temporarily_closed') return 'amber';
  if (s.startsWith('cancelled') || s === 'no_show' || s === 'expired' || s === 'expired_otp' || s === 'suspended' || s === 'dead' || s === 'disabled' || s === 'hidden') return 'red';
  return 'slate';
}

export { cx };
