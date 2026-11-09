import { env } from 'cloudflare:workers';
import { validAlert } from './risk';
import {recordRefresh} from './telemetry';
import { acceptGridForecast, buildFailureRecord, buildOutlookRecord, outlookCacheKey, planForecastFetches, sharedCacheAllows } from './cache-policy';
import { fetchProviderJson } from './forecast-run';
import { consumeProviderCall } from './provider-budget';
import { providerDecision } from './provider-policy';
import { wrapD1 } from './sql-d1';
import type { SiteRecord } from './sites-data';
const db=()=> (env as any).DB as D1Database;
const BLOCKED='Live provider refresh is not authorized, or PROVIDER_BUDGET is unset. No provider call was made.';
export async function cached(key:string, fresh=true) { const r=await db().prepare('SELECT value,expires FROM weather_cache WHERE key=?').bind(key).first<{value:string,expires:number}>(); return r&&(!fresh||r.expires>Date.now())?JSON.parse(r.value):null; }
export async function save(key:string,value:any,ttl:number) {
 if(!sharedCacheAllows(key,value)) throw new Error('Refusing to store point-specific alerts in a shared grid cache.');
 await db().prepare('INSERT INTO weather_cache(key,value,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires').bind(key,JSON.stringify(value),Date.now()+ttl).run(); return value;
}
async function activatedSite(key:string, sites?:SiteRecord[]){
 if(sites) return sites.find(s=>s.key===key&&s.state.trim().toUpperCase()!=='DC');
 try{
  return await db().prepare("SELECT site_id AS key, source_site_id AS id, region, address, state, classification FROM sites WHERE site_id=? AND operational=1 AND status='active'").bind(key).first<SiteRecord>();
 }catch{return undefined;}
}
const inflight=new Map<string,Promise<any>>();
export async function json(url:string,ttl:number,allowLive=false){
 const known=await cached('url:'+url);if(known)return known;
 if(!allowLive)throw Error(BLOCKED);
 if(inflight.has(url))return inflight.get(url)!;
 const task=(async()=>{
  const body=await fetchProviderJson({url,allowLive:true,consume:()=>takeBudget()});
  return save('url:'+url,body,ttl);
 })();inflight.set(url,task);try{return await task;}finally{inflight.delete(url);}
}
export async function resolveLocation(key:string, allowLive=false, sites?:SiteRecord[]){
 const site=await activatedSite(key,sites);if(!site)throw Error('Unknown US state site');
 const known=await cached('site-location-v3:'+key);if(known?.sourceAddress===site.address)return known;
 if(!allowLive)throw Error(BLOCKED);
 const geocodeAddress=new RegExp('\\b'+site.state+'\\b').test(site.address)?site.address:site.address+', '+site.state;
 const g=await json('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address='+encodeURIComponent(geocodeAddress),180*86400000,true);
 const matches=(g.result?.addressMatches||[]).filter((m:any)=>m.addressComponents?.state===site.state);
 if(matches.length!==1)throw Error(matches.length?'Address match is ambiguous; location needs review.':'Address could not be matched; location needs review.');
 const {x:lon,y:lat}=matches[0].coordinates;
 const point=(await json(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,7*86400000,true)).properties;
 if(!point?.forecastHourly||!point?.timeZone)throw Error('NWS forecast grid is temporarily unavailable.');
 return save('site-location-v3:'+key,{lat,lon,timezone:point.timeZone,forecast:point.forecast,forecastHourly:point.forecastHourly,grid:`${point.gridId}/${point.gridX},${point.gridY}`,sourceAddress:site.address,matchedAddress:matches[0].matchedAddress},180*86400000);
}
export async function nationalAlerts(allowLive=false){const data=await json('https://api.weather.gov/alerts/active?status=actual',300000,allowLive); return {updated:new Date().toISOString(),alerts:(data.features||[]).map((f:any)=>f.properties).filter((p:any)=>validAlert(p,Date.now(),168))};}
async function fetchCached(url:string,ttl:number,key:string,allowLive:boolean){
 const known=await cached(key); if(known)return known;
 if(!allowLive)throw Error(BLOCKED);
 const body=await fetchProviderJson({url,allowLive:true,consume:()=>takeBudget()});
 acceptGridForecast(key,body);
 return save(key,body,ttl);
}
async function takeBudget(){
 const decision=providerDecision(env as {PROVIDER_REFRESH?:string;PROVIDER_BUDGET?:string});
 if(!decision.allowLive||decision.budget==null) return false;
 return consumeProviderCall(wrapD1(db()), Date.now(), decision.budget);
}
export async function readOutlook(key:string){return cached(outlookCacheKey(key),false);}
export async function forecast(key:string, options:{allowLive?:boolean;sites?:SiteRecord[]}={}) {
 const allowLive=options.allowLive===true;
 const site=await activatedSite(key,options.sites); if(!site)throw new Error('Unknown US state site');
 const outlookKey=outlookCacheKey(key);
 const previous=await cached(outlookKey); if(previous&&!previous.nextRetry&&(!previous.sourceAddress||previous.sourceAddress===site.address))return {...previous,execution:previous.execution||'cache'};
 const prior=await cached(outlookKey,false);
 if(!allowLive)return prior?{...prior,execution:'cache'}:{key,status:'unavailable',execution:'not_run',error:BLOCKED,minTemp:null,alerts:[],hours:[],hazards:[],complete:false,priority:0,alertsChecked:false};
 if(prior?.nextRetry>Date.now()&&prior.sourceAddress===site.address)return prior;
 const started=Date.now();
 async function finish(result:any,ttl:number){const saved=await save(outlookKey,result,ttl);await recordRefresh(started,saved);return saved;}
 try{
 const loc=await resolveLocation(key,true,options.sites),{lat,lon}=loc;
 const plan=planForecastFetches(loc.forecastHourly,lat,lon);
 const [weather,alertResult]=await Promise.allSettled([
  fetchCached(loc.forecastHourly,900000,plan.gridKey,true),
  fetchCached(plan.alertUrl,300000,plan.alertKey,true),
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
