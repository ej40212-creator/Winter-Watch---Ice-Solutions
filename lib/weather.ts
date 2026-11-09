import { env } from 'cloudflare:workers';
import sites from './sites-data';
import { validAlert } from './risk';
import {recordRefresh} from './telemetry';
import { buildFailureRecord, buildOutlookRecord, gridCacheKey, outlookCacheKey, pointAlertCacheKey, sharedCacheAllows } from './cache-policy';
const db=()=> (env as any).DB as D1Database;
export async function cached(key:string, fresh=true) { const r=await db().prepare('SELECT value,expires FROM weather_cache WHERE key=?').bind(key).first<{value:string,expires:number}>(); return r&&(!fresh||r.expires>Date.now())?JSON.parse(r.value):null; }
export async function save(key:string,value:any,ttl:number) {
 if(!sharedCacheAllows(key,value)) throw new Error('Refusing to store point-specific alerts in a shared grid cache.');
 await db().prepare('INSERT INTO weather_cache(key,value,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires').bind(key,JSON.stringify(value),Date.now()+ttl).run(); return value;
}
const inflight=new Map<string,Promise<any>>();
export async function json(url:string,ttl:number){
 const known=await cached('url:'+url);if(known)return known;
 if(inflight.has(url))return inflight.get(url)!;
 const task=(async()=>{
  let response:Response|undefined;
  for(let attempt=0;attempt<2;attempt++){
   response=await fetch(url,{headers:{'User-Agent':'IceSolutionsWinterWatch (https://myicesolutions.com)','Accept':'application/geo+json, application/json'},signal:AbortSignal.timeout(16000)});
   if(response.ok)break;
   if(response.status===429||response.status<500)break;
  }
  if(!response?.ok)throw Error(response?.status===429?'Weather provider rate limit; automatic retry scheduled.':'Weather provider temporarily unavailable ('+response?.status+').');
  return save('url:'+url,await response.json(),ttl);
 })();inflight.set(url,task);try{return await task;}finally{inflight.delete(url);}
}
export async function resolveLocation(key:string){
 const site=sites.find(s=>s.key===key&&s.state!=='DC');if(!site)throw Error('Unknown US state site');
 const known=await cached('site-location-v3:'+key);if(known?.sourceAddress===site.address)return known;
 const geocodeAddress=new RegExp('\\b'+site.state+'\\b').test(site.address)?site.address:site.address+', '+site.state;
 const g=await json('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address='+encodeURIComponent(geocodeAddress),180*86400000);
 const matches=(g.result?.addressMatches||[]).filter((m:any)=>m.addressComponents?.state===site.state);
 if(matches.length!==1)throw Error(matches.length?'Address match is ambiguous; location needs review.':'Address could not be matched; location needs review.');
 const {x:lon,y:lat}=matches[0].coordinates;
 const point=(await json(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,7*86400000)).properties;
 if(!point?.forecastHourly||!point?.timeZone)throw Error('NWS forecast grid is temporarily unavailable.');
 return save('site-location-v3:'+key,{lat,lon,timezone:point.timeZone,forecast:point.forecast,forecastHourly:point.forecastHourly,grid:`${point.gridId}/${point.gridX},${point.gridY}`,sourceAddress:site.address,matchedAddress:matches[0].matchedAddress},180*86400000);
}
export async function nationalAlerts(){const data=await json('https://api.weather.gov/alerts/active?status=actual',300000); return {updated:new Date().toISOString(),alerts:(data.features||[]).map((f:any)=>f.properties).filter((p:any)=>validAlert(p,Date.now(),168))};}
async function fetchCached(url:string,ttl:number,key:string){
 const known=await cached(key); if(known)return known;
 let response:Response|undefined;
 for(let attempt=0;attempt<2;attempt++){
  response=await fetch(url,{headers:{'User-Agent':'IceSolutionsWinterWatch (https://myicesolutions.com)','Accept':'application/geo+json, application/json'},signal:AbortSignal.timeout(16000)});
  if(response.ok)break;
  if(response.status===429||response.status<500)break;
 }
 if(!response?.ok)throw Error(response?.status===429?'Weather provider rate limit; automatic retry scheduled.':'Weather provider temporarily unavailable ('+response?.status+').');
 const body=await response.json();
 if(!sharedCacheAllows(key,body))throw Error('Refusing to store point-specific alerts in a shared grid cache.');
 return save(key,body,ttl);
}
export async function forecast(key:string) {
 const site=sites.find(s=>s.key===key&&s.state!=='DC'); if(!site)throw new Error('Unknown US state site');
 const outlookKey=outlookCacheKey(key);
 const previous=await cached(outlookKey); if(previous&&!previous.nextRetry&&(!previous.sourceAddress||previous.sourceAddress===site.address))return previous;
 const prior=await cached(outlookKey,false);if(prior?.nextRetry>Date.now()&&prior.sourceAddress===site.address)return prior;
 const started=Date.now();
 async function finish(result:any,ttl:number){const saved=await save(outlookKey,result,ttl);await recordRefresh(started,saved);return saved;}
 try{
 const loc=await resolveLocation(key),{lat,lon}=loc;
 const alertUrl=`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
 const [weather,alertResult]=await Promise.allSettled([
  fetchCached(loc.forecastHourly,900000,gridCacheKey(loc.forecastHourly)),
  fetchCached(alertUrl,300000,pointAlertCacheKey(lat,lon)),
 ]);
 const pointAlerts=alertResult.status==='fulfilled'?(alertResult.value.features||[]).map((f:any)=>f.properties):[];
 const hourly=weather.status==='fulfilled'?weather.value:null;
 const issued=hourly?.properties?.updateTime||hourly?.properties?.generatedAt||null;
 return finish(buildOutlookRecord({siteKey:key,grid:loc.grid,alertPoint:`${lat.toFixed(4)},${lon.toFixed(4)}`,periods:hourly?.properties?.periods||[],pointAlerts,issued,weatherOk:weather.status==='fulfilled',alertsOk:alertResult.status==='fulfilled',now:Date.now(),sourceAddress:site.address,loc,priorFailures:prior?.failures||0}),900000);
 }catch(e){
  const error=e instanceof Error?e.message:'Provider unavailable';
  return finish(buildFailureRecord({siteKey:key,sourceAddress:site.address,error,priorFailures:prior?.failures||0,now:Date.now()}),120000);
 }
}
export async function snapshot(){const r=await db().prepare("SELECT json_remove(value, '$.hours') AS value FROM weather_cache WHERE key LIKE 'outlook-v3:%'").all<{value:string}>();return r.results.map(r=>JSON.parse(r.value));}
