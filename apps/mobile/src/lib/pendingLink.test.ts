import { clearPendingLink, rememberLink, takePendingLink } from './pendingLink';

const id = '0195f0e2-7c1a-4b3e-9d2f-1a2b3c4d5e6f';

describe('pending share link', () => {
  afterEach(() => clearPendingLink());

  it('keeps an allowlisted link and gives it back once', () => {
    expect(rememberLink(`https://links.example.in/p/${id}?utm=wa`)).toBe(`/p/${id}`);
    expect(takePendingLink()).toBe(`/p/${id}`);
    expect(takePendingLink()).toBeNull();
  });

  it('never stores other routes', () => {
    expect(rememberLink('xatu://shop/product/123')).toBeNull();
    expect(rememberLink('/profile')).toBeNull();
    expect(takePendingLink()).toBeNull();
  });

  it('drops a link that waited too long', () => {
    rememberLink('/s/ammas_kitchen');
    expect(takePendingLink(Date.now() + 31 * 60_000)).toBeNull();
  });

  it('is cleared when that page has opened', () => {
    rememberLink('/s/ammas_kitchen');
    clearPendingLink('/s/other_shop');
    clearPendingLink('/s/ammas_kitchen');
    expect(takePendingLink()).toBeNull();
  });
});
