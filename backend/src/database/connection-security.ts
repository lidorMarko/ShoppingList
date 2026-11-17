import { isIP } from 'net';
import type { TlsOptions } from 'tls';

// Connection settings for the migration CLIs (not the Nest application).
// TLS always verifies the server certificate and host name. Supabase's chain ends in its own
// root CA, which Node does not trust by default: supply it with NODE_EXTRA_CA_CERTS=<file>
// (or sslrootcert=<file> in the URL). node-postgres lets URL parameters override the `ssl`
// option given here, so parameters that could weaken or disable TLS are refused outright.
// DATABASE_SSL=false is accepted only for a loopback database (disposable local testing).
// Errors name the offending setting, never the URL, user or password.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ALLOWED_URL_PARAMETERS = new Set(['sslmode', 'sslrootcert', 'application_name']);

export interface MigrationConnectionOptions {
  url: string;
  ssl: false | TlsOptions;
}

export function migrationConnectionOptions(env: NodeJS.ProcessEnv = process.env): MigrationConnectionOptions {
  const raw = env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL must be supplied explicitly');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_URL_PARAMETERS.has(key)) throw new Error(`DATABASE_URL parameter "${key}" is not allowed for migrations`);
  }
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode !== null && sslmode !== 'verify-full') {
    throw new Error('DATABASE_URL sslmode must be omitted or verify-full; weaker modes are refused');
  }

  const sslSetting = env.DATABASE_SSL;
  if (sslSetting === 'false') {
    if (!LOOPBACK_HOSTS.has(url.hostname)) throw new Error('DATABASE_SSL=false is allowed only for a loopback (local) database');
    if (sslmode !== null || url.searchParams.has('sslrootcert')) throw new Error('DATABASE_SSL=false conflicts with TLS parameters in DATABASE_URL');
    return { url: raw, ssl: false };
  }
  if (sslSetting !== undefined && sslSetting !== '' && sslSetting !== 'true') {
    throw new Error('DATABASE_SSL must be "true" (default) or "false"');
  }
  // node-postgres sends no TLS server name for an IP address, so Node would check the
  // certificate against "localhost" instead of the host: require a DNS host name.
  if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new Error('DATABASE_URL must use the database host name, not an IP address, so the certificate host name can be verified');
  }
  return { url: raw, ssl: { rejectUnauthorized: true } };
}

// Removes the connection string and password from a message before it is printed.
export function redactConnectionSecrets(message: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DATABASE_URL;
  if (!raw) return message;
  let out = message.split(raw).join('[DATABASE_URL]');
  try {
    const password = decodeURIComponent(new URL(raw).password);
    if (password) out = out.split(password).join('[redacted]');
  } catch {
    // An unparsable URL was already rejected before connecting.
  }
  return out;
}
