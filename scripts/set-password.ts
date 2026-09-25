// Sets (or changes) the password for the allowlisted user, creating the user
// row if needed. Run in a real terminal:  npm run set-password
// The password is read with hidden input and never written to disk or logs.
import { pool, db } from '@/lib/db';
import { users } from '@/db/schema';
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/auth/password';

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('Needs an interactive terminal (run it directly, not piped or via a tool).'));
      return;
    }
    process.stdout.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const email = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('ALLOWED_EMAIL is not set in .env.local');

  console.log(`Setting password for ${email}`);
  const password = await readHidden(`New password (min ${MIN_PASSWORD_LENGTH} characters): `);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters (got ${password.length}). Nothing changed.`);
  }
  const again = await readHidden('Repeat password: ');
  if (again !== password) throw new Error('Passwords did not match. Nothing changed.');

  const passwordHash = await hashPassword(password);
  await db
    .insert(users)
    .values({ email, passwordHash })
    .onConflictDoUpdate({ target: users.email, set: { passwordHash } });

  console.log('Password saved.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
