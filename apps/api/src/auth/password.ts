// Password hashing with argon2id, the current OWASP recommendation.
// A hash is one-way: we can check a password against it, never recover the password.
// argon2 is deliberately slow and memory-hungry (here 19 MiB, ~20-50 ms per hash), so an
// attacker who steals the users table can only try a few guesses per second per core,
// instead of billions per second as with a fast hash like SHA-256.
import argon2 from 'argon2';

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB (19 MiB): OWASP minimum for argon2id
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (password: string) => argon2.hash(password, OPTIONS);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false; // malformed hash: treat as a failed login, never as a crash
  }
}

// Used when the email does not exist: we still spend the same time hashing, so an
// attacker cannot tell "no such user" from "wrong password" by measuring response time.
let dummyHash: Promise<string> | undefined;
export async function burnHashTime(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-only');
  await verifyPassword(await dummyHash, password);
}
