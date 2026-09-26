// Tells TypeScript that our requestId middleware adds `id` to every request.
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
  }
}
