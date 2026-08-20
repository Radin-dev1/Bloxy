import {env} from "cloudflare:workers";
import {bearer,db,digest,json} from "../../../../lib/bridge";
import {debit,refund} from "../../../../lib/bits";

type GenerateBody={prompt?:string;imageData?:string;style?:string;assetPack?:boolean};
const tripoBase="https://api.tripo3d.ai/v2/openapi";

async function conceptFromDoodle(imageData:string,prompt:string,style:string){
  const key=(env as unknown as {GEMINI_API_KEY?:string}).GEMINI_API_KEY;
  if(!key)throw new Error("GEMINI_API_KEY is not configured");
  const match=imageData.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if(!match)throw new Error("Doodle image is invalid");
  const instruction=`Turn this drawing into a clean single-object concept image for 3D reconstruction. Preserve the silhouette and idea. ${prompt}. Style: ${style}. Roblox-ready game asset, centered, isolated on a plain light background, full object visible, no text, no watermark.`;
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{role:"user",parts:[{inlineData:{mimeType:match[1],data:match[2]}},{text:instruction}]}],generationConfig:{responseModalities:["IMAGE"]}})});
  if(!response.ok)throw new Error(`Gemini image request failed (${response.status})`);
  const payload=await response.json() as {candidates?:Array<{content?:{parts?:Array<{inlineData?:{mimeType?:string;data?:string}}>} }>};
  const image=payload.candidates?.[0]?.content?.parts?.find(part=>part.inlineData?.data)?.inlineData;
  if(!image?.data)throw new Error("Gemini returned no concept image");
  return {mime:image.mimeType||"image/png",bytes:Uint8Array.from(atob(image.data),char=>char.charCodeAt(0))};
}

async function tripo(path:string,init:RequestInit={}){
  const key=(env as unknown as {TRIPO_API_KEY?:string}).TRIPO_API_KEY;
  if(!key)throw new Error("TRIPO_API_KEY is not configured");
  const response=await fetch(`${tripoBase}${path}`,{...init,headers:{Authorization:`Bearer ${key}`,...init.headers}});
  const payload=await response.json() as {code?:number;message?:string;data?:Record<string,unknown>};
  if(!response.ok||payload.code!==0)throw new Error(payload.message||`Tripo request failed (${response.status})`);
  return payload.data||{};
}

export async function POST(request:Request){
  const auth=bearer(request);if(!auth)return json({error:"Pair Roblox Studio first"},401);
  const body=await request.json() as GenerateBody,prompt=(body.prompt||"").trim().slice(0,1024);
  if(!prompt)return json({error:"Describe the asset you want"},400);
  const database=await db(),session=await database.prepare("SELECT id,expires_at FROM bridge_sessions WHERE web_token_hash=? AND status IN ('waiting','connected')").bind(await digest(auth)).first<{id:string;expires_at:number}>();
  if(!session||session.expires_at<Date.now())return json({error:"Your Bloxy session expired. Refresh and try again."},401);
  const referenceId=crypto.randomUUID(),charge=await debit(auth,"3d_textured",referenceId);
  if(!charge.ok)return json({error:charge.error,balanceBits:charge.balance,requiredBits:charge.required},402);
  try{
    let task:Record<string,unknown>;
    if(body.imageData){
      const concept=await conceptFromDoodle(body.imageData,prompt,body.style||"Roblox low-poly");
      const form=new FormData();form.append("file",new Blob([concept.bytes],{type:concept.mime}),"bloxy-concept.png");
      const uploaded=await tripo("/upload/sts",{method:"POST",body:form});
      const token=String(uploaded.image_token||uploaded.file_token||"");if(!token)throw new Error("Tripo upload returned no image token");
      task=await tripo("/task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"image_to_model",model_version:"P1-20260311",file:{type:"png",file_token:token},face_limit:body.assetPack?8000:5000,texture:true,pbr:false})});
    }else{
      task=await tripo("/task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"text_to_model",model_version:"P1-20260311",prompt:`${prompt}. ${body.style||"Roblox low-poly"}, game-ready asset`,face_limit:body.assetPack?8000:5000,texture:true})});
    }
    return json({taskId:task.task_id,bitsCharged:charge.cost,balanceBits:charge.balance});
  }catch(error){await refund(charge.walletId,"3d_textured",referenceId);return json({error:error instanceof Error?error.message:"3D generation failed"},502);}
}
