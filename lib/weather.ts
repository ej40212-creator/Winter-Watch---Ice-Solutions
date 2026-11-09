import { env } from 'cloudflare:workers';
import sites from './sites-data';
import { summarize, validAlert } from './risk';
import {retryDelay} from './coverage';
import {recordRefresh} from './telemetry';
const db=()=> (env as any).DB as D1Database;
export async function cached(key:string, fresh=true) { const r=await db().prepare('SELECT value,expires FROM weather_cache WHERE key=?').bind(key).first<{value:string,expires:number}>(); return r&&(!fresh||r.expires>Date.now())?JSON.parse(r.value):null; }
export async function save(key:string,value:any,ttl:number) { await db().prepare('INSERT INTO weather_cache(key,value,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires').bind(key,JSON.stringify(value),Date.now()+ttl).run(); return value; }
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
export async function forecast(key:string) {
 const site=sites.find(s=>s.key===key&&s.state!=='DC'); if(!site)throw new Error('Unknown US state site');
 const previous=await cached('outlook-v2:'+key); if(previous&&!previous.nextRetry&&(!previous.sourceAddress||previous.sourceAddress===site.address))return previous;
 const prior=await cached('outlook-v2:'+key,false);if(prior?.nextRetry>Date.now()&&prior.sourceAddress===site.address)return prior;
 const started=Date.now();
 async function finish(result:any,ttl:number){const saved=await save('outlook-v2:'+key,result,ttl);await recordRefresh(started,saved);return saved;}
 try{
 const loc=await resolveLocation(key),{lat,lon}=loc;
 const [weather,alertResult]=await Promise.allSettled([json(loc.forecastHourly,900000),json(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,300000)]);
 const a=alertResult.status==='fulfilled'?(alertResult.value.features||[]).map((f:any)=>f.properties):[];
 const w=weather.status==='fulfilled'?weather.value:null;
 const forecastNow=Date.now();
 const summary=summarize(w?.properties?.periods||[],a,forecastNow,168);
 const issued=w?.properties?.updateTime||w?.properties?.generatedAt||null;
 const oldForecast=!issued||Date.now()-Date.parse(issued)>12*3600000;
 const windows=Object.fromEntries([24,48,72,168].map(h=>{const {hours:discarded,...view}=summarize(w?.properties?.periods||[],a,forecastNow,h);return [h,{...view,complete:view.complete&&alertResult.status==='fulfilled'&&!oldForecast}];}));
 const result={key,...loc,alertsChecked:alertResult.status==='fulfilled',...summary,windows,updated:new Date().toISOString(),issued,complete:summary.complete&&alertResult.status==='fulfilled'&&!oldForecast,status:weather.status==='rejected'?'partial':oldForecast?'stale':'ok',error:weather.status==='rejected'?'Hourly forecast unavailable.':alertResult.status==='rejected'?'NWS alert check unavailable.':oldForecast?'Forecast issue time is old or missing.':null};
 const failed=weather.status==='rejected'||alertResult.status==='rejected',failures=failed?(prior?.failures||0)+1:0;
 return finish({...result,lastAttempt:new Date().toISOString(),failures,nextRetry:failed?Date.now()+retryDelay('temporary',failures):undefined},900000);
 }catch(e){
  const error=e instanceof Error?e.message:'Provider unavailable',failureKind=/Address/.test(error)?'address':'temporary',failures=(prior?.failures||0)+1;
  return finish({key,sourceAddress:site.address,status:'error',error,failureKind,failures,lastAttempt:new Date().toISOString(),nextRetry:Date.now()+retryDelay(failureKind,failures),updated:new Date().toISOString(),priority:0,complete:false,hours:[],alerts:[],hazards:[],onset:null},120000);
 }
}
export async function snapshot(){const r=await db().prepare("SELECT json_remove(value, '$.hours') AS value FROM weather_cache WHERE key LIKE 'outlook-v2:%'").all<{value:string}>();return r.results.map(r=>JSON.parse(r.value));}
