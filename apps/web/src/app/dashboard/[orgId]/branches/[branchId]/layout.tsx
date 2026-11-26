import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { UUID_RE } from '@/lib/api-path';

/** Филиал в кабинете (настройки и редактор страницы): идентификатор из адреса — только UUID, иначе 404. */
export default async function BranchSegmentLayout({ children, params }: { children: ReactNode; params: Promise<{ branchId: string }> }) {
  const { branchId } = await params;
  if (!UUID_RE.test(branchId)) notFound();
  return children;
}
