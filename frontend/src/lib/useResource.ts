import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { isStatus } from './domain';

type Resource<T> = { key: string; loading: boolean; data: T | null; error: unknown };
/** Route keys prevent a previous route's private data from appearing during a new load. */
export function useResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>, owner = false) {
  const loader = useRef(load); loader.current = load;
  const aborter = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [resource, setResource] = useState<Resource<T>>({ key, loading: true, data: null, error: null });
  const { expire } = useAuth();
  const reload = useCallback(async () => {
    aborter.current?.abort();
    const controller = new AbortController(); aborter.current = controller;
    const current = ++generation.current;
    setResource({ key, loading: true, data: null, error: null });
    try {
      const data = await loader.current(controller.signal);
      if (!controller.signal.aborted && current === generation.current) setResource({ key, loading: false, data, error: null });
    } catch (error) {
      if (!controller.signal.aborted && current === generation.current) {
        setResource({ key, loading: false, data: null, error });
        if (owner && isStatus(error, 401)) expire();
      }
    }
  }, [key, owner, expire]);
  useEffect(() => { void reload(); return () => { generation.current++; aborter.current?.abort(); }; }, [reload]);
  return { ...(resource.key === key ? resource : { loading: true, data: null, error: null }), reload };
}
