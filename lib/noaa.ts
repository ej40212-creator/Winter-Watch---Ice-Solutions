import {json} from './weather';
import {location} from './daily-weather';
export const radarService='https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';
const wssi='https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer';
const query=(base:string,p:Record<string,string>)=>base+'/query?'+new URLSearchParams({f:'json',where:'1=1',outFields:'*',returnGeometry:'false',...p});
function valid(d:any){if(d.error||!Array.isArray(d.features))throw Error('NOAA data is temporarily unavailable.');return d.features;}
export async function radar(key:string){
 const loc=await location(key);
 const result=await json(query(radarService,{geometry:`${loc.lon},${loc.lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'objectid,idp_validtime',orderByFields:'idp_validtime DESC',resultRecordCount:'12'}),240000);
 const frames=valid(result).map((f:any)=>({id:f.attributes.objectid,time:f.attributes.idp_validtime})).filter((f:any)=>Number.isFinite(f.id)&&Number.isFinite(f.time)).reverse();
 if(!frames.length)throw Error('No radar frames are available for this location.');
 return {...loc,frames,checked:new Date().toISOString()};
}
export async function winterGuidance(key:string){
 const loc=await location(key);
 if(loc.lat<24||loc.lat>50||loc.lon< -125||loc.lon> -66)throw Error('WSSI covers the contiguous United States only.');
 const days=await Promise.all([1,2,3].map(async day=>{
  try{
   const base=wssi+'/'+day;
   const [sample,point]=await Promise.all([
    json(query(base,{resultRecordCount:'1'}),600000),
    json(query(base,{geometry:`${loc.lon},${loc.lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects'}),600000)
   ]);
   const a=valid(sample)[0]?.attributes;
   if(!a)throw Error('No current regional product supplied.');
   const impacts=[...new Set(valid(point).map((f:any)=>String(f.attributes.impact)))];
   const m=String(a.issue_time).match(/^(\d{4}-\d{2}-\d{2}) (\d{2})(\d{2})Z$/);
   const issued=m?`${m[1]}T${m[2]}:${m[3]}:00Z`:null;
   return {day,impacts,issued,valid:a.valid_time,status:!issued||Date.now()-Date.parse(issued)>12*3600000?'stale':'ok'};
  }catch(e){return {day,status:'unavailable',error:e instanceof Error?e.message:'Guidance unavailable.'};}
 }));
 return {...loc,days,checked:new Date().toISOString()};
}
