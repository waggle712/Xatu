import { clearPendingLink, consumeLink, handleIncomingLink, takePendingLink } from './pendingLink';

const id = '0195f0e2-7c1a-4b3e-9d2f-1a2b3c4d5e6f';

describe('incoming share links', () => {
  afterEach(() => clearPendingLink());

  it('opens only product and shop pages', () => {
    expect(handleIncomingLink(`https://links.example.in/p/${id}?utm=wa`, false)).toBe(`/p/${id}`);
    expect(handleIncomingLink('xatu://s/Ammas_Kitchen', false)).toBe('/s/ammas_kitchen');
    // Anything else: open the app normally on first launch, ignore it later.
    expect(handleIncomingLink('xatu://shop/product/123', true)).toBe('/');
    expect(handleIncomingLink('/profile', false)).toBeNull();
  });

  it('cold start while signed out: the link waits and opens after sign-in, once', () => {
    // On a cold start the session is still loading, so the link is remembered either way.
    expect(handleIncomingLink(`xatu://p/${id}`, true)).toBe(`/p/${id}`);
    // ...the protected page bounces to Welcome; the person signs in:
    expect(takePendingLink()).toBe(`/p/${id}`);
    // ...the product page opens and consumes it, noting that a sign-in came in between.
    expect(consumeLink(`/p/${id}`)).toEqual({ afterSignIn: true });
    expect(consumeLink(`/p/${id}`)).toBeNull();
    expect(takePendingLink()).toBeNull();
  });

  it('signed in already: the page opens directly and the link is not replayed later', () => {
    handleIncomingLink(`/p/${id}`, false);
    expect(consumeLink(`/p/${id}`)).toEqual({ afterSignIn: false });
    expect(takePendingLink()).toBeNull();
  });

  it('a different page opening leaves the waiting link alone', () => {
    handleIncomingLink('/s/ammas_kitchen', false);
    expect(consumeLink('/s/other_shop')).toBeNull();
    expect(takePendingLink()).toBe('/s/ammas_kitchen');
  });

  it('drops a link that waited too long, and on sign-out', () => {
    handleIncomingLink('/s/ammas_kitchen', true);
    expect(takePendingLink(Date.now() + 31 * 60_000)).toBeNull();
    handleIncomingLink('/s/ammas_kitchen', true);
    clearPendingLink();
    expect(takePendingLink()).toBeNull();
  });
});
