import bcrypt from 'bcryptjs';

export const MIN_PASSWORD_LENGTH = 12;
const COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Compared against when the account doesn't exist, so a wrong email costs the
// same time as a wrong password and doesn't reveal which emails are valid.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  return (dummyHash ??= hashPassword('not-a-real-password'));
}
