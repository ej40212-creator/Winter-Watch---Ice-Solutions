import {env} from 'cloudflare:workers';
import {fetchProviderJson} from './forecast-run';
import {cached,consumeLiveBudget,save,json,resolveLocation} from './weather';
import {normalizeAccu,type DailyResult} from './daily';

export const location=resolveLocation;
async function accuJSON(path:string,token:string):Promise<any>{
 try {
  return await fetchProviderJson({
   url:'https://dataservice.accuweather.com'+path,
   allowLive:true,
   headers:{Authorization:'Bearer '+token,Accept:'application/json'},
   consume:()=>consumeLiveBudget(),
  });
 } catch (error) {
  const message=error instanceof Error?error.message:'';
  if (/\(401\)|\(403\)/.test(message)) throw Error('AccuWeather access is not authorized for this forecast.');
  if (/rate limit|429/.test(message)) throw Error('AccuWeather request allowance reached. Try again later.');
  if (/budget/i.test(message)) throw error;
  throw Error('AccuWeather is temporarily unavailable.');
 }
}
export async function dailyForecast(key:string,provider:'nws'|'accuweather',allowLive=false):Promise<DailyResult>{
 const rightsConfirmed=(env as any).ACCUWEATHER_RIGHTS_CONFIRMED==='authorized';
 const token=rightsConfirmed?(env as any).ACCUWEATHER_API_KEY:undefined;
 if(provider==='accuweather'&&!token)return {provider,status:'not_connected',error:'AccuWeather is disabled until an authorized key and display rights are both configured. The external city link is a reference, not a live AccuWeather feed.'};
 const cacheKey=`daily-v1:${provider}:${key}`;
 const known=await cached(cacheKey);if(known)return known;
 if(!allowLive)return {provider,status:'unavailable',error:'Live provider refresh is not authorized, or PROVIDER_BUDGET is unset. No provider call was made.'};
 try{
  const loc=await location(key,true),updated=new Date().toISOString();
  if(provider==='nws'){
   if(!loc.forecast)throw Error('NWS daily forecasts are unavailable at this location.');
   const result=await json(loc.forecast,900000,true),p=result.properties;
   if(!Array.isArray(p?.periods)||!p.periods.length)throw Error('NWS has not supplied daily forecast periods for this location.');
   const issued=p.updateTime||p.generatedAt||null;
   const stale=!issued||!Number.isFinite(Date.parse(issued))||Date.now()-Date.parse(issued)>12*3600000;
   return save(cacheKey,{provider,status:stale?'stale':'ok',updated,issued,...loc,periods:p.periods,url:`https://forecast.weather.gov/MapClick.php?lat=${loc.lat}&lon=${loc.lon}`,error:stale?'Forecast issue time is old or missing. Check the official forecast before acting.':undefined},900000);
  }
  const locationKey=`accu-location:${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`;
  let point=await cached(locationKey);
  if(!point){point=await accuJSON(`/locations/v1/cities/geoposition/search?q=${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`,token);if(!point?.Key)throw Error('AccuWeather could not resolve this location.');await save(locationKey,point,30*86400000);}
  const result=await accuJSON(`/forecasts/v1/daily/7day/${encodeURIComponent(point.Key)}?details=true&metric=false`,token);
  if(!Array.isArray(result.DailyForecasts)||!result.DailyForecasts.length)throw Error('AccuWeather has not supplied daily forecasts.');
  const days=normalizeAccu(result.DailyForecasts),url=result.DailyForecasts[0]?.Link||result.Headline?.Link;
  return save(cacheKey,{provider,status:'ok',updated,issued:null,timezone:loc.timezone,lat:loc.lat,lon:loc.lon,days,url:typeof url==='string'&&/^https?:\/\/([a-z0-9-]+\.)?accuweather\.com\//i.test(url)?url:undefined},900000);
 }catch(e){
  return save(cacheKey,{provider,status:'unavailable',updated:new Date().toISOString(),error:e instanceof Error?e.message:'Daily weather is temporarily unavailable.'},120000);
 }
}
