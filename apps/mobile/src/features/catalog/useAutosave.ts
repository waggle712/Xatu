import type { ProductDraft, SellerProduct } from '@xatu/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 800;

/**
 * Autosave with one request in flight. Edits made while a save is running are merged and sent
 * after it returns, so a slow older save can never overwrite a newer one. `variants` is always
 * the full list, so the newest list simply replaces the older one.
 */
export function useAutosave(
  save: (patch: ProductDraft) => Promise<SellerProduct>,
  onSaved: (product: SellerProduct, sent: ProductDraft) => void,
) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const pending = useRef<ProductDraft | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  const onSavedRef = useRef(onSaved);
  saveRef.current = save;
  onSavedRef.current = onSaved;

  const run = useCallback(async (): Promise<boolean> => {
    if (inFlight.current || !pending.current) return true;
    const patch = pending.current;
    pending.current = null;
    inFlight.current = true;
    setStatus('saving');
    try {
      const product = await saveRef.current(patch);
      onSavedRef.current(product, patch);
      inFlight.current = false;
      if (pending.current) return run();
      setStatus('saved');
      return true;
    } catch {
      // Keep the failed edits; newer edits (if any) win field by field.
      pending.current = { ...patch, ...(pending.current ?? {}) };
      inFlight.current = false;
      setStatus('error');
      return false;
    }
  }, []);

  const schedule = useCallback(
    (patch: ProductDraft) => {
      pending.current = { ...(pending.current ?? {}), ...patch };
      setStatus('pending');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), DEBOUNCE_MS);
    },
    [run],
  );

  /** Saves now (before changing step, publishing or leaving). Resolves false if it failed. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    while (inFlight.current) await new Promise((r) => setTimeout(r, 50));
    return run();
  }, [run]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      // Leaving the screen: send whatever is left.
      if (pending.current && !inFlight.current) void run();
    },
    [run],
  );

  return { status, schedule, flush };
}
