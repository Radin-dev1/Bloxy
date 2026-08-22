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
async function askAI(system: string, prompt: string, provider: AIProvider = {}) {
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
          temperature: 0.15,
          maxOutputTokens: 16384,
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
      temperature: 0.15,
      max_tokens: 8192,
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
  let raw = await askAI(
    system + assetInstruction + uiInstruction + limitInstruction,
    prompt,
    provider,
  );
  if (!raw) throw new Error("AI provider returned no blueprint");
  let actions = parseActions(raw);
  if (!Array.isArray(actions)) throw new Error("AI provider returned a non-array blueprint");
  if (actions.length > 128)
    throw new Error(`AI provider returned ${actions.length} actions, above the safe limit of 128`);
  let weakness = weakDraftReason(actions, prompt);
  for (let attempt = 0; attempt < 2 && weakness; attempt++) {
    try {
      raw = await askAI(
        system + assetInstruction + uiInstruction + limitInstruction,
        `Rebuild this weak draft. Problem: ${weakness} Preserve the request but return a complete replacement JSON array. User request: ${JSON.stringify(prompt)} Weak draft: ${JSON.stringify(actions)}`,
        provider,
      );
      const repaired = parseActions(raw);
      if (
        Array.isArray(repaired) &&
        repaired.length <= 128 &&
        blueprintScore(repaired, prompt) >= blueprintScore(actions, prompt)
      )
        actions = repaired;
    } catch {}
    weakness = weakDraftReason(actions, prompt);
  }
  const draft = normalize(actions);
  return draft;
}
