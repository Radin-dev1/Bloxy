import { env } from "cloudflare:workers";
import { json } from "../../../../lib/bridge";

type CreatorStoreAsset = {
  id?: number;
  name?: string;
  description?: string;
  creator?: { name?: string; verified?: boolean; userId?: number; groupId?: number };
  voting?: { upVotes?: number; downVotes?: number };
  asset?: { id?: number; name?: string; description?: string; creator?: CreatorStoreAsset["creator"] };
};

function assetList(payload: unknown): CreatorStoreAsset[] {
  if (!payload || typeof payload !== "object") return [];
  const value = payload as Record<string, unknown>;
  for (const key of ["creatorStoreAssets", "assets", "data", "items"]) {
    if (Array.isArray(value[key])) return value[key] as CreatorStoreAsset[];
  }
  return [];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 80);
  if (query.length < 2) return json({ error: "Search needs at least 2 characters." }, 400);
  const upstream = new URL("https://apis.roblox.com/toolbox-service/v2/assets:search");
  upstream.searchParams.set("searchCategoryType", "Model");
  upstream.searchParams.set("query", query);
  upstream.searchParams.set("maxPageSize", "18");
  upstream.searchParams.set("sortCategory", "Relevance");
  upstream.searchParams.set("includeOnlyVerifiedCreators", "true");
  upstream.searchParams.set("searchView", "Full");
  const key = (env as unknown as { ROBLOX_API_KEY?: string }).ROBLOX_API_KEY;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers["x-api-key"] = key;
  const response = await fetch(upstream, { headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403
      ? "Add a ROBLOX_API_KEY secret with creator-store-product:read access."
      : "Roblox Creator Store search is temporarily unavailable.";
    return json({ error: hint, upstreamStatus: response.status }, response.status === 429 ? 429 : 502);
  }
  const assets = assetList(payload).map((item) => {
    const asset = item.asset || item;
    const id = Number(asset.id || item.id);
    const creator = asset.creator || item.creator || {};
    return {
      id,
      name: asset.name || item.name || `Roblox asset ${id}`,
      description: (asset.description || item.description || "").slice(0, 240),
      creator: creator.name || "Verified creator",
      verified: creator.verified !== false,
      thumbnail: "",
      storeUrl: `https://create.roblox.com/store/asset/${id}`,
    };
  }).filter((asset) => Number.isSafeInteger(asset.id) && asset.id > 0);
  if (assets.length) {
    const thumbnails = new URL("https://thumbnails.roblox.com/v1/assets");
    thumbnails.searchParams.set("assetIds", assets.map((asset) => asset.id).join(","));
    thumbnails.searchParams.set("returnPolicy", "PlaceHolder");
    thumbnails.searchParams.set("size", "420x420");
    thumbnails.searchParams.set("format", "Png");
    thumbnails.searchParams.set("isCircular", "false");
    const thumbPayload = await fetch(thumbnails).then((result) => result.json()).catch(() => ({ data: [] })) as { data?: Array<{ targetId?: number; imageUrl?: string }> };
    const imageById = new Map((thumbPayload.data || []).map((image) => [Number(image.targetId), image.imageUrl || ""]));
    assets.forEach((asset) => { asset.thumbnail = imageById.get(asset.id) || ""; });
  }
  return json({ assets, query, source: "Roblox Creator Store" });
}
