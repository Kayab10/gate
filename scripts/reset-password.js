// Reset a user's password (there is no email "forgot password" flow):
//   DATABASE_URL=postgresql://... node scripts/reset-password.js someone@example.com "new long password"
import { pgAdapter, initDb } from '../src/db.js';
import { createStore } from '../src/store.js';

const [email, password] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !email || !password) {
  console.error('Usage: DATABASE_URL=... node scripts/reset-password.js <email> "<new password>"');
  process.exit(1);
}
const db = await pgAdapter(process.env.DATABASE_URL);
await initDb(db);
const ok = await createStore(db).resetPassword(email, password);
console.log(ok ? `Password updated for ${email}.` : `No account found for ${email}.`);
await db.close();
