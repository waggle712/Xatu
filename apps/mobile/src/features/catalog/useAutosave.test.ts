import type { ProductDraft, SellerProduct } from '@xatu/shared';
import { act, renderHook } from '@testing-library/react-native';
import { ApiRequestError } from '../../lib/api';
import { useAutosave } from './useAutosave';

const product = { id: 'p1' } as SellerProduct;

describe('useAutosave', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('debounces and merges edits into one save', async () => {
    const save = jest.fn(async (_p: ProductDraft) => product);
    const { result } = await renderHook(() => useAutosave(save, () => undefined));
    await act(async () => {
      result.current.schedule({ title: 'Di' });
      result.current.schedule({ title: 'Diya' });
      result.current.schedule({ titleTa: 'அகல்' });
    });
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: 'Diya', titleTa: 'அகல்' });
    expect(result.current.status).toBe('saved');
  });

  it('never runs two saves at once; edits made meanwhile go in the next save', async () => {
    let release: (p: SellerProduct) => void = () => undefined;
    const calls: ProductDraft[] = [];
    const save = jest.fn(
      (p: ProductDraft) =>
        new Promise<SellerProduct>((resolve) => {
          calls.push(p);
          release = resolve;
        }),
    );
    const { result } = await renderHook(() => useAutosave(save, () => undefined));

    await act(async () => result.current.schedule({ title: 'First' }));
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => result.current.schedule({ title: 'Second' }));
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    expect(save).toHaveBeenCalledTimes(1); // still waiting for the first

    await act(async () => release(product));
    expect(calls).toEqual([{ title: 'First' }, { title: 'Second' }]);
    await act(async () => release(product));
    expect(result.current.status).toBe('saved');
  });

  it('keeps failed edits and retries them on flush', async () => {
    const save = jest
      .fn<Promise<SellerProduct>, [ProductDraft]>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(product);
    const { result } = await renderHook(() => useAutosave(save, () => undefined));
    await act(async () => result.current.schedule({ title: 'Diya' }));
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    expect(result.current.status).toBe('error');

    let ok = false;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
    expect(save).toHaveBeenLastCalledWith({ title: 'Diya' });
  });

  it('drops an edit the server refuses (4xx) instead of resending it forever', async () => {
    const refused = new ApiRequestError(422, 'product_incomplete', 'missing');
    const onRejected = jest.fn();
    const save = jest
      .fn<Promise<SellerProduct>, [ProductDraft]>()
      .mockRejectedValueOnce(refused)
      .mockResolvedValue(product);
    const { result } = await renderHook(() => useAutosave(save, () => undefined, { onRejected }));
    await act(async () => result.current.schedule({ title: null }));
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    expect(result.current.status).toBe('rejected');
    expect(result.current.error).toBe(refused);
    expect(onRejected).toHaveBeenCalledWith(refused);

    await act(async () => result.current.schedule({ titleTa: 'அகல்' }));
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    expect(save).toHaveBeenLastCalledWith({ titleTa: 'அகல்' }); // the refused title is gone
    expect(result.current.status).toBe('saved');
  });

  it('prepares the patch at send time', async () => {
    const save = jest.fn(async (_p: ProductDraft) => product);
    const prepare = jest.fn((p: ProductDraft) => ({ ...p, titleTa: 'sent-time' }));
    const { result } = await renderHook(() => useAutosave(save, () => undefined, { prepare }));
    await act(async () => result.current.schedule({ title: 'Diya' }));
    await act(async () => {
      jest.advanceTimersByTime(900);
    });
    expect(save).toHaveBeenCalledWith({ title: 'Diya', titleTa: 'sent-time' });
  });
});
