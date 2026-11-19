import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <div>
        <p className="text-5xl font-bold text-slate-300">404</p>
        <h1 className="mt-2 text-xl font-semibold">Страница не найдена</h1>
        <Link href="/" className="mt-4 inline-block text-brand-600 underline">На главную</Link>
      </div>
    </main>
  );
}
