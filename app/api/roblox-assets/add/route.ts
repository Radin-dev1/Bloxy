import { bearer, db, digest, json } from "../../../../lib/bridge";

export async function POST(request: Request) {
  const auth = bearer(request);
  const body = (await request.json()) as { assetId?: number; name?: string };
  const assetId = Number(body.assetId);
  const name = (body.name || `Roblox Asset ${assetId}`).trim().slice(0, 80);
  if (!auth || !Number.isSafeInteger(assetId) || assetId < 1)
    return json({ error: "Missing session or asset." }, 400);
  const database = await db();
  const session = await database
    .prepare(
      "SELECT id,expires_at FROM bridge_sessions WHERE web_token_hash=? AND status IN ('waiting','connected')",
    )
    .bind(await digest(auth))
    .first<{ id: string; expires_at: number }>();
  if (!session || session.expires_at < Date.now())
    return json({ error: "Your Bloxy session expired. Refresh and try again." }, 401);
  const jobId = crypto.randomUUID();
  const actions = [
    {
      id: crypto.randomUUID(),
      type: "import_asset",
      assetId,
      name,
      parent: "Workspace",
      summary: `Import reviewed Creator Store asset ${assetId}; embedded scripts are removed.`,
    },
  ];
  await database
    .prepare(
      "INSERT INTO build_jobs (id,session_id,prompt,actions_json,status,created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      jobId,
      session.id,
      `Add Roblox asset ${assetId}`,
      JSON.stringify(actions),
      "pending",
      Date.now(),
    )
    .run();
  return json({ ok: true, jobId, action: actions[0] });
}
