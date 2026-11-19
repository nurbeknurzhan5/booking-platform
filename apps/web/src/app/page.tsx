import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Онлайн-запись для сервисного бизнеса</h1>
        <p className="mt-2 text-slate-600">Салоны красоты, барбершопы, массаж, бани, автомойки, детейлинг, автосервисы и другие.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/login" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-brand-500">
          <div className="font-semibold">Вход для бизнеса</div>
          <div className="text-sm text-slate-500">Владельцы, администраторы, суперадминистратор</div>
        </Link>
        <Link href="/ru/cabinet" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-brand-500">
          <div className="font-semibold">Личный кабинет клиента</div>
          <div className="text-sm text-slate-500">Мои записи, перенос, отмена, отзывы</div>
        </Link>
      </div>
      <p className="text-xs text-slate-400">
        <Link href="/legal/privacy" className="underline">Политика конфиденциальности</Link> ·{' '}
        <Link href="/legal/terms" className="underline">Пользовательское соглашение</Link>
      </p>
    </main>
  );
}
