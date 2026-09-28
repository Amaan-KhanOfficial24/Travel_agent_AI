import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase() // "Aman@Example.com" and "aman@example.com" are the same account
  .pipe(z.email('Must be a valid email address').max(254));

export const registerSchema = z.object({
  email,
  // Length beats complexity rules (NIST 800-63B). The 128 cap stops someone sending a
  // 10 MB "password" to make the server spend its CPU hashing it.
  password: z.string().min(10, 'Use at least 10 characters').max(128, 'Use at most 128 characters'),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});
