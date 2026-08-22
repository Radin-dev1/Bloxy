import { env } from "cloudflare:workers";

export type BuildValue = string | number | boolean | number[];
export type BuildAction = {
  id: string;
  type: "create_instance" | "create_script" | "import_asset";
  className?: string;
  name: string;
  parent: string;
  properties?: Record<string, BuildValue>;
  source?: string;
  assetId?: number;
  summary: string;
};

const schema = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, display_name TEXT NOT NULL, balance_bits INTEGER NOT NULL DEFAULT 25 CHECK(balance_bits >= 0), plan TEXT NOT NULL DEFAULT 'starter', renews_at INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS oauth_identities (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, provider_username TEXT, created_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS oauth_identities_provider_idx ON oauth_identities(provider, provider_user_id)`,
  `CREATE TABLE IF NOT EXISTS user_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id))`,
  `CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, provider TEXT NOT NULL, return_to TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS oauth_handoffs (code TEXT PRIMARY KEY, session_token TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bridge_sessions (id TEXT PRIMARY KEY, pair_code TEXT UNIQUE NOT NULL, web_token_hash TEXT NOT NULL, plugin_token_hash TEXT, status TEXT NOT NULL DEFAULT 'waiting', request_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS build_jobs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, prompt TEXT NOT NULL, actions_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, FOREIGN KEY(session_id) REFERENCES bridge_sessions(id))`,
  `CREATE INDEX IF NOT EXISTS build_jobs_session_idx ON build_jobs(session_id, status, created_at)`,
  `CREATE TABLE IF NOT EXISTS wallets (id TEXT PRIMARY KEY, session_id TEXT UNIQUE NOT NULL, balance_bits INTEGER NOT NULL DEFAULT 25 CHECK(balance_bits >= 0), plan TEXT NOT NULL DEFAULT 'starter', renews_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(session_id) REFERENCES bridge_sessions(id))`,
  `CREATE TABLE IF NOT EXISTS bit_ledger (id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL, amount_bits INTEGER NOT NULL, kind TEXT NOT NULL, action TEXT NOT NULL, reference_id TEXT, created_at INTEGER NOT NULL, FOREIGN KEY(wallet_id) REFERENCES wallets(id))`,
  `CREATE INDEX IF NOT EXISTS bit_ledger_wallet_idx ON bit_ledger(wallet_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT, actions_json TEXT NOT NULL, thumbnail TEXT, visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')), play_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(owner_user_id) REFERENCES users(id))`,
  `CREATE INDEX IF NOT EXISTS worlds_owner_idx ON worlds(owner_user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS worlds_public_idx ON worlds(visibility, created_at)`,
];

export async function db() {
  const database = env.DB as D1Database;
  if (!database) throw new Error("Bridge database is unavailable");
  await database.batch(schema.map((sql) => database.prepare(sql)));
  return database;
}

export function token(bytes = 24) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function code() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const data = crypto.getRandomValues(new Uint8Array(8));
  return `${Array.from(data.slice(0, 4), (b) => chars[b % chars.length]).join("")}-${Array.from(data.slice(4), (b) => chars[b % chars.length]).join("")}`;
}
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function bearer(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function vector(value: BuildValue | undefined, fallback: number[]) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",").map(Number)
      : [];
  return values.length >= 3 && !values.slice(0, 3).some((value) => !Number.isFinite(Number(value)))
    ? values.slice(0, 3).map(Number)
    : fallback;
}
function color(value: BuildValue | undefined) {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  const rgb =
    typeof value === "string"
      ? value.split(",").map(Number)
      : Array.isArray(value)
        ? value.map(Number)
        : [];
  if (rgb.length >= 3 && !rgb.slice(0, 3).some(Number.isNaN))
    return (
      "#" +
      rgb
        .slice(0, 3)
        .map((channel) =>
          Math.max(0, Math.min(255, Math.round(channel)))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
        .toUpperCase()
    );
  return "#A3A3A3";
}
function normalize(actions: BuildAction[]) {
  const namedClasses = new Set([
    "Folder",
    "Model",
    "Part",
    "SpawnLocation",
    "ScreenGui",
    "Frame",
    "ScrollingFrame",
    "ImageLabel",
    "ImageButton",
    "TextLabel",
    "TextButton",
    "TextBox",
    "UIListLayout",
    "UIGridLayout",
    "UIPadding",
    "UICorner",
    "UIStroke",
    "UIGradient",
    "UIAspectRatioConstraint",
  ]);
  const uiNames = new Set<string>();
  for (let pass = 0; pass < 4; pass++)
    actions.forEach((action) => {
      if (
        action.type === "create_instance" &&
        (action.parent === "StarterGui" ||
          uiNames.has(action.parent) ||
          /^(ScreenGui|Frame|ScrollingFrame|ImageLabel|ImageButton|TextLabel|TextButton|TextBox|UI)/.test(
            action.className || "",
          ))
      )
        uiNames.add(action.name);
    });
  return actions.map((action, index) => {
    const raw = action as BuildAction & Record<string, BuildValue | undefined>,
      keys = [
        "Position",
        "Size",
        "Color",
        "Material",
        "Shape",
        "Rotation",
        "Anchored",
        "Transparency",
      ],
      properties = { ...(action.properties || {}) };
    keys.forEach((key) => {
      if (raw[key] !== undefined && properties[key] === undefined)
        properties[key] = raw[key] as BuildValue;
    });
    const geometric = properties.Position !== undefined || properties.Size !== undefined,
      isUI = uiNames.has(action.name);
    let inferredUI: string | undefined;
    if (isUI) {
      if (action.parent === "StarterGui") inferredUI = "ScreenGui";
      else if (/corner/i.test(action.name)) inferredUI = "UICorner";
      else if (/stroke/i.test(action.name)) inferredUI = "UIStroke";
      else if (/grid.*layout|gridlayout/i.test(action.name)) inferredUI = "UIGridLayout";
      else if (/layout/i.test(action.name)) inferredUI = "UIListLayout";
      else if (/padding/i.test(action.name)) inferredUI = "UIPadding";
      else if (/button|^tab|close|equip|buy|play/i.test(action.name)) inferredUI = "TextButton";
      else if (properties.Image || /icon|image/i.test(action.name)) inferredUI = "ImageLabel";
      else if (
        properties.Text !== undefined ||
        /title|label|text|desc|count|price|rarity/i.test(action.name)
      )
        inferredUI = "TextLabel";
      else inferredUI = "Frame";
    }
    const className =
      action.className ||
      inferredUI ||
      (namedClasses.has(action.name)
        ? action.name
        : geometric
          ? "Part"
          : action.name.endsWith("Model")
            ? "Model"
            : undefined);
    if (action.type !== "create_instance" || !["Part", "SpawnLocation"].includes(className || ""))
      return { ...action, ...(className ? { className } : {}) };
    const size = vector(properties.Size, [10, 10, 10]).map((value) =>
      Math.max(0.5, Math.min(160, Math.abs(value) || 1)),
    );
    return {
      ...action,
      className,
      properties: {
        ...properties,
        Position: vector(properties.Position, [
          ((index % 5) - 2) * 14,
          size[1] / 2 + 1,
          (Math.floor(index / 5) - 2) * 14,
        ]),
        Size: size,
        Color: color(properties.Color),
        Material: typeof properties.Material === "string" ? properties.Material : "SmoothPlastic",
        Shape: typeof properties.Shape === "string" ? properties.Shape : "Block",
        Rotation: vector(properties.Rotation, [0, 0, 0]),
        Anchored: true,
      },
    };
  });
}

export type AIProvider = { id?: string; model?: string; apiKey?: string };
const providerEndpoints: Record<string, string> = {
  freeai: "https://api.free.ai/v1/chat/",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
  cerebras: "https://api.cerebras.ai/v1/chat/completions",
  github: "https://models.github.ai/inference/chat/completions",
};
type AskOptions = { temperature?: number; maxOutputTokens?: number };
async function askAI(
  system: string,
  prompt: string,
  provider: AIProvider = {},
  options: AskOptions = {},
) {
  const id = provider.id || "bloxy",
    key = provider.apiKey || (env as unknown as { GEMINI_API_KEY?: string }).GEMINI_API_KEY;
  if (!key)
    throw new Error(
      id === "bloxy"
        ? "GEMINI_API_KEY is not configured"
        : "Add your provider API key in AI Providers",
    );
  if (id === "bloxy" || id === "gemini") {
    const model = (provider.model || "gemini-3.6-flash").replace(/[^a-zA-Z0-9._-]/g, "");
    const request = {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.15,
          maxOutputTokens: options.maxOutputTokens ?? 16384,
          responseMimeType: "application/json",
        },
      }),
    };
    let response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      request,
    );
    if (!response.ok && id === "bloxy" && model !== "gemini-3.1-flash-lite")
      response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
        request,
      );
    if (!response.ok) throw new Error(`AI provider request failed (${response.status})`);
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return payload.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
  const endpoint = providerEndpoints[id];
  if (!endpoint) throw new Error("Unsupported AI provider");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...(id === "openrouter"
        ? { "HTTP-Referer": "https://radin-dev1.github.io/Bloxy/", "X-Title": "Bloxy" }
        : {}),
    },
    body: JSON.stringify({
      model: (provider.model || "").slice(0, 180),
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: options.temperature ?? 0.15,
      max_tokens: Math.min(options.maxOutputTokens ?? 8192, 16384),
    }),
  });
  if (!response.ok) throw new Error(`AI provider request failed (${response.status})`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part.text || "").join("")
      : "";
}
function parseActions(raw: string) {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as BuildAction[] | { actions?: BuildAction[] };
  return Array.isArray(parsed) ? parsed : parsed.actions;
}
function weakDraftReason(actions: BuildAction[], prompt: string) {
  const wantsUI = /\b(ui|gui|hud|menu|inventory|interface)\b/i.test(prompt),
    uiClasses = new Set([
      "ScreenGui",
      "Frame",
      "ScrollingFrame",
      "ImageLabel",
      "ImageButton",
      "TextLabel",
      "TextButton",
      "TextBox",
      "UIListLayout",
      "UIGridLayout",
      "UIPadding",
      "UICorner",
      "UIStroke",
      "UIAspectRatioConstraint",
    ]);
  const uiCount = actions.filter((action) => uiClasses.has(action.className || "")).length,
    partCount = actions.filter((action) =>
      ["Part", "SpawnLocation"].includes(action.className || ""),
    ).length,
    issues: string[] = [];
  if (wantsUI && uiCount < 12)
    issues.push("The UI is too sparse to be a polished, game-ready interface.");
  if (!wantsUI && partCount < 18)
    issues.push(
      "The environment is too sparse and reads like a blockout; use layered construction and environmental detail.",
    );
  if (!actions.some((action) => action.className === "SpawnLocation") && !wantsUI)
    issues.push("The experience has no deliberate player spawn.");
  if (
    /\b(shop|portal|door|button|hatch|quest|round|combat|obby|tycoon|simulator)\b/i.test(prompt) &&
    !actions.some((action) => action.type === "create_script")
  )
    issues.push("Interactive elements have no safe gameplay behavior.");
  return issues.join(" ");
}
type PlacedPart = { name: string; parent: string; min: number[]; max: number[]; color: string };
function placedParts(actions: BuildAction[]): PlacedPart[] {
  return actions
    .filter(
      (action) =>
        action.type === "create_instance" &&
        ["Part", "WedgePart", "SpawnLocation"].includes(action.className || "") &&
        action.properties,
    )
    .map((action) => {
      const position = vector(action.properties!.Position, [0, 0, 0]),
        size = vector(action.properties!.Size, [1, 1, 1]);
      return {
        name: action.name,
        parent: action.parent,
        color: String(action.properties!.Color || ""),
        min: position.map((value, axis) => value - Math.abs(size[axis]) / 2),
        max: position.map((value, axis) => value + Math.abs(size[axis]) / 2),
      };
    });
}
function boxesOverlapXZ(a: PlacedPart, b: PlacedPart) {
  return a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[2] < b.max[2] && a.max[2] > b.min[2];
}
function auditGeometry(actions: BuildAction[], prompt: string) {
  const parts = placedParts(actions),
    issues: string[] = [];
  const collisions: string[] = [];
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i],
        b = parts[j];
      if (a.parent === b.parent && a.parent !== "Workspace") continue;
      const intersection = [0, 1, 2].reduce(
        (volume, axis) =>
          volume *
          Math.max(0, Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis])),
        1,
      );
      if (!intersection) continue;
      const volumeA = [0, 1, 2].reduce((v, axis) => v * (a.max[axis] - a.min[axis]), 1),
        volumeB = [0, 1, 2].reduce((v, axis) => v * (b.max[axis] - b.min[axis]), 1);
      if (intersection / Math.max(1e-6, Math.min(volumeA, volumeB)) > 0.55)
        collisions.push(`${a.name} collides with ${b.name}`);
    }
  if (collisions.length)
    issues.push(
      `Parts from separate structures overlap so heavily they read as accidents: ${collisions.slice(0, 5).join("; ")}. Reposition or resize them so structures interlock deliberately or stand apart.`,
    );
  if (!/\b(float|island|sky|hover|space|cloud)\b/i.test(prompt)) {
    const floaters = parts.filter((part) => {
      if (part.min[1] <= 4) return false;
      const supported = parts.some(
        (other) =>
          other !== part &&
          ((other.parent === part.parent && other.parent !== "Workspace") ||
            (boxesOverlapXZ(part, other) &&
              other.max[1] >= part.min[1] - 3 &&
              other.max[1] <= part.min[1] + 1)),
      );
      return !supported;
    });
    if (floaters.length)
      issues.push(
        `These parts hang in mid-air with nothing beneath them: ${floaters
          .slice(0, 5)
          .map((part) => part.name)
          .join(", ")}. Ground them, support them with visible structure, or lower them.`,
      );
  }
  const colors = new Set(parts.map((part) => part.color.toUpperCase()).filter(Boolean));
  if (colors.size > 8)
    issues.push(
      `The build uses ${colors.size} different colors, which reads as visual noise. Consolidate to a palette of 3-5 related colors plus one accent.`,
    );
  if (parts.length >= 4) {
    const spanX =
        Math.max(...parts.map((part) => part.max[0])) -
        Math.min(...parts.map((part) => part.min[0])),
      spanZ =
        Math.max(...parts.map((part) => part.max[2])) -
        Math.min(...parts.map((part) => part.min[2]));
    if (Math.hypot(spanX, spanZ) > 480)
      issues.push(
        "Structures are scattered across an area too large to feel like one place. Pull the zones within roughly 200 studs of the origin.",
      );
  }
  return issues;
}
function blueprintScore(actions: BuildAction[], prompt: string) {
  const wantsUI = /\b(ui|gui|hud|menu|inventory|interface)\b/i.test(prompt),
    parts = actions.filter((action) =>
      ["Part", "SpawnLocation"].includes(action.className || ""),
    ).length,
    ui = actions.filter((action) =>
      /^(ScreenGui|Frame|ScrollingFrame|ImageLabel|ImageButton|TextLabel|TextButton|TextBox|UI)/.test(
        action.className || "",
      ),
    ).length;
  let score =
    Math.min(parts, 22) * 2 +
    Math.min(ui, 20) +
    (actions.some((action) => action.className === "SpawnLocation") ? 8 : 0) +
    (actions.some((action) => action.type === "create_script") ? 8 : 0) +
    (actions.some((action) => action.type === "import_asset") ? 3 : 0);
  if (wantsUI) score += Math.min(ui, 18) * 2;
  if (weakDraftReason(actions, prompt)) score -= 30;
  score -= auditGeometry(actions, prompt).length * 10;
  score += Math.min(actions.filter((action) => action.className === "Model").length, 6) * 3;
  score += Math.min(actions.filter((action) => action.className === "WedgePart").length, 6) * 2;
  return score;
}

export async function generateBlueprint(
  prompt: string,
  provider: AIProvider = {},
): Promise<BuildAction[]> {
  const system =
    'You are Bloxy, a senior Roblox Studio environment artist and gameplay architect. Turn the request into a playable, visually coherent Roblox build, never placeholder cubes. Internally plan in this order before emitting JSON: player route and scale; named models; primary silhouettes; secondary detail; lighting/material accents; gameplay scripts. Use Roblox conventions: 1 stud is roughly 0.28 meters, doors are about 7 studs high, walkways are at least 6 studs wide, steps are 1–2 studs high, and every playable surface must be reachable. Build with a restrained palette of 3–5 related colors, one accent color, intentional repetition, symmetry where appropriate, and clear focal points. Return only a JSON array of at most 36 declarative actions. Allowed types: create_instance and create_script. Allowed instance classes: Folder, Model, Part, WedgePart, SpawnLocation, ScreenGui, Frame, ScrollingFrame, ImageLabel, ImageButton, TextLabel, TextButton, TextBox, UIListLayout, UIGridLayout, UIPadding, UICorner, UIStroke, UIGradient, UIAspectRatioConstraint. Use ScrollingFrame for lists longer than the visible area, ImageLabel or ImageButton (leave Image empty, style with BackgroundColor3) for icon slots, TextBox for a player input field, UIGridLayout for item or icon grids, UIPadding for internal spacing instead of nested empty frames, UIGradient for a restrained two-color accent, and UIAspectRatioConstraint to keep icons square across screen sizes. Every action requires id, type, name, parent, and summary. For EVERY Part and SpawnLocation, properties are REQUIRED: Position as [x,y,z] deliberate absolute world coordinates; Size as [x,y,z] with values 0.5 to 160; Color as #RRGGBB; Material as Plastic, SmoothPlastic, Concrete, Metal, Wood, Grass, Neon, or Glass; Shape as Block, Ball, Cylinder, or Wedge; Rotation as [x,y,z] degrees; Anchored true. Build recognizable models from multiple purposefully arranged parts. A tree needs trunk and layered canopy; a house needs floor, walls, roof, framed door and windows; a portal needs supports, arch, inset glow and a readable approach; an obstacle course needs distinct platforms along a fair, playable route. Use thin trim parts, frames, supports, rails, signs, and layered silhouettes instead of relying on one large block. Use Model actions as named containers and set child Part parent to that model name, but keep child Position absolute. Never scatter parts randomly or overlap objects accidentally. Keep builds centered around the baseplate origin and above y=1. Group related objects spatially and leave walkable paths. Use 12 to 32 geometric parts for a full scene when appropriate. Example properties: {"Position":[0,6,0],"Size":[12,10,8],"Color":"#D86F5D","Material":"SmoothPlastic","Shape":"Block","Rotation":[0,15,0],"Anchored":true}. create_script requires source and its parent must be ServerScriptService, ReplicatedStorage, StarterPlayer.StarterPlayerScripts, or StarterGui. Use safe server-authoritative Luau. Never use require(assetId), loadstring, HttpGet, external URLs, obfuscation, purchases, or destructive operations.';
  const assetInstruction =
    "You may also request up to 4 useful Roblox Creator Store models with type import_asset, name, parent Workspace, summary, and properties containing SearchQuery (a short generic phrase), Position [x,y,z], Rotation [x,y,z] degrees, and Scale from 0.25 to 4. Use these only for secondary props or complex decorative models that genuinely improve the scene. Place every import deliberately beside paths or inside a named zone; never leave it at the origin. Never use imports for core gameplay geometry, floors, paths, checkpoints, or scripts. Do not invent asset IDs; Bloxy resolves searches against verified creators. Prefer zero imports when custom geometry is better. For a full environment request, emit at least 22 Part or SpawnLocation actions plus any models, UI, imports, and scripts, staying within the 36-action maximum. The finished result should read as one authored Roblox experience: establish a strong focal landmark, a clear player route, 2-4 distinct zones, repeated visual motifs, foreground/midground/background depth, and purposeful empty space. Avoid primitive soup, equal spacing, rainbow palettes, isolated blocks, and detail that does not support the theme. ";
  const uiInstruction =
    "When the user requests UI, match professional Roblox game UI quality. Build a real hierarchy under StarterGui with one ScreenGui and named Frames. Use 8-24 purposeful UI instances, not one flat panel. Every GuiObject needs Position and Size as [xScale,xOffset,yScale,yOffset], AnchorPoint [x,y], BackgroundColor3 #RRGGBB, BackgroundTransparency, ZIndex, and meaningful LayoutOrder where relevant. Text objects also need Text, TextColor3 #RRGGBB, TextSize, Font (Gotham, GothamMedium, GothamBold, or GothamBlack), TextWrapped, and alignment. Add UICorner with CornerRadius [scale,offset], UIStroke with Color #RRGGBB, Thickness and Transparency, UIPadding, and UIListLayout or UIGridLayout where useful. Use scale-based responsive sizing, safe margins, one clear primary action, readable contrast, consistent spacing, restrained shadows and strokes, and a coherent hierarchy. Avoid default gray rectangles, tiny text, excessive gradients, duplicated labels, decorative clutter, and controls without clear purpose. ";
  const limitInstruction =
    "The effective blueprint limit is 128 actions, overriding any earlier lower limit when the requested quality needs more components. Prefer 24-72 purposeful actions and never add filler. ";
  const exemplar =
    ' Study this fragment of a quality build (a lantern dock) and match its construction standard — model containers, layered parts with absolute child positions, a restrained palette, wedges for slopes: [{"id":"d1","type":"create_instance","className":"Model","name":"LanternDock","parent":"Workspace","summary":"Wooden dock with a glowing lantern"},{"id":"d2","type":"create_instance","className":"Part","name":"DockDeck","parent":"LanternDock","properties":{"Position":[0,1.4,20],"Size":[10,0.8,24],"Color":"#8A6A48","Material":"Wood","Shape":"Block","Rotation":[0,0,0],"Anchored":true},"summary":"Plank deck"},{"id":"d3","type":"create_instance","className":"Part","name":"DockPostA","parent":"LanternDock","properties":{"Position":[-4.4,0.6,10],"Size":[1,2.4,1],"Color":"#6E5238","Material":"Wood","Shape":"Block","Rotation":[0,0,0],"Anchored":true},"summary":"Support post"},{"id":"d4","type":"create_instance","className":"Part","name":"LanternPost","parent":"LanternDock","properties":{"Position":[4,4.4,30],"Size":[0.6,6,0.6],"Color":"#3A3F45","Material":"Metal","Shape":"Block","Rotation":[0,0,0],"Anchored":true},"summary":"Lantern pole at the dock end"},{"id":"d5","type":"create_instance","className":"Part","name":"LanternGlow","parent":"LanternDock","properties":{"Position":[4,7.8,30],"Size":[1.2,1.2,1.2],"Color":"#FFC24B","Material":"Neon","Shape":"Ball","Rotation":[0,0,0],"Anchored":true},"summary":"Warm glowing lantern"},{"id":"d6","type":"create_instance","className":"WedgePart","name":"DockRamp","parent":"LanternDock","properties":{"Position":[0,0.9,6],"Size":[10,1.8,4],"Color":"#8A6A48","Material":"Wood","Shape":"Wedge","Rotation":[0,180,0],"Anchored":true},"summary":"Ramp from shore onto the deck"}].';
  const fullSystem = system + assetInstruction + uiInstruction + limitInstruction + exemplar;
  const plannerSystem =
    'You are Bloxy\'s lead level designer. Produce a compact JSON design plan for the requested Roblox build. JSON only, no prose. Shape: {"theme":string,"palette":["#RRGGBB",3-5 related colors],"accent":"#RRGGBB","landmark":string,"route":string describing the player path from spawn,"zones":[2-4 of {"name":string,"purpose":string,"center":[x,z],"radius":number}],"motifs":[2-3 repeated visual elements],"scripts":[{"name":string,"behavior":string}],"partBudget":number 16-90}. Zones must not overlap each other, must all sit within 200 studs of the origin, and the landmark belongs in the most prominent zone. Think like a level designer: sightlines from spawn, scale contrast, a focal point visible on approach, foreground detail near the route, purposeful negative space.';
  let design: unknown = null;
  try {
    const planned = JSON.parse(
      (await askAI(plannerSystem, prompt, provider, { temperature: 0.45, maxOutputTokens: 2048 }))
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
    if (planned && typeof planned === "object" && !Array.isArray(planned)) design = planned;
  } catch {}
  const buildBrief = design
    ? `Follow this approved design plan exactly — its palette, zones, landmark, route, and part budget are decisions, not suggestions:\n${JSON.stringify(design)}\n\nUser request: ${prompt}`
    : prompt;
  const raw = await askAI(fullSystem, buildBrief, provider, { maxOutputTokens: 32768 });
  if (!raw) throw new Error("AI provider returned no blueprint");
  let actions = parseActions(raw);
  if (!Array.isArray(actions)) throw new Error("AI provider returned a non-array blueprint");
  if (actions.length > 128)
    throw new Error(`AI provider returned ${actions.length} actions, above the safe limit of 128`);
  for (let round = 0; round < 3; round++) {
    const normalized = normalize(actions),
      issues = [
        ...auditGeometry(normalized, prompt),
        ...(weakDraftReason(normalized, prompt) ? [weakDraftReason(normalized, prompt)] : []),
      ];
    if (!issues.length) break;
    try {
      const revisedRaw = await askAI(
        fullSystem,
        `Revise this Roblox blueprint. Keep every structure that already works, fix every audit finding below, and return the complete replacement JSON array only.\nUser request: ${JSON.stringify(prompt)}${design ? `\nDesign plan: ${JSON.stringify(design)}` : ""}\nAudit findings (all measured from the actual coordinates — they are facts, not opinions): ${issues.join(" ")}\nCurrent draft: ${JSON.stringify(actions)}`,
        provider,
        { maxOutputTokens: 32768 },
      );
      const revised = parseActions(revisedRaw);
      if (
        Array.isArray(revised) &&
        revised.length <= 128 &&
        blueprintScore(normalize(revised), prompt) >= blueprintScore(normalized, prompt)
      )
        actions = revised;
      else break;
    } catch {
      break;
    }
  }
  return normalize(actions);
}
