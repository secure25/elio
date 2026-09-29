// Hand-rolled Google OAuth 2.0 (code exchange, refresh, auto-refresh-on-401).
// Tokens are stored encrypted in connector_grants; never logged or sent to the model.
import { db, now, uuid, audit } from "./db";
import { encrypt, decrypt } from "./vault";

const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";

export function googleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3210"}/api/oauth/google/callback`;
}

export function buildAuthUrl(scopes: string[], state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${OAUTH_AUTH}?${params.toString()}`;
}

export async function exchangeCode(code: string, state: string) {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      state,
    }),
  });
  const tok = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !tok.access_token) {
    throw new Error(tok.error_description || tok.error || "OAuth token exchange failed");
  }
  return tok;
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }),
  });
  const tok = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !tok.access_token) throw new Error(tok.error || "Token refresh failed");
  return tok;
}

export type Grant = {
  connector: string;
  scopes: string;
  status: string;
  account_email: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_iv: string | null;
  token_tag: string | null;
  expires_at: number | null;
};

export function getGrant(connector: string): Grant | null {
  const row = db.prepare("SELECT * FROM connector_grants WHERE connector = ?").get(connector) as
    | Grant
    | undefined;
  return row ?? null;
}

export function listGrants() {
  return db
    .prepare(
      "SELECT connector, scopes, status, account_email, expires_at, updated_at FROM connector_grants"
    )
    .all();
}

function decryptStoredToken(
  stored: string,
  legacyIv?: string | null,
  legacyTag?: string | null
): string {
  try {
    const obj = JSON.parse(stored);
    if (obj.ciphertext && obj.iv && obj.tag) {
      return decrypt(obj);
    }
  } catch {
    // legacy format: stored is raw ciphertext, iv & tag in separate columns
  }
  if (legacyIv && legacyTag) {
    return decrypt({
      ciphertext: stored,
      iv: legacyIv,
      tag: legacyTag,
    });
  }
  throw new Error("Cannot decrypt token: missing IV or auth tag");
}

export async function saveGrant(
  connector: string,
  scopes: string[],
  tok: { access_token?: string; refresh_token?: string; expires_in?: number },
  accountEmail: string | null
) {
  const encAccess = encrypt(tok.access_token || "");
  const encRefresh = tok.refresh_token ? encrypt(tok.refresh_token) : null;
  const accessPayload = JSON.stringify(encAccess);
  const refreshPayload = encRefresh ? JSON.stringify(encRefresh) : null;

  db.prepare(
    `INSERT INTO connector_grants (id, connector, scopes, status, account_email,
      access_token_enc, refresh_token_enc, token_iv, token_tag, expires_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(connector) DO UPDATE SET scopes=excluded.scopes, status=excluded.status,
      account_email=excluded.account_email, access_token_enc=excluded.access_token_enc,
      refresh_token_enc=COALESCE(excluded.refresh_token_enc, connector_grants.refresh_token_enc),
      token_iv=excluded.token_iv, token_tag=excluded.token_tag, expires_at=excluded.expires_at,
      updated_at=excluded.updated_at`
  ).run(
    uuid(),
    connector,
    scopes.join(" "),
    "connected",
    accountEmail,
    accessPayload,
    refreshPayload,
    encAccess.iv,
    encAccess.tag,
    now() + (tok.expires_in || 3600) * 1000,
    now(),
    now()
  );
  audit("oauth", "grant.saved", { target: connector, risk: "high" });
}

/** Get a valid access token, refreshing + persisting if expired. */
export async function getAccessToken(connector: string): Promise<string> {
  const grant = getGrant(connector);
  if (!grant || grant.status !== "connected" || !grant.access_token_enc) {
    throw new Error(`${connector} is not connected. Connect it on the Connectors page.`);
  }

  // If access token is still valid (> 60s remaining), use it
  if (grant.expires_at && grant.expires_at - now() > 60_000) {
    try {
      return decryptStoredToken(grant.access_token_enc, grant.token_iv, grant.token_tag);
    } catch {
      // Access token decryption failed; fall through to refresh
    }
  }

  if (!grant.refresh_token_enc) {
    throw new Error(`${connector} access token expired and no refresh token exists. Please reconnect ${connector} on the Connectors page.`);
  }

  let refreshToken: string;
  try {
    refreshToken = decryptStoredToken(grant.refresh_token_enc, grant.token_iv, grant.token_tag);
  } catch (err: any) {
    throw new Error(
      `${connector} refresh token could not be decrypted (${err.message}). Please reconnect ${connector} on the Connectors page.`
    );
  }

  const tok = await refreshAccessToken(refreshToken);
  const enc = encrypt(tok.access_token!);
  const accessPayload = JSON.stringify(enc);
  db.prepare(
    "UPDATE connector_grants SET access_token_enc=?, token_iv=?, token_tag=?, expires_at=?, updated_at=? WHERE connector=?"
  ).run(accessPayload, enc.iv, enc.tag, now() + (tok.expires_in || 3600) * 1000, now(), connector);
  return tok.access_token!;
}

export function disconnectGrant(connector: string) {
  db.prepare("DELETE FROM connector_grants WHERE connector = ?").run(connector);
  audit("oauth", "grant.disconnected", { target: connector, risk: "medium" });
}

export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo?access_token=" +
        encodeURIComponent(accessToken)
    );
    const j = (await res.json()) as { email?: string };
    return j.email ?? null;
  } catch {
    return null;
  }
}
