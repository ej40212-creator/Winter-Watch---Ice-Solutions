import {json,resolveLocation} from './weather';
import {observation,recent} from './observation';
export async function currentWeather(key:string){
 const loc=await resolveLocation(key);
 const point=await json(`https://api.weather.gov/points/${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`,7*86400000);
 const url=point.properties?.observationStations;
 if(!url?.startsWith('https://api.weather.gov/'))throw Error('Observation stations unavailable.');
 const stations=await json(url,86400000);
 const candidates=(stations.features||[]).slice(0,3);
 const results=await Promise.allSettled(candidates.map(async(s:any)=>{
  const id=s.properties.stationIdentifier;if(!id)throw Error('Missing station identifier');
  const response=await json(`https://api.weather.gov/stations/${encodeURIComponent(id)}/observations/latest`,300000);
  const obs=observation(response.properties||{});
  if(obs.temperature===null||!Number.isFinite(Date.parse(obs.observedAt))||Date.parse(obs.observedAt)>Date.now()+300000)throw Error('Station observation incomplete');
  return {...obs,station:id,stationName:s.properties.name||id,source:`https://api.weather.gov/stations/${encodeURIComponent(id)}/observations/latest`};
 }));
 const usable=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
 const chosen=usable.find(r=>recent(r.observedAt))||usable.sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
 if(!chosen)throw Error('Current observations are temporarily unavailable from nearby stations.');
 return {...chosen,timezone:loc.timezone,status:recent(chosen.observedAt)?'ok':'stale',checkedAt:new Date().toISOString()};
}
