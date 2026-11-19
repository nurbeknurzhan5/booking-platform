import { notFound } from 'next/navigation';
import { isLang } from '@/lib/i18n-public';
import { CabinetClient } from './CabinetClient';

export const metadata = { title: 'Личный кабинет' };

export default async function CabinetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLang(locale)) notFound();
  return <CabinetClient lang={locale} />;
}
