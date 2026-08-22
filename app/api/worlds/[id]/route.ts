import type { BuildAction } from "../../../../lib/bridge";
import { db, json } from "../../../../lib/bridge";
import { bearerUser } from "../../../../lib/auth";
import { worldById, worldCard } from "../../../../lib/worlds";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const world = await worldById(id);
  if (!world) return json({ error: "World not found" }, 404);
  const user = await bearerUser(request);
  const isOwner = !!user && user.id === world.owner_user_id;
  if (world.visibility !== "public" && !isOwner) return json({ error: "World not found" }, 404);
  if (!isOwner) {
    const database = await db();
    await database
      .prepare("UPDATE worlds SET play_count = play_count + 1 WHERE id = ?")
      .bind(world.id)
      .run();
    world.play_count += 1;
  }
  let actions: BuildAction[] = [];
  try {
    const parsed = JSON.parse(world.actions_json);
    if (Array.isArray(parsed)) actions = parsed;
  } catch {}
  return json({ world: { ...worldCard(world), actions, isOwner } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await bearerUser(request);
  if (!user) return json({ error: "Sign in first" }, 401);
  const world = await worldById(id);
  if (!world || world.owner_user_id !== user.id)
    return json({ error: "That world is not yours to delete" }, 404);
  const database = await db();
  await database.prepare("DELETE FROM worlds WHERE id = ?").bind(world.id).run();
  return json({ deleted: true });
}
