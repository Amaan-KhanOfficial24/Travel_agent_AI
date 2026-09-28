// Tells TypeScript what our middleware adds to every request.
import 'express';
import type { SessionUser } from '../auth/sessions.js';

declare module 'express-serve-static-core' {
  interface Request {
    id: string; // requestId middleware
    user?: SessionUser; // authenticate middleware (undefined when not logged in)
  }
}
