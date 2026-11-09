'use client';
import {useEffect,useState} from 'react';
import {recent} from '../lib/observation';
const cache=new Map<string,{data:any,expires:number}>();
let active=0;const waiting:Array<()=>void>=[];
async function readCurrent(key:string,signal:AbortSignal){
 const known=cache.get(key);if(known&&known.expires>Date.now())return known.data;
 await new Promise<void>(resolve=>{const start=()=>{active++;resolve();};if(active<3)start();else waiting.push(start);});
 try{
  signal.throwIfAborted();
  const response=await fetch('/api/current?key='+encodeURIComponent(key),{signal});
  if(!response.ok)throw Error('Observation unavailable');
  const data=await response.json();cache.set(key,{data,expires:Date.now()+300000});return data;
 }finally{active--;waiting.shift()?.();}
}
export default function QueueCurrentTemp({siteKey,now}:{siteKey:string,now:number}){
 const [data,setData]=useState<any>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{let stopped=false;const controller=new AbortController();async function update(){try{const d=await readCurrent(siteKey,controller.signal);if(!stopped)setData(d);}catch{if(!stopped)setData(null);}finally{if(!stopped)setLoading(false);}}void update();const timer=setInterval(update,300000);return()=>{stopped=true;controller.abort();clearInterval(timer);};},[siteKey]);
 const valid=typeof data?.temperature==='number'&&recent(data.observedAt,now);
 const delayed=!valid&&!!data&&data.status!=='unavailable'&&!!data.observedAt;
 const description=valid?`Nearby station ${data.stationName} (${data.station}); observed ${new Date(data.observedAt).toLocaleString('en-US',{timeZone:data.timezone,timeZoneName:'short'})}`:loading?'Loading current observation':delayed?'Latest observation is over 90 minutes old':'Current observation unavailable';
 return <span className="queue-current-temp" title={description}><strong className="temp" aria-label={valid?`${Math.round(data.temperature)} degrees Fahrenheit. ${description}`:description}>{valid?`${Math.round(data.temperature)}°F`:'—'}</strong><small>{valid?'Observed':loading?'Loading…':delayed?'Delayed':'Unavailable'}</small></span>;
}
