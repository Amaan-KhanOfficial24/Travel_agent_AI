// Runtime validation. TypeScript types disappear when the code runs, so anything
// arriving over the network must be checked here before business logic sees it.
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { badRequest } from '../errors.js';

type Part = 'body' | 'params' | 'query';

export const validate =
  (schema: z.ZodType, part: Part = 'body'): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      // Turn zod's issues into a simple list the frontend can show next to fields.
      const fields = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      return next(badRequest('Request validation failed', fields));
    }
    // Store the cleaned, typed value (defaults applied, unknown keys stripped).
    res.locals[part] = result.data;
    next();
  };
