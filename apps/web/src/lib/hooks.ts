'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import type { ApiPath } from './api-path';

/** Загрузка данных с API: { data, error, loading, reload }. path = null — не загружать. */
export function useApi<T>(apiPathOrNull: ApiPath | null) {
  // ApiPath создаётся заново при каждом рендере: перезагрузка — только при смене самой строки пути
  const key = apiPathOrNull === null ? null : apiPathOrNull.toString();
  const pathRef = useRef(apiPathOrNull);
  pathRef.current = apiPathOrNull;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!apiPathOrNull);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const path = pathRef.current;
    if (!key || !path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const r = await api<T>(path);
      if (id === seq.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(errorMessage(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Выполнение действия с флагом занятости и сообщением об ошибке. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
