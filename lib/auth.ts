import { env } from "cloudflare:workers";
import { bearer, db, digest, token } from "./bridge";

const PBKDF2_ITERATIONS = 100_000;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iterationsRaw, saltHex, hashHex] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterationsRaw || !saltHex || !hashHex) return false;
  const actual = await pbkdf2(password, fromHex(saltHex), Number(iterationsRaw));
  return timingSafeEqual(actual, fromHex(hashHex));
}

export type UserRow = {
  id: string;
  email: string | null;
  display_name: string;
  balance_bits: number;
  plan: string;
  renews_at: number | null;
  created_at: number;
};

const USER_COLUMNS = "id, email, display_name, balance_bits, plan, renews_at, created_at";

const DAY_MS = 86_400_000;

export async function createUser(input: {
  email?: string | null;
  passwordHash?: string | null;
  displayName: string;
}) {
  const database = await db();
  const id = crypto.randomUUID(),
    now = Date.now();
  await database
    .prepare(
      "INSERT INTO users (id, email, password_hash, display_name, renews_at, created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      id,
      input.email || null,
      input.passwordHash || null,
      input.displayName,
      now + 30 * DAY_MS,
      now,
    )
    .run();
  return id;
}

export async function findUserByEmail(email: string) {
  const database = await db();
  return database
    .prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`)
    .bind(email)
    .first<UserRow & { password_hash: string | null }>();
}

export async function issueUserSession(userId: string, ttlDays = 90) {
  const database = await db();
  const rawToken = token();
  const now = Date.now();
  await database
    .prepare(
      "INSERT INTO user_sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), userId, await digest(rawToken), now, now + ttlDays * 86_400_000)
    .run();
  return rawToken;
}

export async function sessionUserByToken(rawToken: string): Promise<UserRow | null> {
  if (!rawToken) return null;
  const database = await db();
  const row = await database
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.balance_bits, u.plan, u.renews_at, u.created_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await digest(rawToken), Date.now())
    .first<UserRow>();
  return row || null;
}

export async function bearerUser(request: Request): Promise<UserRow | null> {
  return sessionUserByToken(bearer(request));
}

export async function revokeUserSession(request: Request) {
  const raw = bearer(request);
  if (!raw) return;
  const database = await db();
  await database
    .prepare("DELETE FROM user_sessions WHERE token_hash = ?")
    .bind(await digest(raw))
    .run();
}

export async function upsertOAuthUser(identity: {
  provider: OAuthProvider;
  providerUserId: string;
  providerUsername: string | null;
  email: string | null;
  displayName: string;
}) {
  const database = await db();
  const existing = await database
    .prepare("SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?")
    .bind(identity.provider, identity.providerUserId)
    .first<{ user_id: string }>();
  if (existing) return existing.user_id;
  const userId = await createUser({ email: identity.email, displayName: identity.displayName });
  await database
    .prepare(
      "INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, provider_username, created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      userId,
      identity.provider,
      identity.providerUserId,
      identity.providerUsername,
      Date.now(),
    )
    .run();
  return userId;
}

export type OAuthProvider = "roblox" | "discord" | "google";

type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
  clientIdEnv: string;
  clientSecretEnv: string;
};

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  roblox: {
    authorizeUrl: "https://apis.roblox.com/oauth/v1/authorize",
    tokenUrl: "https://apis.roblox.com/oauth/v1/token",
    userinfoUrl: "https://apis.roblox.com/oauth/v1/userinfo",
    scope: "openid profile",
    clientIdEnv: "ROBLOX_OAUTH_CLIENT_ID",
    clientSecretEnv: "ROBLOX_OAUTH_CLIENT_SECRET",
  },
  discord: {
    authorizeUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userinfoUrl: "https://discord.com/api/users/@me",
    scope: "identify email",
    clientIdEnv: "DISCORD_OAUTH_CLIENT_ID",
    clientSecretEnv: "DISCORD_OAUTH_CLIENT_SECRET",
  },
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
  },
};

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === "roblox" || value === "discord" || value === "google";
}

function providerCredentials(provider: OAuthProvider) {
  const config = PROVIDERS[provider];
  const vars = env as unknown as Record<string, string | undefined>;
  const clientId = vars[config.clientIdEnv];
  const clientSecret = vars[config.clientSecretEnv];
  if (!clientId || !clientSecret) throw new Error(`${provider} sign-in is not configured yet`);
  return { config, clientId, clientSecret };
}

const ALLOWED_RETURN_ORIGINS = [
  /^https:\/\/radin-dev1\.github\.io$/,
  /^https?:\/\/localhost(:\d+)?$/,
];

export function safeReturnTo(value: string | null, fallback: string) {
  if (!value) return fallback;
  try {
    const url = new URL(value);
    return ALLOWED_RETURN_ORIGINS.some((pattern) => pattern.test(url.origin))
      ? url.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

export async function startOAuthState(provider: OAuthProvider, returnTo: string) {
  const database = await db();
  const state = token(16);
  const now = Date.now();
  await database
    .prepare(
      "INSERT INTO oauth_states (state, provider, return_to, created_at, expires_at) VALUES (?,?,?,?,?)",
    )
    .bind(state, provider, returnTo, now, now + 10 * 60_000)
    .run();
  return state;
}

export function oauthAuthorizeUrl(provider: OAuthProvider, redirectUri: string, state: string) {
  const { config, clientId } = providerCredentials(provider);
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function consumeOAuthState(provider: OAuthProvider, state: string) {
  if (!state) return null;
  const database = await db();
  const row = await database
    .prepare("SELECT provider, return_to, expires_at FROM oauth_states WHERE state = ?")
    .bind(state)
    .first<{ provider: string; return_to: string; expires_at: number }>();
  await database.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
  if (!row || row.provider !== provider || row.expires_at < Date.now()) return null;
  return row.return_to;
}

export type OAuthIdentity = {
  providerUserId: string;
  providerUsername: string | null;
  email: string | null;
  displayName: string;
};

function normalizeProfile(
  provider: OAuthProvider,
  profile: Record<string, unknown>,
): OAuthIdentity {
  const str = (value: unknown) => (typeof value === "string" && value ? value : null);
  if (provider === "roblox") {
    const id = str(profile.sub);
    if (!id) throw new Error("Roblox did not return a user id");
    const username = str(profile.preferred_username);
    return {
      providerUserId: id,
      providerUsername: username,
      email: null,
      displayName: username || `Roblox ${id}`,
    };
  }
  if (provider === "discord") {
    const id = str(profile.id);
    if (!id) throw new Error("Discord did not return a user id");
    const username = str(profile.username);
    return {
      providerUserId: id,
      providerUsername: username,
      email: str(profile.email),
      displayName: str(profile.global_name) || username || `Discord ${id}`,
    };
  }
  const id = str(profile.sub);
  if (!id) throw new Error("Google did not return a user id");
  return {
    providerUserId: id,
    providerUsername: str(profile.email),
    email: str(profile.email),
    displayName: str(profile.name) || str(profile.email) || `Google ${id}`,
  };
}

export async function exchangeOAuthCode(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<OAuthIdentity> {
  const { config, clientId, clientSecret } = providerCredentials(provider);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!tokenResponse.ok)
    throw new Error(`${provider} token exchange failed (${tokenResponse.status})`);
  const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenPayload.access_token) throw new Error(`${provider} did not return an access token`);
  const userResponse = await fetch(config.userinfoUrl, {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
  });
  if (!userResponse.ok)
    throw new Error(`${provider} profile request failed (${userResponse.status})`);
  const profile = (await userResponse.json()) as Record<string, unknown>;
  return normalizeProfile(provider, profile);
}

export async function createHandoff(sessionToken: string) {
  const database = await db();
  const code = token(16);
  const now = Date.now();
  await database
    .prepare(
      "INSERT INTO oauth_handoffs (code, session_token, created_at, expires_at) VALUES (?,?,?,?)",
    )
    .bind(code, sessionToken, now, now + 60_000)
    .run();
  return code;
}

export async function consumeHandoff(code: string) {
  if (!code) return null;
  const database = await db();
  const row = await database
    .prepare("SELECT session_token, expires_at FROM oauth_handoffs WHERE code = ?")
    .bind(code)
    .first<{ session_token: string; expires_at: number }>();
  await database.prepare("DELETE FROM oauth_handoffs WHERE code = ?").bind(code).run();
  if (!row || row.expires_at < Date.now()) return null;
  return row.session_token;
}
