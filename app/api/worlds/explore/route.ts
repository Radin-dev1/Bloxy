import { json } from "../../../../lib/bridge";
import { publicWorlds, worldCard } from "../../../../lib/worlds";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sort = url.searchParams.get("sort") === "top" ? "top" : "new";
  const limit = Math.max(1, Math.min(48, Number(url.searchParams.get("limit")) || 24));
  const offset = Math.max(0, Math.min(2000, Number(url.searchParams.get("offset")) || 0));
  const rows = await publicWorlds(sort, limit + 1, offset);
  return json({
    worlds: rows.slice(0, limit).map(worldCard),
    hasMore: rows.length > limit,
    sort,
  });
}
