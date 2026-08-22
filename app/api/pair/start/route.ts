import { code, db, digest, json, token } from "../../../../lib/bridge";
export async function POST() {
  const database = await db();
  const id = crypto.randomUUID(),
    pairCode = code(),
    webToken = token(),
    now = Date.now();
  await database.batch([
    database
      .prepare(
        "INSERT INTO bridge_sessions (id,pair_code,web_token_hash,status,created_at,expires_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(id, pairCode, await digest(webToken), "waiting", now, now + 3600000),
    database
      .prepare(
        "INSERT INTO wallets (id,session_id,balance_bits,plan,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(crypto.randomUUID(), id, 25, "starter", now, now),
  ]);
  return json({ pairCode, webToken, expiresIn: 3600 });
}
