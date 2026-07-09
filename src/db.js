import { createClient } from '@libsql/client/web';

const url = import.meta.env.VITE_TURSO_URL;
const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.warn('Turso credentials missing — set VITE_TURSO_URL and VITE_TURSO_AUTH_TOKEN in .env');
}

export const db = createClient({ url, authToken });

export function uid() {
  return crypto.randomUUID();
}

export async function query(sql, args = []) {
  const res = await db.execute({ sql, args });
  return res.rows;
}

export async function run(sql, args = []) {
  return db.execute({ sql, args });
}
