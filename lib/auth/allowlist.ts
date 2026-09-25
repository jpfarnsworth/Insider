// Pure so it can be unit tested and shared by the Auth.js callback and requireUser().
export function isAllowedEmail(
  email: string | null | undefined,
  allowed: string | undefined = process.env.ALLOWED_EMAIL,
): boolean {
  if (!email || !allowed) return false;
  return email.trim().toLowerCase() === allowed.trim().toLowerCase();
}
