import {env} from 'cloudflare:workers';
import sites from './sites-data';
import {forecast,snapshot,cached,save} from './weather';
const db=()=> (env as any).DB as D1Database;
export async function refreshBatch(){
 const now=Date.now(),owner=crypto.randomUUID();
 const lock=await db().prepare("INSERT INTO weather_cache(key,value,expires) VALUES('background-lock',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires WHERE weather_cache.expires < ? RETURNING value").bind(JSON.stringify(owner),now+180000,now).first();
 if(!lock)return {busy:true,message:'Another background batch is running.'};
 try{
  const all=await snapshot(),map=new Map(all.map((w:any)=>[w.key,w]));
  const due=sites.filter(s=>s.state!=='DC').filter(s=>{const w=map.get(s.key);return !w||w.sourceAddress!==s.address||(w.nextRetry?w.nextRetry<=now:now-Date.parse(w.lastAttempt||w.updated)>55*60000);}).sort((a,b)=>Date.parse(map.get(a.key)?.lastAttempt||map.get(a.key)?.updated||'1970-01-01')-Date.parse(map.get(b.key)?.lastAttempt||map.get(b.key)?.updated||'1970-01-01'));
  const batch=due.slice(0,40);let index=0,completed=0;
  await Promise.all(Array.from({length:6},async()=>{while(index<batch.length){const s=batch[index++];await forecast(s.key);completed++;}}));
  const status={lastRun:new Date().toISOString(),completed,remainingDue:Math.max(0,due.length-completed),totalSites:sites.filter(s=>s.state!=='DC').length};
  await save('background-status',status,365*86400000);return status;
 }finally{await db().prepare("DELETE FROM weather_cache WHERE key='background-lock' AND value=?").bind(JSON.stringify(owner)).run();}
}
export async function refreshStatus(){const all=await snapshot();return {background:await cached('background-status',false),checked:all.length,totalSites:sites.filter(s=>s.state!=='DC').length,addressReview:all.filter((w:any)=>w.failureKind==='address'||/Address/.test(w.error||'')).map((w:any)=>({key:w.key,...sites.find(s=>s.key===w.key),error:w.error})),temporaryFailures:all.filter((w:any)=>w.status==='error'&&w.failureKind!=='address').length};}
