import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../../config/env.js';

export interface AccessTokenClaims {
  sub: string;
  roles: string[];
}

const ISSUER = 'xatu-api';
const AUDIENCE = 'xatu-app';

@Injectable()
export class TokenService {
  private readonly secret = new TextEncoder().encode(env.JWT_SECRET);

  async signAccessToken(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + env.JWT_ACCESS_TTL_SECONDS * 1000);
    const token = await new SignJWT({ roles: claims.roles })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret);
    return { token, expiresAt };
  }

  /** Returns the claims, or null if the token is invalid or expired. */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string') return null;
      const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
      return { sub: payload.sub, roles };
    } catch {
      return null;
    }
  }

  /** Opaque random refresh token; only its hash is stored. */
  newRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
