import type { User } from '../../generated/prisma/client.js';

/** The signed-in user attached to the request by AuthGuard. */
export type AuthUser = Pick<User, 'id' | 'phone' | 'name' | 'language' | 'roles'>;

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}
