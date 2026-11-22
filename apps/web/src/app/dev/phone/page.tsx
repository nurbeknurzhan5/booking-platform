'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatPhone } from '@/lib/format';

interface Msg {
  id: string;
  recipient: string;
  type: string;
  text: string;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  booking_link: 'Ссылка подтверждения',
  otp: 'Код входа',
  appointment_confirmed: 'Запись подтверждена',
  appointment_reminder: 'Напоминание',
  appointment_rescheduled: 'Перенос',
  appointment_cancelled: 'Отмена',
  review_request: 'Просьба об отзыве',
  waitlist_offer: 'Лист ожидания',
  reactivation: 'Реактивация',
};

/** Текст сообщения со ссылками, по которым можно перейти. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all font-medium text-sky-700 underline" data-testid="phone-link">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * «Тестовый телефон» (только разработка): временная замена WhatsApp, пока не подключён Meta Business.
 * Показывает сообщения, которые платформа отправила бы клиентам, — коды, ссылки подтверждения, напоминания.
 */
export default function DevPhonePage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('phone');
    if (q) setActive(q.replace(/\s/g, ''));
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Msg[]>('/dev/inbox')
        .then((r) => alive && (setMessages(r), setError(null)))
        .catch((e) => alive && setError(errorMessage(e)));
    void load();
    const id = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const phones = useMemo(() => {
    const m = new Map<string, Msg>();
    for (const x of messages) if (!m.has(x.recipient)) m.set(x.recipient, x);
    return [...m.values()].filter((x) => !filter || x.recipient.includes(filter.replace(/\D/g, '')));
  }, [messages, filter]);
  const current = active ?? phones[0]?.recipient ?? null;
  const chat = messages.filter((m) => m.recipient === current).reverse();

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Тестовый телефон.</b> WhatsApp ещё не подключён, поэтому сообщения клиентам не уходят на настоящий телефон, а показываются здесь.
          Откройте ссылку из сообщения, чтобы подтвердить запись. Страница обновляется каждые 2 секунды. В рабочей версии сайта её нет.
        </div>
        {error && <div className="mb-4 rounded-lg bg-rose-100 p-3 text-sm text-rose-800">{error}</div>}
        <div className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid-cols-[260px_1fr]" style={{ minHeight: 560 }}>
          <aside className="border-b border-slate-200 md:border-b-0 md:border-r">
            <div className="border-b border-slate-200 p-3">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Поиск по номеру" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <ul className="max-h-[480px] overflow-y-auto" data-testid="phone-chats">
              {phones.map((p) => (
                <li key={p.recipient}>
                  <button type="button" onClick={() => setActive(p.recipient)} className={`w-full px-4 py-3 text-left text-sm ${p.recipient === current ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                    <div className="font-semibold">{formatPhone(p.recipient)}</div>
                    <div className="truncate text-xs text-slate-500">{TYPE_LABELS[p.type] ?? p.type}</div>
                  </button>
                </li>
              ))}
              {phones.length === 0 && <li className="p-4 text-sm text-slate-500">Сообщений пока нет. Запишитесь на любой демо-странице — сообщение появится здесь.</li>}
            </ul>
          </aside>
          <section className="flex flex-col bg-[#efeae2]">
            <header className="flex items-center gap-3 bg-emerald-700 px-4 py-3 text-white">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">✆</span>
              <div>
                <div className="font-semibold">{current ? formatPhone(current) : '—'}</div>
                <div className="text-xs text-white/80">тестовые сообщения</div>
              </div>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-4" data-testid="phone-messages">
              {chat.map((m) => (
                <div key={m.id} className="max-w-[85%] rounded-xl rounded-tl-none bg-white px-3 py-2 text-sm shadow-sm">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">{TYPE_LABELS[m.type] ?? m.type}</div>
                  <div className="whitespace-pre-wrap leading-relaxed">
                    <Linkified text={m.text} />
                  </div>
                  <div className="mt-1 text-right text-[11px] text-slate-400">{new Date(m.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
