import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { UUID_RE } from '@/lib/api-path';

/** Карточка организации в админке: идентификатор из адреса — только UUID, иначе 404. */
export default async function AdminOrgSegmentLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  return children;
}
