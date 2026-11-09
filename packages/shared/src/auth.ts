import { z } from 'zod';

export const languageSchema = z.enum(['ta', 'en']);
export type Language = z.infer<typeof languageSchema>;

export const userRoleSchema = z.enum(['buyer', 'seller', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

/** POST /auth/session: exchange a Firebase phone-auth ID token for Xatu tokens. */
export const createSessionRequestSchema = z.object({
  firebaseIdToken: z.string().min(1).max(4096),
  deviceName: z.string().max(100).optional(),
  language: languageSchema.optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

/** POST /auth/refresh and POST /auth/logout. */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const meSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  language: languageSchema,
  roles: z.array(userRoleSchema),
  isSeller: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;

export const authSessionSchema = z.object({
  accessToken: z.string(),
  /** ISO timestamp. */
  accessTokenExpiresAt: z.string(),
  refreshToken: z.string(),
  /** ISO timestamp. */
  refreshTokenExpiresAt: z.string(),
  user: meSchema,
  isNewUser: z.boolean(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;
