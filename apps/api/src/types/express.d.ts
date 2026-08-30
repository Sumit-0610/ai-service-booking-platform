import type { Role } from '@aisbp/shared';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. */
      user?: { id: string; role: Role };
      /** Set by `requireAuth`. */
      session?: { id: string; userId: string; role: Role; csrfToken: string };
    }
  }
}

export {};
