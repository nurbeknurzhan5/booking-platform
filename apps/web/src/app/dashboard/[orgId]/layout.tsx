import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { OrgLayout } from '@/components/dashboard/OrgLayout';
import { UUID_RE } from '@/lib/api-path';

/** Кабинет организации: идентификатор из адреса — только UUID, иначе 404 до любых запросов к API. */
export default async function OrgSegmentLayout({ children, params }: { children: ReactNode; params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (!UUID_RE.test(orgId)) notFound();
  return <OrgLayout orgId={orgId}>{children}</OrgLayout>;
}
