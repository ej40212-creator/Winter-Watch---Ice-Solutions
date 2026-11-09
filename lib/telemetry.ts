import {env} from 'cloudflare:workers';
const db=()=> (env as any).DB as D1Database;
export async function recordRefresh(started:number,result:any){
 // Instrumentation must never interrupt a weather response. Store only aggregate operational counts.
 try{
  const now=Date.now(),bucket=Math.floor(now/300000)*300000;
  const duration=Math.max(0,now-started),failed=result.status==='error'||result.status==='partial'||!!result.error?1:0;
  const value={at:bucket,count:1,failed,durationMs:duration};
  await db().prepare(`INSERT INTO weather_cache(key,value,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=json_object('at',?,'count',json_extract(weather_cache.value,'$.count')+1,'failed',json_extract(weather_cache.value,'$.failed')+?,'durationMs',json_extract(weather_cache.value,'$.durationMs')+?)`).bind('perf:'+bucket,JSON.stringify(value),bucket+7*86400000,bucket,failed,duration).run();
  await db().prepare("DELETE FROM weather_cache WHERE key LIKE 'perf:%' AND expires < ?").bind(now).run();
 }catch{/* Telemetry unavailable; forecast remains usable. */}
}
export async function performanceHistory(){const now=Date.now();const r=await db().prepare("SELECT value FROM weather_cache WHERE key LIKE 'perf:%' AND expires > ? ORDER BY key").bind(now).all<{value:string}>();return {checkedAt:new Date(now).toISOString(),buckets:r.results.map(row=>JSON.parse(row.value))};}
