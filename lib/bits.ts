import {db,digest} from "./bridge";

export const BITS_PER_DOLLAR=100;
export const PRO_MONTHLY_BITS=2200;
export const ACTION_COSTS={blueprint:1,thumbnail:4,"3d_basic":10,"3d_textured":30,"3d_premium":50} as const;
export type BillableAction=keyof typeof ACTION_COSTS;

export async function walletForToken(rawToken:string){const database=await db();return database.prepare(`SELECT w.id,w.balance_bits,w.plan,w.renews_at FROM wallets w JOIN bridge_sessions s ON s.id=w.session_id WHERE s.web_token_hash=?`).bind(await digest(rawToken)).first<{id:string;balance_bits:number;plan:string;renews_at:number|null}>();}
export async function debit(rawToken:string,action:BillableAction,referenceId:string){const wallet=await walletForToken(rawToken);if(!wallet)return {ok:false as const,error:"Wallet unavailable"};const amount=ACTION_COSTS[action],database=await db();const result=await database.prepare("UPDATE wallets SET balance_bits=balance_bits-?,updated_at=? WHERE id=? AND balance_bits>=?").bind(amount,Date.now(),wallet.id,amount).run();if(!result.meta.changes)return {ok:false as const,error:`This action needs ${amount} Bits`,balance:wallet.balance_bits,required:amount};await database.prepare("INSERT INTO bit_ledger (id,wallet_id,amount_bits,kind,action,reference_id,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),wallet.id,-amount,"usage",action,referenceId,Date.now()).run();return {ok:true as const,walletId:wallet.id,cost:amount,balance:wallet.balance_bits-amount};}
export async function refund(walletId:string,action:BillableAction,referenceId:string){const amount=ACTION_COSTS[action],database=await db();await database.batch([database.prepare("UPDATE wallets SET balance_bits=balance_bits+?,updated_at=? WHERE id=?").bind(amount,Date.now(),walletId),database.prepare("INSERT INTO bit_ledger (id,wallet_id,amount_bits,kind,action,reference_id,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),walletId,amount,"refund",action,referenceId,Date.now())]);}
