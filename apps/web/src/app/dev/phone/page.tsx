import { notFound } from 'next/navigation';
import { DEV_INBOX_ENABLED } from '@/lib/dev-inbox';
import { DevPhone } from '@/components/dev/DevPhone';

// В сообщениях — одноразовые ссылки подтверждения и управления записью: не передаём их в Referer и не индексируем.
export const metadata = { title: 'Тестовый телефон', referrer: 'no-referrer', robots: { index: false, follow: false } };

/** «Тестовый телефон» — только при явном флаге NEXT_PUBLIC_DEV_INBOX_ENABLED=true, иначе 404. */
export default function DevPhonePage() {
  if (!DEV_INBOX_ENABLED) notFound();
  return <DevPhone />;
}
