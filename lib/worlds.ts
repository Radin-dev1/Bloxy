import type { BuildAction } from "./bridge";
import { db } from "./bridge";

export const MAX_WORLD_ACTIONS = 128;
export const MAX_ACTIONS_JSON_BYTES = 600_000;
export const MAX_THUMBNAIL_BYTES = 200_000;
export const MAX_TITLE_LENGTH = 80;

export type WorldRow = {
  id: string;
  owner_user_id: string;
  title: string;
  prompt: string | null;
  actions_json: string;
  thumbnail: string | null;
  visibility: "private" | "public";
  play_count: number;
  created_at: number;
  updated_at: number;
  creator_name?: string;
};

export type WorldCard = {
  id: string;
  title: string;
  prompt: string | null;
  thumbnail: string | null;
  visibility: string;
  playCount: number;
  creatorName: string | null;
  createdAt: number;
  updatedAt: number;
};

export function worldCard(row: WorldRow): WorldCard {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    thumbnail: row.thumbnail,
    visibility: row.visibility,
    playCount: row.play_count,
    creatorName: row.creator_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function validateWorldInput(body: {
  title?: unknown;
  actions?: unknown;
  thumbnail?: unknown;
  prompt?: unknown;
}) {
  const title = String(body.title || "")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  if (!title) return { error: "Give the world a title" };
  const actions = body.actions;
  if (!Array.isArray(actions) || !actions.length)
    return { error: "There is no generated build to save yet" };
  if (actions.length > MAX_WORLD_ACTIONS)
    return { error: `Worlds are capped at ${MAX_WORLD_ACTIONS} actions` };
  const actionsJson = JSON.stringify(actions as BuildAction[]);
  if (actionsJson.length > MAX_ACTIONS_JSON_BYTES)
    return { error: "This world is too large to save" };
  let thumbnail: string | null = null;
  if (typeof body.thumbnail === "string" && body.thumbnail) {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.thumbnail))
      return { error: "Thumbnail must be an inline PNG, JPEG, or WebP image" };
    if (body.thumbnail.length > MAX_THUMBNAIL_BYTES) return { error: "Thumbnail is too large" };
    thumbnail = body.thumbnail;
  }
  const prompt =
    typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim().slice(0, 800) : null;
  return { title, actionsJson, thumbnail, prompt };
}

const CARD_COLUMNS =
  "w.id, w.owner_user_id, w.title, w.prompt, w.thumbnail, w.visibility, w.play_count, w.created_at, w.updated_at, u.display_name AS creator_name";

export async function worldById(id: string) {
  const database = await db();
  return database
    .prepare(
      `SELECT ${CARD_COLUMNS}, w.actions_json FROM worlds w JOIN users u ON u.id = w.owner_user_id WHERE w.id = ?`,
    )
    .bind(id)
    .first<WorldRow>();
}

export async function worldsByOwner(ownerUserId: string) {
  const database = await db();
  const { results } = await database
    .prepare(
      `SELECT ${CARD_COLUMNS} FROM worlds w JOIN users u ON u.id = w.owner_user_id WHERE w.owner_user_id = ? ORDER BY w.updated_at DESC LIMIT 60`,
    )
    .bind(ownerUserId)
    .all<WorldRow>();
  return results || [];
}

export async function publicWorlds(sort: "new" | "top", limit: number, offset: number) {
  const database = await db();
  const order = sort === "top" ? "w.play_count DESC, w.created_at DESC" : "w.created_at DESC";
  const { results } = await database
    .prepare(
      `SELECT ${CARD_COLUMNS} FROM worlds w JOIN users u ON u.id = w.owner_user_id WHERE w.visibility = 'public' ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<WorldRow>();
  return results || [];
}
