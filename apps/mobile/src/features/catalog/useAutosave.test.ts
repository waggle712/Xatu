import type { ProductDraft, SellerProduct } from '@xatu/shared';
import { act, renderHook } from '@testing-library/react-native';
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
});
