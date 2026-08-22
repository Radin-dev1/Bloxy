import { bearer, db, digest, generateBlueprint, json } from "../../../lib/bridge";
import { debit, refund } from "../../../lib/bits";
import { searchCreatorModels } from "../roblox-assets/search/route";

async function resolveCreatorModels(actions: Awaited<ReturnType<typeof generateBlueprint>>) {
  let imports = 0;
  return Promise.all(
    actions.map(async (action) => {
      if (action.type !== "import_asset" || action.assetId || imports >= 4) return action;
      const query =
        typeof action.properties?.SearchQuery === "string"
          ? action.properties.SearchQuery.trim()
          : "";
      if (query.length < 2) return null;
      imports++;
      try {
        const [match] = await searchCreatorModels(query, 3);
        const rawPosition = action.properties?.Position,
          position =
            Array.isArray(rawPosition) && rawPosition.length >= 3
              ? rawPosition.slice(0, 3).map(Number)
              : [18 + imports * 9, 1, 12];
        const rawRotation = action.properties?.Rotation,
          rotation =
            Array.isArray(rawRotation) && rawRotation.length >= 3
              ? rawRotation.slice(0, 3).map(Number)
              : [0, imports * 35, 0];
        const scale = Math.max(0.25, Math.min(4, Number(action.properties?.Scale) || 1));
        return match
          ? {
              ...action,
              assetId: match.id,
              name: match.name,
              properties: {
                ...action.properties,
                Position: position,
                Rotation: rotation,
                Scale: scale,
              },
              summary: `Verified Creator Store model by ${match.creator}: ${match.name}. Embedded scripts will be removed.`,
            }
          : null;
      } catch {
        return null;
      }
    }),
  ).then((items) => items.filter((item): item is NonNullable<typeof item> => Boolean(item)));
}

export async function POST(request: Request) {
  const auth = bearer(request);
  const body = (await request.json()) as {
    prompt?: string;
    provider?: { id?: string; model?: string; apiKey?: string };
  };
  const prompt = (body.prompt || "").trim().slice(0, 3000);
  if (!auth || !prompt) return json({ error: "Missing session or prompt" }, 400);
  const database = await db();
  const session = await database
    .prepare(
      "SELECT id,status,request_count,expires_at FROM bridge_sessions WHERE web_token_hash=? AND status IN ('waiting','connected')",
    )
    .bind(await digest(auth))
    .first<{ id: string; status: string; request_count: number; expires_at: number }>();
  if (!session || session.expires_at < Date.now())
    return json({ error: "Your Bloxy session expired. Refresh and try again." }, 401);
  if (session.request_count >= 40) return json({ error: "Session request limit reached" }, 429);
  const jobId = crypto.randomUUID(),
    charge = await debit(auth, "blueprint", jobId);
  if (!charge.ok)
    return json(
      { error: charge.error, balanceBits: charge.balance, requiredBits: charge.required },
      402,
    );
  try {
    const provider = body.provider
      ? {
          id: String(body.provider.id || "").slice(0, 30),
          model: String(body.provider.model || "").slice(0, 180),
          apiKey: String(body.provider.apiKey || "").slice(0, 500),
        }
      : undefined;
    const actions = await resolveCreatorModels(await generateBlueprint(prompt, provider));
    await database.batch([
      database
        .prepare(
          "INSERT INTO build_jobs (id,session_id,prompt,actions_json,status,created_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          jobId,
          session.id,
          prompt,
          JSON.stringify(actions),
          session.status === "connected" ? "pending" : "draft",
          Date.now(),
        ),
      database
        .prepare("UPDATE bridge_sessions SET request_count=request_count+1 WHERE id=?")
        .bind(session.id),
    ]);
    return json({
      jobId,
      actions,
      bitsCharged: charge.cost,
      balanceBits: charge.balance,
      studioPaired: session.status === "connected",
      requestCount: session.request_count + 1,
      requestLimit: 40,
    });
  } catch (error) {
    await refund(charge.walletId, "blueprint", jobId);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Blueprint generation failed. Your Bit was refunded.",
      },
      502,
    );
  }
}
