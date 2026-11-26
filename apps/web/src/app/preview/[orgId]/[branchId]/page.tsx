'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useApi } from '@/lib/hooks';
import type { PublicPageData } from '@/lib/types';
import { PublicPageView } from '@/components/public/PublicPageView';
import { Alert, Spinner } from '@/components/ui';
import { apiPath } from '@/lib/api-path';

function Preview() {
  const { orgId, branchId } = useParams<{ orgId: string; branchId: string }>();
  const sp = useSearchParams();
  const qs = new URLSearchParams({ locale: sp.get('locale') ?? 'ru' });
  if (sp.get('templateId')) qs.set('templateId', sp.get('templateId')!);
  if (sp.get('colorScheme')) qs.set('colorScheme', sp.get('colorScheme')!);
  const { data, error } = useApi<PublicPageData>(apiPath`/organizations/${orgId}/branches/${branchId}/page/preview?${qs}`);
  if (error) return <div className="p-6"><Alert>{error}</Alert></div>;
  if (!data) return <Spinner />;
  return <PublicPageView data={data} preview device={sp.get('device') === 'mobile' ? 'mobile' : 'desktop'} />;
}

/** Предпросмотр черновика (отдельная вкладка или iframe редактора); в аналитике не учитывается. */
export default function PreviewPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Preview />
    </Suspense>
  );
}
