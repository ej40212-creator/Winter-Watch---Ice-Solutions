'use client';
import {useEffect,useState} from 'react';
import {Radio,Play,Pause,RefreshCw,Plus,Minus,ArrowUpRight} from 'lucide-react';
const service='https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';
type Data={lat:number;lon:number;timezone:string;checked:string;frames:{id:number;time:number}[]};
function RadarLayer({url}:{url:string}){
 const [status,setStatus]=useState('loading');
 return <><image href={url} width="900" height="500" opacity=".8" onLoad={()=>setStatus('ready')} onError={()=>setStatus('error')}/>{status!=='ready'&&<g><rect width="900" height="500" fill="#eaf0f4" opacity=".92"/><text x="450" y="245" textAnchor="middle" fill="#24485c" fontSize="19">{status==='error'?'Radar image unavailable. Try refresh.':'Loading radar frame…'}</text></g>}</>;
}
export default function LiveRadar({siteKey,id}:{siteKey:string;id:string}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[frame,setFrame]=useState(0),[playing,setPlaying]=useState(false),[zoom,setZoom]=useState(7),[clock,setClock]=useState(Date.now());
 useEffect(()=>{let stopped=false;const abort=new AbortController();async function load(){try{const r=await fetch('/api/radar?key='+encodeURIComponent(siteKey),{signal:abort.signal});const d:any=await r.json();if(!r.ok)throw Error(d.error);if(!stopped){setData(d);setFrame(d.frames.length-1);setError('');setClock(Date.now());}}catch(e){if(!stopped)setError(e instanceof Error?e.message:'Radar unavailable.');}}void load();const t=setInterval(load,300000);return()=>{stopped=true;abort.abort();clearInterval(t);};},[siteKey,revision]);
 useEffect(()=>{const t=setInterval(()=>setClock(Date.now()),60000);return()=>clearInterval(t);},[]);
 useEffect(()=>{if(!playing||!data)return;const t=setInterval(()=>setFrame(f=>(f+1)%data.frames.length),1800);return()=>clearInterval(t);},[playing,data]);
 const active=data?.frames[frame],latest=data?.frames.at(-1),old=latest&&clock-latest.time>20*60000;
 const time=(t:number)=>new Date(t).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:data?.timezone});
 let map:React.ReactNode=null;
 if(data&&active){
  const n=2**zoom,world=256*n,cx=(data.lon+180)/360*world,cy=(1-Math.asinh(Math.tan(data.lat*Math.PI/180))/Math.PI)/2*world;
  const left=cx-450,top=cy-250,tiles=[];
  for(let x=Math.floor(left/256);x<=Math.floor((left+900)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+500)/256);y++)if(y>=0&&y<n)tiles.push(<image key={`${zoom}-${x}-${y}`} href={`https://tile.openstreetmap.org/${zoom}/${(x+n)%n}/${y}.png`} x={x*256-left} y={y*256-top} width="256" height="256"/>);
  const scale=40075016.68557849/world,bbox=[left*scale-20037508.342789244,20037508.342789244-(top+500)*scale,(left+900)*scale-20037508.342789244,20037508.342789244-top*scale];
  const url=service+'/exportImage?'+new URLSearchParams({f:'image',bbox:bbox.join(','),bboxSR:'3857',imageSR:'3857',size:'900,500',format:'png32',transparent:'true',mosaicRule:JSON.stringify({mosaicMethod:'esriMosaicLockRaster',lockRasterIds:[active.id],mosaicOperation:'MT_FIRST'})});
  map=<svg viewBox="0 0 900 500" role="img" aria-label={`NOAA radar near site ${id}. Observation ${time(active.time)}.`}>{tiles}<RadarLayer key={url} url={url}/><circle cx="450" cy="250" r="17" fill="#fff" opacity=".8"/><circle cx="450" cy="250" r="7" fill="#163f59" stroke="white" strokeWidth="3"/><rect x="470" y="231" width="125" height="33" rx="7" fill="#153e57"/><text x="482" y="253" fill="white" fontSize="14">SITE #{id}</text></svg>;
 }
 return <section className="panel radar-panel" aria-label="Live radar"><div className="panel-heading"><div><div className="eyebrow">OBSERVE THE APPROACH</div><h2><Radio size={20}/>Live radar</h2><p>NOAA / NWS · Recent observed reflectivity</p></div><span className={'radar-status'+(old||error?' delayed':'')}>{error?'CONNECTION ISSUE':old?'DELAYED DATA':data?'LIVE FEED':'CONNECTING'}</span></div>
 <div className="radar-map">{map||<div className="radar-placeholder">{error||'Locating this site and loading NOAA radar…'}</div>}<div className="radar-zoom"><button aria-label="Zoom radar in" disabled={zoom>=10} onClick={()=>setZoom(z=>z+1)}><Plus size={18}/></button><button aria-label="Zoom radar out" disabled={zoom<=5} onClick={()=>setZoom(z=>z-1)}><Minus size={18}/></button></div><div className="map-attribution">Radar: NOAA / NWS · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></div></div>
 {error&&data&&<p className="notice">{error} Displaying the last loaded frame set.</p>}
 <div className="radar-controls"><button className="secondary" disabled={!data||!!error} aria-label={playing?'Pause radar animation':'Play recent radar animation'} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={16}/>:<Play size={16}/>} {playing?'Pause':'Play'}</button><input aria-label="Radar observation time" type="range" min="0" max={Math.max(0,(data?.frames.length||1)-1)} value={frame} disabled={!data} onChange={e=>{setPlaying(false);setFrame(+e.target.value);}}/><button className="icon-button" aria-label="Refresh radar" onClick={()=>{setPlaying(false);setRevision(v=>v+1);}}><RefreshCw size={17}/></button></div>
 <div className="radar-caption"><b>{active?time(active.time):'Observation time pending'} {data?.timezone}</b><span>{old?'Latest available observation is over 20 minutes old.':'Checks for new frames every 5 minutes.'}</span></div><p className="forecast-footnote">Radar shows precipitation echoes, not pavement ice or a forecast. Weak or missing echoes do not rule out drizzle, snowfall, or coverage gaps. Colors show echo intensity, not rain versus snow.</p><a className="radar-link" href="https://radar.weather.gov/" target="_blank" rel="noreferrer">Full NOAA radar &amp; official color legend <ArrowUpRight size={14}/></a></section>;
}
