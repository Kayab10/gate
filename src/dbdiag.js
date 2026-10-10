// Plain-English diagnosis of "the database is not connected", without ever echoing the password.

/** Turn a connection error into { message, hint } a human can act on. */
export function explainDbError(e, urlString = '') {
  const code = e?.code || '';
  const msg = String(e?.message || e);
  let host = '';
  try {
    host = new URL(urlString).hostname;
  } catch {
    /* unparseable; handled in checkUrl */
  }
  const direct = /^db\.[a-z0-9]+\.supabase\.co$/i.test(host);

  if (code === '28P01' || /password authentication failed/i.test(msg))
    return { message: 'The database rejected the password.', hint: 'Use your database password (Supabase → Project Settings → Database → Reset database password), put it in DATABASE_URL in place of [YOUR-PASSWORD], with no square brackets. If it contains @ : / # ? or %, URL-encode those characters.' };
  if (/tenant or user not found/i.test(msg) || code === 'XX000')
    return { message: 'The pooler does not recognise the username or region.', hint: 'Copy the Transaction pooler string again from Supabase → Connect. The username must look like postgres.<project-ref> and the host must be the exact aws-0-<region>.pooler.supabase.com shown there.' };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return { message: `The host name "${host || '?'}" could not be found.`, hint: direct ? 'You used the Direct connection, which Vercel cannot reach (it needs IPv6). Use the Transaction pooler string instead (host ends in .pooler.supabase.com, port 6543).' : 'The host is probably incomplete or mistyped (a "…" or missing region?). Copy the whole connection string from Supabase → Connect → Transaction pooler.' };
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH')
    return { message: 'The database host cannot be reached from here.', hint: direct ? 'The Direct connection is IPv6-only and Vercel cannot use it. Use the Transaction pooler string (port 6543).' : 'Network unreachable. Check the host in DATABASE_URL.' };
  if (code === 'ECONNREFUSED') return { message: 'The connection was refused.', hint: 'Check the port: use 6543 (Transaction pooler) or 5432 (Session pooler), and make sure the Supabase project is not paused.' };
  if (code === 'ETIMEDOUT' || /timeout|timed out/i.test(msg))
    return { message: 'The connection timed out.', hint: 'The Supabase project may be paused (free projects pause after a week of no use: open the Supabase dashboard and click Restore) or the host/port is wrong.' };
  if (/self[- ]signed|certificate|SSL/i.test(msg)) return { message: 'A secure-connection (SSL) problem.', hint: 'Use the pooler string from Supabase → Connect without changing it; remove any extra ?sslmode= options.' };
  if (code === '3D000' || /database .* does not exist/i.test(msg)) return { message: 'The database name does not exist.', hint: 'The string should end in /postgres.' };
  if (/too many (connections|clients)|remaining connection slots/i.test(msg)) return { message: 'The database has too many open connections.', hint: 'Wait a minute and retry. Make sure you are using the Transaction pooler (port 6543).' };
  return { message: msg.slice(0, 200), hint: 'Open Vercel → Deployments → latest → Logs for the full error.' };
}

/** Static checks on the string itself (no network). Returns null if it looks fine, else { message, hint }. */
export function checkUrl(urlString) {
  if (!urlString) return { message: 'DATABASE_URL is not set for this deployment.', hint: 'Vercel → Project → Settings → Environment Variables → add DATABASE_URL for Production and Preview, then Deployments → Redeploy.' };
  if (/[…]|\.\.\./.test(urlString)) return { message: 'DATABASE_URL contains "…" — it was copied in shortened form.', hint: 'Paste the complete string from Supabase → Connect → Transaction pooler.' };
  if (/\[YOUR-PASSWORD\]|\[PASSWORD\]/i.test(urlString)) return { message: 'DATABASE_URL still contains the placeholder [YOUR-PASSWORD].', hint: 'Replace it (including the square brackets) with your database password.' };
  let u;
  try {
    u = new URL(urlString.trim());
  } catch {
    return { message: 'DATABASE_URL is not a valid address.', hint: 'It should look like postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres. If the password has @ : / # ? or %, URL-encode those characters.' };
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { message: `DATABASE_URL starts with "${u.protocol}" instead of postgresql://.`, hint: 'Paste the connection string, not the project https:// URL or an API key.' };
  if (!u.password) return { message: 'DATABASE_URL has no password in it.', hint: 'The format is postgresql://USER:PASSWORD@HOST:PORT/postgres.' };
  if (/pooler\.supabase\.com$/i.test(u.hostname) && !/^postgres\.[a-z0-9]+$/i.test(decodeURIComponent(u.username)))
    return { message: 'With the pooler the username must be postgres.<project-ref>, not just "postgres".', hint: 'Copy the string again from Supabase → Connect → Transaction pooler; it already has the right username.' };
  return null;
}

/** Safe description of what is configured (never the password). */
export function describeUrl(urlString) {
  try {
    const u = new URL(urlString.trim());
    return { host: u.hostname, port: u.port || '5432', database: u.pathname.slice(1), usernameLooksRight: /^postgres\.[a-z0-9]+$/i.test(decodeURIComponent(u.username)), pooler: /pooler\.supabase\.com$/i.test(u.hostname), passwordLength: decodeURIComponent(u.password).length };
  } catch {
    return null;
  }
}
