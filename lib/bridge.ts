import { env } from "cloudflare:workers";

export type BuildValue = string | number | boolean | number[];
export type BuildAction = { id: string; type: "create_instance" | "create_script" | "import_asset"; className?: string; name: string; parent: string; properties?: Record<string, BuildValue>; source?: string; assetId?: number; summary: string };

const schema = [
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

export function token(bytes = 24) { const data = crypto.getRandomValues(new Uint8Array(bytes)); return Array.from(data, b => b.toString(16).padStart(2,"0")).join(""); }
export function code() { const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const data=crypto.getRandomValues(new Uint8Array(8)); return `${Array.from(data.slice(0,4),b=>chars[b%chars.length]).join("")}-${Array.from(data.slice(4),b=>chars[b%chars.length]).join("")}`; }
export async function digest(value:string){ const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join(""); }
export function bearer(request:Request){ const value=request.headers.get("authorization")||""; return value.startsWith("Bearer ")?value.slice(7):""; }
export function json(data:unknown,status=200){ return Response.json(data,{status,headers:{"Cache-Control":"no-store"}}); }

function vector(value:BuildValue|undefined,fallback:number[]){
  const values=Array.isArray(value)?value:typeof value==="string"?value.split(",").map(Number):[];
  return values.length>=3&&!values.slice(0,3).some(value=>!Number.isFinite(Number(value)))?values.slice(0,3).map(Number):fallback;
}
function color(value:BuildValue|undefined){
  if(typeof value==="string"&&/^#[0-9a-f]{6}$/i.test(value))return value.toUpperCase();
  const rgb=typeof value==="string"?value.split(",").map(Number):Array.isArray(value)?value.map(Number):[];
  if(rgb.length>=3&&!rgb.slice(0,3).some(Number.isNaN))return "#"+rgb.slice(0,3).map(channel=>Math.max(0,Math.min(255,Math.round(channel))).toString(16).padStart(2,"0")).join("").toUpperCase();
  return "#A3A3A3";
}
function normalize(actions:BuildAction[]){
  const namedClasses=new Set(["Folder","Model","Part","SpawnLocation","ScreenGui","Frame","ScrollingFrame","ImageLabel","ImageButton","TextLabel","TextButton","TextBox","UIListLayout","UIGridLayout","UIPadding","UICorner","UIStroke","UIGradient","UIAspectRatioConstraint"]);
  return actions.map((action,index)=>{
    const raw=action as BuildAction&Record<string,BuildValue|undefined>,keys=["Position","Size","Color","Material","Shape","Rotation","Anchored","Transparency"],properties={...(action.properties||{})};
    keys.forEach(key=>{if(raw[key]!==undefined&&properties[key]===undefined)properties[key]=raw[key] as BuildValue});
    const geometric=properties.Position!==undefined||properties.Size!==undefined,className=action.className||(namedClasses.has(action.name)?action.name:geometric?"Part":action.name.endsWith("Model")?"Model":undefined);
    if(action.type!=="create_instance"||!["Part","SpawnLocation"].includes(className||""))return {...action,...(className?{className}:{})};
    const size=vector(properties.Size,[10,10,10]).map(value=>Math.max(.5,Math.min(160,Math.abs(value)||1)));
    return {...action,className,properties:{...properties,Position:vector(properties.Position,[(index%5-2)*14,size[1]/2+1,(Math.floor(index/5)-2)*14]),Size:size,Color:color(properties.Color),Material:typeof properties.Material==="string"?properties.Material:"SmoothPlastic",Shape:typeof properties.Shape==="string"?properties.Shape:"Block",Rotation:vector(properties.Rotation,[0,0,0]),Anchored:true}};
  });
}

export type AIProvider = {id?:string; model?:string; apiKey?:string};
const providerEndpoints:Record<string,string>={freeai:"https://api.free.ai/v1/chat/",openrouter:"https://openrouter.ai/api/v1/chat/completions",groq:"https://api.groq.com/openai/v1/chat/completions",nvidia:"https://integrate.api.nvidia.com/v1/chat/completions",cerebras:"https://api.cerebras.ai/v1/chat/completions",github:"https://models.github.ai/inference/chat/completions"};
async function askAI(system:string,prompt:string,provider:AIProvider={}){
  const id=provider.id||"bloxy",key=provider.apiKey||(env as unknown as {GEMINI_API_KEY?:string}).GEMINI_API_KEY;
  if(!key)throw new Error(id==="bloxy"?"GEMINI_API_KEY is not configured":"Add your provider API key in AI Providers");
  if(id==="bloxy"||id==="gemini"){
    const model=(provider.model||"gemini-3.1-flash-lite").replace(/[^a-zA-Z0-9._-]/g,"");
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({system_instruction:{parts:[{text:system}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.15,maxOutputTokens:8192,responseMimeType:"application/json"}})});
    if(!response.ok)throw new Error(`AI provider request failed (${response.status})`);
    const payload=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>};
    return payload.candidates?.[0]?.content?.parts?.[0]?.text||"";
  }
  const endpoint=providerEndpoints[id];if(!endpoint)throw new Error("Unsupported AI provider");
  const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`,...(id==="openrouter"?{"HTTP-Referer":"https://radin-dev1.github.io/Bloxy/","X-Title":"Bloxy"}:{})},body:JSON.stringify({model:(provider.model||"").slice(0,180),messages:[{role:"system",content:system},{role:"user",content:prompt}],temperature:.15,max_tokens:8192})});
  if(!response.ok)throw new Error(`AI provider request failed (${response.status})`);
  const payload=await response.json() as {choices?:Array<{message?:{content?:string|Array<{text?:string}>}}>};const content=payload.choices?.[0]?.message?.content;
  return typeof content==="string"?content:Array.isArray(content)?content.map(part=>part.text||"").join(""):"";
}
function parseActions(raw:string){const cleaned=raw.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");const parsed=JSON.parse(cleaned) as BuildAction[]|{actions?:BuildAction[]};return Array.isArray(parsed)?parsed:parsed.actions;}
function weakDraftReason(actions:BuildAction[],prompt:string){
  const wantsUI=/\b(ui|gui|hud|menu|inventory|shop|settings|interface)\b/i.test(prompt),uiClasses=new Set(["ScreenGui","Frame","ScrollingFrame","ImageLabel","ImageButton","TextLabel","TextButton","TextBox","UIListLayout","UIGridLayout","UIPadding","UICorner","UIStroke","UIAspectRatioConstraint"]);
  const uiCount=actions.filter(action=>uiClasses.has(action.className||"")).length,partCount=actions.filter(action=>["Part","SpawnLocation"].includes(action.className||"")).length;
  if(wantsUI&&uiCount<8)return "The UI is too sparse to be a polished, game-ready interface.";
  if(!wantsUI&&partCount<10)return "The environment is too sparse and reads like a blockout.";
  if(!actions.some(action=>action.className==="SpawnLocation")&&!wantsUI)return "The experience has no deliberate player spawn.";
  return "";
}

export async function generateBlueprint(prompt:string,provider:AIProvider={}):Promise<BuildAction[]> {
  const system="You are Bloxy, a senior Roblox Studio environment artist and gameplay architect. Turn the request into a playable, visually coherent Roblox build, never placeholder cubes. Internally plan in this order before emitting JSON: player route and scale; named models; primary silhouettes; secondary detail; lighting/material accents; gameplay scripts. Use Roblox conventions: 1 stud is roughly 0.28 meters, doors are about 7 studs high, walkways are at least 6 studs wide, steps are 1–2 studs high, and every playable surface must be reachable. Build with a restrained palette of 3–5 related colors, one accent color, intentional repetition, symmetry where appropriate, and clear focal points. Return only a JSON array of at most 36 declarative actions. Allowed types: create_instance and create_script. Allowed instance classes: Folder, Model, Part, SpawnLocation, ScreenGui, Frame, TextLabel, TextButton, UIListLayout, UICorner, UIStroke. Every action requires id, type, name, parent, and summary. For EVERY Part and SpawnLocation, properties are REQUIRED: Position as [x,y,z] deliberate absolute world coordinates; Size as [x,y,z] with values 0.5 to 160; Color as #RRGGBB; Material as Plastic, SmoothPlastic, Concrete, Metal, Wood, Grass, Neon, or Glass; Shape as Block, Ball, Cylinder, or Wedge; Rotation as [x,y,z] degrees; Anchored true. Build recognizable models from multiple purposefully arranged parts. A tree needs trunk and layered canopy; a house needs floor, walls, roof, framed door and windows; a portal needs supports, arch, inset glow and a readable approach; an obstacle course needs distinct platforms along a fair, playable route. Use thin trim parts, frames, supports, rails, signs, and layered silhouettes instead of relying on one large block. Use Model actions as named containers and set child Part parent to that model name, but keep child Position absolute. Never scatter parts randomly or overlap objects accidentally. Keep builds centered around the baseplate origin and above y=1. Group related objects spatially and leave walkable paths. Use 12 to 32 geometric parts for a full scene when appropriate. Example properties: {\"Position\":[0,6,0],\"Size\":[12,10,8],\"Color\":\"#D86F5D\",\"Material\":\"SmoothPlastic\",\"Shape\":\"Block\",\"Rotation\":[0,15,0],\"Anchored\":true}. create_script requires source and its parent must be ServerScriptService, ReplicatedStorage, StarterPlayer.StarterPlayerScripts, or StarterGui. Use safe server-authoritative Luau. Never use require(assetId), loadstring, HttpGet, external URLs, obfuscation, purchases, or destructive operations.";
  const assetInstruction="You may also request up to 4 useful Roblox Creator Store models with type import_asset, name, parent Workspace, summary, and properties containing SearchQuery (a short generic phrase), Position [x,y,z], Rotation [x,y,z] degrees, and Scale from 0.25 to 4. Use these only for secondary props or complex decorative models that genuinely improve the scene. Place every import deliberately beside paths or inside a named zone; never leave it at the origin. Never use imports for core gameplay geometry, floors, paths, checkpoints, or scripts. Do not invent asset IDs; Bloxy resolves searches against verified creators. Prefer zero imports when custom geometry is better. The finished result should read as one authored Roblox experience: establish a strong focal landmark, a clear player route, 2-4 distinct zones, repeated visual motifs, foreground/midground/background depth, and purposeful empty space. Avoid primitive soup, equal spacing, rainbow palettes, isolated blocks, and detail that does not support the theme. ";
  const uiInstruction="When the user requests UI, match professional Roblox game UI quality. Build a real hierarchy under StarterGui with one ScreenGui and named Frames. Use 8-24 purposeful UI instances, not one flat panel. Every GuiObject needs Position and Size as [xScale,xOffset,yScale,yOffset], AnchorPoint [x,y], BackgroundColor3 #RRGGBB, BackgroundTransparency, ZIndex, and meaningful LayoutOrder where relevant. Text objects also need Text, TextColor3 #RRGGBB, TextSize, Font (Gotham, GothamMedium, GothamBold, or GothamBlack), TextWrapped, and alignment. Add UICorner with CornerRadius [scale,offset], UIStroke with Color #RRGGBB, Thickness and Transparency, UIPadding, and UIListLayout or UIGridLayout where useful. Use scale-based responsive sizing, safe margins, one clear primary action, readable contrast, consistent spacing, restrained shadows and strokes, and a coherent hierarchy. Avoid default gray rectangles, tiny text, excessive gradients, duplicated labels, decorative clutter, and controls without clear purpose. ";
  let raw=await askAI(system+assetInstruction+uiInstruction,prompt,provider);
  if(!raw) throw new Error("AI provider returned no blueprint");
  let actions=parseActions(raw);
  if(!Array.isArray(actions)||actions.length>36) throw new Error("AI provider returned an invalid blueprint");
  const weakness=weakDraftReason(actions,prompt);
  if(weakness){
    try{
      raw=await askAI(system+assetInstruction+uiInstruction,`Rebuild this weak draft. Problem: ${weakness} Preserve the request but return a complete replacement JSON array. User request: ${JSON.stringify(prompt)} Weak draft: ${JSON.stringify(actions)}`,provider);
      const repaired=parseActions(raw);if(Array.isArray(repaired)&&repaired.length<=36)actions=repaired;
    }catch{}
  }
  const draft=normalize(actions);
  const critique=`You are Bloxy's senior Roblox build reviewer. Improve this draft before it reaches the viewport. Return only a replacement JSON array of at most 36 actions using the exact same schema. Preserve the user's intent and useful scripts. Check every item against this rubric: recognizable silhouette; correct Roblox scale; no accidental overlap; all parts above the baseplate; walkable routes at least 6 studs wide; reachable platforms; structural supports; coherent 3–5 color palette; deliberate material choices; layered detail rather than plain boxes; useful names and parent models. Fix weak geometry, sparse scenes, random placement, impossible jumps, missing frames/supports/details, and colors that fight each other. Do not add unsafe code or unsupported classes. User request: ${JSON.stringify(prompt)}. Draft: ${JSON.stringify(draft)}`;
  try{
    const qualityGate="Act like a shipping-quality Roblox art director. Before returning JSON, silently score the draft from 1-10 for silhouette, composition, route clarity, scale, theme consistency, asset usefulness, and gameplay readability. Rewrite anything scoring below 8. Imported models must have deliberate Position, Rotation and Scale and must not replace playable geometry. Remove redundant parts, placeholder blocks, irrelevant assets, unsafe scripts, and accidental intersections. Ensure the first 10 seconds from SpawnLocation reveal a focal landmark and an obvious next destination. ";
    const reviewed=parseActions(await askAI("Return only valid JSON.",qualityGate+critique,provider));
    return Array.isArray(reviewed)&&reviewed.length<=36?normalize(reviewed):draft;
  }catch{return draft;}
}
