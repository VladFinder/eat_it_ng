import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// This command requires server filesystem access. There is no public grant endpoint.
const email = process.argv[2]?.trim().toLowerCase();
if (!email || process.argv.length !== 3) {
  console.error('Usage: npm run admin:grant -- existing-account@example.com');
  process.exit(1);
}

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
let body = '';
try {
  body = await readFile(envPath, 'utf8');
  process.loadEnvFile(envPath);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const { prisma } = await import('./db.mjs');
try {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, authProvider: true },
  });
  if (!user) throw new Error('Account does not exist in this database; no access was granted.');
  const setting = /^\s*ADMIN_USER_IDS\s*=.*$/gm;
  const savedIds = [...body.matchAll(setting)].flatMap((match) =>
    match[0]
      .slice(match[0].indexOf('=') + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
      .split(','),
  );
  const ids = [
    ...new Set(
      [...savedIds, ...(process.env.ADMIN_USER_IDS ?? '').split(','), user.id]
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  const line = `ADMIN_USER_IDS="${ids.join(',')}"`;
  const next = body.match(setting)
    ? body.replace(setting, line)
    : `${body}${body.endsWith('\n') || !body ? '' : '\n'}${line}\n`;
  await writeFile(envPath, next, { mode: 0o600 });
  console.log(`Admin access configured for ${user.email} (${user.id}, ${user.authProvider}).`);
  console.log('Restart the API, then choose «Проверить доступ» in Dev Center.');
  console.log('If ADMIN_USER_IDS is also set in the service environment, update it there too.');
} finally {
  await prisma.$disconnect();
}
