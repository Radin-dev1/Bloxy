import { env } from "cloudflare:workers";

export type BuildValue = string | number | boolean | number[];
export type BuildAction = { id: string; type: "create_instance" | "create_script"; className?: string; name: string; parent: string; properties?: Record<string, BuildValue>; source?: string; summary: string };

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
  return actions.map((action,index)=>{
    if(action.type!=="create_instance"||!["Part","SpawnLocation"].includes(action.className||""))return action;
    const properties=action.properties||{},size=vector(properties.Size,[10,10,10]).map(value=>Math.max(.5,Math.min(160,Math.abs(value)||1)));
    return {...action,properties:{...properties,Position:vector(properties.Position,[(index%5-2)*14,size[1]/2+1,(Math.floor(index/5)-2)*14]),Size:size,Color:color(properties.Color),Material:typeof properties.Material==="string"?properties.Material:"SmoothPlastic",Shape:typeof properties.Shape==="string"?properties.Shape:"Block",Rotation:vector(properties.Rotation,[0,0,0]),Anchored:true}};
  });
}

export async function generateBlueprint(prompt:string):Promise<BuildAction[]> {
  const key=(env as unknown as {GEMINI_API_KEY?:string}).GEMINI_API_KEY;
  if(!key) throw new Error("GEMINI_API_KEY is not configured");
  const system="You are Bloxy, a Roblox scene architect. Turn the request into a visually coherent Roblox build, not placeholder cubes. Return only a JSON array of at most 36 declarative actions. Allowed types: create_instance and create_script. Allowed instance classes: Folder, Model, Part, SpawnLocation, ScreenGui, Frame, TextLabel, TextButton, UIListLayout, UICorner, UIStroke. Every action requires id, type, name, parent, and summary. For EVERY Part and SpawnLocation, properties are REQUIRED: Position as [x,y,z] deliberate absolute world coordinates; Size as [x,y,z] with values 0.5 to 160; Color as #RRGGBB; Material as Plastic, SmoothPlastic, Concrete, Metal, Wood, Grass, Neon, or Glass; Shape as Block, Ball, Cylinder, or Wedge; Rotation as [x,y,z] degrees; Anchored true. Build recognizable models from multiple purposefully arranged parts. A tree needs trunk and canopy parts; a house needs floor, walls, roof, door and windows; a portal needs pillars, arch and glow; an obstacle course needs distinct platforms along a playable route. Use Model actions as named containers and set child Part parent to that model name, but keep child Position absolute. Never scatter parts randomly. Keep builds centered around the baseplate origin and above y=1. Group related objects spatially and leave walkable paths. Use 8 to 30 geometric parts for a scene when appropriate. Example properties: {\"Position\":[0,6,0],\"Size\":[12,10,8],\"Color\":\"#F25F4B\",\"Material\":\"SmoothPlastic\",\"Shape\":\"Block\",\"Rotation\":[0,15,0],\"Anchored\":true}. create_script requires source and its parent must be ServerScriptService, ReplicatedStorage, StarterPlayer.StarterPlayerScripts, or StarterGui. Use safe server-authoritative Luau. Never use require(assetId), loadstring, HttpGet, external URLs, obfuscation, purchases, or destructive operations.";
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({system_instruction:{parts:[{text:system}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.15,maxOutputTokens:8192,responseMimeType:"application/json"}})});
  if(!response.ok) throw new Error(`Gemini request failed (${response.status})`);
  const payload=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>};
  const raw=payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if(!raw) throw new Error("Gemini returned no blueprint");
  const actions=JSON.parse(raw) as BuildAction[];
  if(!Array.isArray(actions)||actions.length>36) throw new Error("Gemini returned an invalid blueprint");
  return normalize(actions);
}
