'use client';
import {useEffect,useId,useMemo,useState} from 'react';
import {ArrowUpRight,CalendarDays,ChevronDown,Cloud,CloudSnow,RefreshCw,Info} from 'lucide-react';
import WinterGuidance from './WinterGuidance';
import {dailyCards,dailySignals,type DailyResult} from '../lib/daily';

type Site={key:string;id:string;address:string;state:string};
type Source='nws'|'noaa'|'accuweather'|'pivotal';
const models=[
 {id:'gfs',name:'GFS',range:'Longer range',type:'Global forecast model',description:'Review storm track, temperature trends and precipitation type for longer-range planning.'},
 {id:'ecmwf_full',name:'ECMWF',range:'Longer range',type:'Global forecast model',description:'Cross-check the upcoming weather pattern against GFS. Compare the same location and forecast valid time.'},
 {id:'nam',name:'NAM',range:'Shorter range',type:'Regional forecast model',description:'Refine storm details as the event approaches. Check that the selected run reaches your planned event time.'},
 {id:'hrrr',name:'HRRR',range:'Near event',type:'Short-range forecast model',description:'Review near-event precipitation type and arrival timing. Use global models for the longer outlook.'},
] as const;

const sources:[Source,string,string][]=[['nws','NWS','Daily forecast'],['noaa','NOAA / WPC','Regional guidance'],['accuweather','AccuWeather','Independent forecast'],['pivotal','Pivotal','Model reference']];
const degrees=(v:number|null)=>v===null?'—':Math.round(v)+'°F';
const city=(s:Site)=>s.address.split(',').slice(-2,-1)[0]?.trim()||s.address;
const stamp=(time:number|string,tz?:string)=>new Date(time).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:tz});
function External({href,children}:{href:string;children:React.ReactNode}){return <a href={href} target="_blank" rel="noreferrer" className="secondary">{children}<ArrowUpRight size={14}/></a>;}

export default function ForecastDesk({sites,preferredKey,hours,now,compact=false,hideSitePicker=false}:{sites:Site[];preferredKey?:string;hours:number;now:number;compact?:boolean;hideSitePicker?:boolean}){
 const [source,setSource]=useState<Source>('nws'),[chosen,setChosen]=useState(preferredKey||''),[search,setSearch]=useState('');
 const [result,setResult]=useState<{key:string;source:Source;data:DailyResult}|null>(null),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
 const uid=useId();
 const [modelId,setModelId]=useState<string>('gfs');
 const model=models.find(m=>m.id===modelId)||models[0];
 const options=useMemo(()=>sites.filter(s=>`${s.id} ${s.address}`.toLowerCase().includes(search.toLowerCase())),[sites,search]);
 const site=sites.find(s=>s.key===chosen)||sites.find(s=>s.key===preferredKey)||sites[0];
 const key=site?.key;
 useEffect(()=>{
  if(!key||!['nws','accuweather'].includes(source)){setLoading(false);return;}
  const controller=new AbortController();let stopped=false;
  async function load(){
   setLoading(true);
   try{
    const response=await fetch(`/api/daily?key=${encodeURIComponent(key!)}&provider=${source}`,{signal:controller.signal});
    const data=await response.json() as DailyResult;
    if(!response.ok)throw Error(data.error||'Daily forecast unavailable.');
    if(!stopped)setResult({key:key!,source,data});
   }catch(e){if(!stopped)setResult({key:key!,source,data:{provider:source as 'nws'|'accuweather',status:'unavailable',error:e instanceof Error?e.message:'Daily forecast unavailable.'}});}
   finally{if(!stopped)setLoading(false);}
  }
  void load();const timer=setInterval(load,900000);
  return()=>{stopped=true;controller.abort();clearInterval(timer);};
 },[key,source,revision]);
 const data=result?.key===key&&result.source===source?result.data:null;
 const available=data&&['ok','stale'].includes(data.status);
 const cards=available?dailyCards(data,now,hours):[];
 const end=now+hours*3600000;
 const endCoverage=data?.periods?.length?Math.max(...data.periods.map(p=>Date.parse(p.endTime)).filter(Number.isFinite)):null;
 const isOld=!!data?.updated&&now-Date.parse(data.updated)>20*60000;
 const riskDays=cards.filter(d=>dailySignals(d.periods).length).length;
 const sourceName=source==='accuweather'?'AccuWeather':'NWS';
 return <section className={'panel forecast-desk'+(compact?' compact':'')} aria-label="Daily planning and weather sources">
  <div className="panel-heading"><div><div className="eyebrow">PLAN THE DAYS AHEAD</div><h2><CalendarDays size={19}/>Daily weather &amp; model references</h2><p>Review each day, then cross-check your sources.</p></div><span className="subtle-tag">{hours===168?'ONE WEEK':`${hours} HOURS`}</span></div>
  {!compact&&!hideSitePicker&&<div className="forecast-location"><label>Find a location<input type="search" placeholder="Store # or city…" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Forecast site<select aria-label="Daily forecast site" value={key||''} onChange={e=>setChosen(e.target.value)}>{site&&!options.some(s=>s.key===key)&&<option value={key}>#{site.id} · {city(site)}, {site.state}</option>}{options.map(s=><option key={s.key} value={s.key}>#{s.id} · {city(s)}, {s.state}</option>)}</select></label>{search&&!options.length&&<small>No sites match this search.</small>}</div>}
  <div className="forecast-tabs" role="tablist" aria-label="Weather sources">{sources.map(([id,title,subtitle])=><button key={id} id={`${uid}-${id}`} role="tab" type="button" aria-selected={source===id} aria-controls={`${uid}-panel`} tabIndex={source===id?0:-1} className={source===id?'active':''} onClick={()=>setSource(id)} onKeyDown={e=>{const index=sources.findIndex(s=>s[0]===source);const next=e.key==='ArrowRight'?(index+1)%sources.length:e.key==='ArrowLeft'?(index+sources.length-1)%sources.length:e.key==='Home'?0:e.key==='End'?sources.length-1:null;if(next!==null){e.preventDefault();setSource(sources[next][0]);document.getElementById(`${uid}-${sources[next][0]}`)?.focus();}}}><b>{title}</b><small>{subtitle}</small></button>)}</div>
  <div className="forecast-body" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-${source}`}>
   {site?<>
    <div className="forecast-context"><div><strong>#{site.id} · {city(site)}, {site.state}</strong><small>{site.address}</small></div><span>{source==='noaa'?'Regional impact feed':source==='pivotal'?'External reference':loading?'Checking source…':data?.status==='not_connected'?'External reference':available?'Daily forecast feed':'Not available'}</span></div>
    {(source==='nws'||source==='accuweather')&&<>
     {loading&&<p className="forecast-message" role="status"><RefreshCw size={16} className="forecast-spinner"/>Loading {sourceName} daily weather for this site…</p>}
     {!loading&&!available&&<div className="forecast-empty"><Cloud size={28}/><h3>{data?.status==='not_connected'?'Cross-check with AccuWeather':'Daily weather is unavailable'}</h3><p>{data?.error||'Daily forecast periods have not loaded yet.'}</p>{source==='accuweather'&&<p>A separate forecast perspective for temperature, snow and precipitation. Direct daily cards become available after the site owner connects an AccuWeather API plan with seven-day forecast access.</p>}<div className="forecast-links">{source==='accuweather'?<External href={`https://www.accuweather.com/en/search-locations?query=${encodeURIComponent(city(site)+', '+site.state)}`}>Find this city on AccuWeather</External>:<External href={`https://forecast.weather.gov/zipcity.php?inputstring=${encodeURIComponent(site.address)}`}>Open official NWS forecast</External>}<button className="secondary" onClick={()=>setRevision(v=>v+1)}><RefreshCw size={14}/>Retry connection</button></div>{source==='accuweather'&&<small>Search for {city(site)}, {site.state} and confirm the location. External forecasts are not included in the priority counts.</small>}</div>}
     {available&&<>
      {(data.status==='stale'||isOld)&&<div className="notice"><Info size={16}/>{data.error||'This daily forecast has not been checked recently. Refresh before acting.'}</div>}
      <div className="daily-summary"><div><b>{riskDays?`${riskDays} ${riskDays===1?'date mentions':'dates mention'} snow or freezing precipitation`:'Review the daily conditions below'}</b><small>{stamp(now,data.timezone)} – {stamp(end,data.timezone)} · {data.timezone}</small></div><button className="icon-button" onClick={()=>setRevision(v=>v+1)} aria-label="Refresh daily forecast"><RefreshCw size={15}/></button></div>
      <div className="daily-grid">{cards.map((day,i)=>{const signals=dailySignals(day.periods);const pops=day.periods.map(p=>p.pop).filter((p):p is number=>p!==null);return <article className={'day-card'+(signals.length?' winter-day':'')} key={day.date}><div className="day-top"><div><small>{new Date(day.date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}</small><h3>{new Date(day.date+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',timeZone:'UTC'})}</h3></div>{signals.length?<CloudSnow size={23}/>:<Cloud size={23}/>}</div>{day.periods.length?<><div className="day-temps"><div><small>DAY HIGH</small><b>{degrees(day.high)}</b></div><div><small>NIGHT LOW</small><b>{degrees(day.low)}</b></div></div><div className="day-conditions">{day.periods.map((p,j)=><p key={j}><b>{p.daytime?'Day':'Night'}</b>{p.summary}</p>)}</div><div className="daily-pop">Precipitation <strong>{pops.length?Math.max(...pops)+'%':'—'}</strong><small>Highest period chance</small></div>{signals.map(s=><span className="daily-signal" key={s}>{s}</span>)}{!signals.length&&<span className="daily-neutral">No snow / freezing precip mentioned</span>}<details className="daily-periods" open={compact||undefined}><summary>Day &amp; night details<ChevronDown size={13}/></summary>{day.periods.map((p,j)=><div key={j}><b>{p.name} {p.temp!==null&&<span>{degrees(p.temp)}</span>}</b><p>{p.summary}</p>{p.detail&&p.detail!==p.summary&&<p className="period-detail">{p.detail}</p>}<small>Precip: {p.pop===null?'not supplied':p.pop+'%'}{p.wind?' · Wind: '+p.wind:''}</small>{p.start&&p.end&&<small>{stamp(p.start,data.timezone)} – {stamp(p.end,data.timezone)}</small>}</div>)}</details></>:<p className="missing-day">No daily period supplied for this date. This is a data gap, not a clear forecast.</p>}{(i===0||i===cards.length-1)&&<small className="day-boundary">Window may include part of this date</small>}</article>;})}</div>
      {endCoverage!==null&&endCoverage<end&&<div className="notice"><Info size={16}/><span>Daily forecast coverage ends {stamp(endCoverage,data.timezone)}, before the selected window ends. Later conditions are not yet supplied.</span></div>}
      <p className="forecast-footnote">{sourceName} · {data.issued?`Issued ${stamp(data.issued,data.timezone)}. `:'Provider issue time not supplied. '}Checked {data.updated?stamp(data.updated,data.timezone):'—'}. {data.timezone}. {source==='nws'?'Nights appear under their starting date; periods already underway appear under today. Highs and lows refer to the available forecast periods.':'Highs and lows are the provider’s daily values.'} Daily periods can extend beyond the rolling {hours}-hour window. A dash means not supplied.</p>
      <div className="forecast-links"><External href={data.url||(source==='nws'?`https://forecast.weather.gov/zipcity.php?inputstring=${encodeURIComponent(site.address)}`:`https://www.accuweather.com/en/search-locations?query=${encodeURIComponent(city(site)+', '+site.state)}`)}>Full {sourceName} forecast</External></div>
     </>}
    </>}
    {source==='noaa'&&<WinterGuidance key={key} siteKey={key!} hours={hours}/>}
    {source==='pivotal'&&<><div className="source-intro"><span className="subtle-tag">EXTERNAL MODEL REFERENCE</span><h3>Choose your forecast model</h3><p>Select a model to review storm timing, track and precipitation type near {city(site)}, {site.state}.</p></div><fieldset className="model-selector"><legend>Forecast model</legend><div className="model-toggle">{models.map(m=><label key={m.id} className={modelId===m.id?'selected':''}><input type="radio" name={`${uid}-model`} value={m.id} checked={modelId===m.id} onChange={()=>setModelId(m.id)} aria-describedby={`${uid}-model-detail`}/><span><b>{m.name}</b><small>{m.range}</small></span></label>)}</div></fieldset><div className="selected-model" id={`${uid}-model-detail`}><div aria-live="polite" aria-atomic="true"><span className="eyebrow">{model.type}</span><h3>{model.name} forecast reference</h3><p>{model.description}</p>{hours>48&&(model.id==='hrrr'||model.id==='nam')&&<div className="notice"><Info size={16}/><span>{model.id==='hrrr'?'HRRR is a near-event check, not a complete 72-hour or weekly forecast.':'NAM supports shorter-range checks, not a full week.'} Use GFS or ECMWF for longer-range planning.</span></div>}</div><External href={`https://www.pivotalweather.com/model.php?m=${model.id}`}>Open {model.name} charts on Pivotal</External><small className="model-reference-status">Reference link · model values are not imported into Winter Watch</small></div><p className="forecast-footnote">Your selection changes the model reference above. Charts open on Pivotal, where you choose the region, run and forecast valid time. Access depends on Pivotal’s terms and your account. The dashboard’s daily forecast and priority counts remain NWS-based.</p><div className="forecast-links"><External href="https://home.pivotalweather.com/subscriptions">Pivotal access options</External><External href="https://home.pivotalweather.com/terms">Pivotal usage terms</External></div></>}

   </>:<p className="forecast-message">Select a state or adjust your filters to choose a supplied site.</p>}
   <div className="forecast-disclosure"><Info size={15}/><span>Priorities remain based on NWS warnings, advisories and hourly risk screening. Daily forecasts and external models support planning; precipitation chance is not the chance of pavement icing.</span></div>
  </div>
 </section>;
}
