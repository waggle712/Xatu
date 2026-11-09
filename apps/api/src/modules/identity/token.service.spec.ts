import { TokenService } from './token.service.js';

describe('TokenService', () => {
  const tokens = new TokenService();

  it('signs and verifies an access token', async () => {
    const { token, expiresAt } = await tokens.signAccessToken({ sub: 'user-1', roles: ['buyer'] });
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    await expect(tokens.verifyAccessToken(token)).resolves.toEqual({
      sub: 'user-1',
      roles: ['buyer'],
    });
  });

  it('rejects a tampered token', async () => {
    const { token } = await tokens.signAccessToken({ sub: 'user-1', roles: ['buyer'] });
    const [h, p, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', roles: ['admin'] })).toString(
      'base64url',
    );
    expect(p).toBeDefined();
    await expect(tokens.verifyAccessToken(`${h}.${forged}.${s}`)).resolves.toBeNull();
  });

  it('rejects garbage', async () => {
    await expect(tokens.verifyAccessToken('not-a-jwt')).resolves.toBeNull();
  });

  it('makes unique refresh tokens and stable hashes', () => {
    const a = tokens.newRefreshToken();
    const b = tokens.newRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(tokens.hashRefreshToken(a)).toBe(tokens.hashRefreshToken(a));
    expect(tokens.hashRefreshToken(a)).not.toBe(a);
  });
});
