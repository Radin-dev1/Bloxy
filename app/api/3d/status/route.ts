import {env} from "cloudflare:workers";
import {bearer,db,digest,json} from "../../../../lib/bridge";

export async function GET(request:Request){
  const auth=bearer(request),url=new URL(request.url),taskId=(url.searchParams.get("taskId")||"").replace(/[^a-zA-Z0-9-]/g,"");
  if(!auth||!taskId)return json({error:"Missing session or task"},400);
  const session=await (await db()).prepare("SELECT id FROM bridge_sessions WHERE web_token_hash=? AND expires_at>?").bind(await digest(auth),Date.now()).first();
  if(!session)return json({error:"Session expired"},401);
  const key=(env as unknown as {TRIPO_API_KEY?:string}).TRIPO_API_KEY;if(!key)return json({error:"TRIPO_API_KEY is not configured"},500);
  const response=await fetch(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`,{headers:{Authorization:`Bearer ${key}`}}),payload=await response.json();
  return json(payload,response.ok?200:response.status);
}
