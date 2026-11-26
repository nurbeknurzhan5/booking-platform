'use client';

import { useState } from 'react';
import { errorMessage, uploadFile } from '@/lib/api';
import { useOrg } from './OrgContext';
import { useT } from '@/lib/i18n-dashboard';
import { apiPath } from '@/lib/api-path';

/** Загрузка изображения (проверка формата и размера — на сервере). */
export function ImageUpload({ kind, value, preview, onChange }: { kind: string; value: string | null | undefined; preview?: string | null; onChange: (id: string | null, urls?: Record<string, string>) => void }) {
  const { base } = useOrg();
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(preview ?? null);
  return (
    <div className="flex items-center gap-3">
      {url ? <img src={url} alt="" className="h-14 w-14 rounded-lg object-cover" /> : <div className="h-14 w-14 rounded-lg bg-slate-100" />}
      <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
        {busy ? '…' : t('upload')}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            setError(null);
            try {
              const r = await uploadFile(apiPath`${base}/files`, f, kind);
              setUrl(r.urls.thumb ?? null);
              onChange(r.id, r.urls);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }}
        />
      </label>
      {value && (
        <button type="button" className="text-xs text-slate-500 underline" onClick={() => { setUrl(null); onChange(null); }}>
          {t('delete')}
        </button>
      )}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
