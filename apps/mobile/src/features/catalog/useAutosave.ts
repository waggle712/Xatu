import type { ProductDraft, SellerProduct } from '@xatu/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../../lib/api';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'rejected';

const DEBOUNCE_MS = 800;

interface Options {
  /** Called just before sending, so values that depend on the last server reply are fresh. */
  prepare?: (patch: ProductDraft) => ProductDraft;
  /** The server refused the edit (4xx). The edit is dropped; reload what the server has. */
  onRejected?: (error: ApiRequestError) => void;
}

/** Worth retrying: no answer, a server error, or the rate limit. Other 4xx answers are final. */
function isRetryable(err: unknown): boolean {
  return !(err instanceof ApiRequestError) || err.status >= 500 || err.status === 429;
}

/**
 * Autosave with one request in flight. Edits made while a save is running are merged and sent
 * after it returns, so a slow older save can never overwrite a newer one. `variants` is always
 * the full list, so the newest list simply replaces the older one. A refused edit is dropped
 * (never resent), so one bad field can't block every later save.
 */
export function useAutosave(
  save: (patch: ProductDraft) => Promise<SellerProduct>,
  onSaved: (product: SellerProduct, sent: ProductDraft) => void,
  options: Options = {},
) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<ApiRequestError | null>(null);
  const pending = useRef<ProductDraft | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ save, onSaved, options });
  latest.current = { save, onSaved, options };

  const run = useCallback(async (): Promise<boolean> => {
    if (inFlight.current || !pending.current) return true;
    const patch = pending.current;
    pending.current = null;
    inFlight.current = true;
    setStatus('saving');
    try {
      const { save: send, onSaved: saved, options: opts } = latest.current;
      const product = await send(opts.prepare ? opts.prepare(patch) : patch);
      saved(product, patch);
      inFlight.current = false;
      setError(null);
      if (pending.current) return run();
      setStatus('saved');
      return true;
    } catch (err) {
      inFlight.current = false;
      if (isRetryable(err)) {
        // Keep the edits for the next try; newer edits (if any) win field by field.
        pending.current = { ...patch, ...(pending.current ?? {}) };
        setStatus('error');
        return false;
      }
      setError(err as ApiRequestError);
      setStatus('rejected');
      latest.current.options.onRejected?.(err as ApiRequestError);
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

  return { status, error, schedule, flush };
}
