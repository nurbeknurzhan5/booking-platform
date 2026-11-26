import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { UUID_RE } from '@/lib/api-path';

/** Предпросмотр черновика: идентификаторы организации и филиала — только UUID, иначе 404. */
export default async function PreviewSegmentLayout({ children, params }: { children: ReactNode; params: Promise<{ orgId: string; branchId: string }> }) {
  const { orgId, branchId } = await params;
  if (!UUID_RE.test(orgId) || !UUID_RE.test(branchId)) notFound();
  return children;
}
