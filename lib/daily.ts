export type DayPeriod = {name:string; summary:string; detail:string; temp:number|null; daytime:boolean; pop:number|null; wind:string; start?:string; end?:string};
export type DayCard = {date:string; high:number|null; low:number|null; periods:DayPeriod[]};
export type DailyResult = {provider:'nws'|'accuweather'; status:'ok'|'stale'|'unavailable'|'not_connected'; updated?:string; issued?:string|null; timezone?:string; lat?:number; lon?:number; periods?:any[]; days?:DayCard[]; url?:string; error?:string};
export const temperatureF=(v:any,unit='F'):number|null=>typeof v==='number'&&Number.isFinite(v)?(unit==='C'?v*1.8+32:v):null;
export function localDate(time:number,timezone:string){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(time);
 const get=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${get('year')}-${get('month')}-${get('day')}`;
}
export function windowDates(now:number,hours:number,timezone:string){
 const dates=new Set<string>();
 for(let t=now;t<now+hours*3600000;t+=1800000) dates.add(localDate(t,timezone));
 dates.add(localDate(now+hours*3600000-1,timezone));
 return [...dates].sort();
}
export function dailyCards(data:DailyResult,now:number,hours:number):DayCard[]{
 const timezone=data.timezone||'America/Denver';
 const dates=windowDates(now,hours,timezone);
 if(data.provider==='accuweather')return dates.map(date=>data.days?.find(d=>d.date===date)||{date,high:null,low:null,periods:[]});
 const cards:DayCard[]=dates.map(date=>({date,high:null,low:null,periods:[]}));
 for(const p of data.periods||[]){
  const start=Date.parse(p.startTime),end=Date.parse(p.endTime);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=now||start>=now+hours*3600000)continue;
  // Overnight forecasts belong to the date on which the period starts.
  // A period already underway belongs to today's remaining outlook.
  const card=cards.find(d=>d.date===localDate(Math.max(start,now),timezone));
  if(!card)continue;
  const temp=temperatureF(p.temperature,p.temperatureUnit);
  if(temp!==null){if(p.isDaytime)card.high=card.high===null?temp:Math.max(card.high,temp);else card.low=card.low===null?temp:Math.min(card.low,temp);}
  card.periods.push({name:p.name||'Forecast period',summary:p.shortForecast||'Description unavailable',detail:p.detailedForecast||'',temp,daytime:!!p.isDaytime,pop:typeof p.probabilityOfPrecipitation?.value==='number'?p.probabilityOfPrecipitation.value:null,wind:[p.windDirection,p.windSpeed].filter(Boolean).join(' '),start:p.startTime,end:p.endTime});
 }
 return cards;
}
export function dailySignals(periods:DayPeriod[]){
 const text=periods.map(p=>p.summary+' '+p.detail).join(' '),signals:string[]=[];
 if(/snow|flurr|blizzard/i.test(text))signals.push('Snow mentioned');
 if(/freezing rain|freezing drizzle|sleet|ice pellets|freezing fog/i.test(text))signals.push('Freezing precipitation mentioned');
 return signals;
}
export function normalizeAccu(days:any[]):DayCard[]{
 return days.map(d=>({date:String(d.Date).slice(0,10),high:temperatureF(d.Temperature?.Maximum?.Value,d.Temperature?.Maximum?.Unit),low:temperatureF(d.Temperature?.Minimum?.Value,d.Temperature?.Minimum?.Unit),periods:[['Day',d.Day],['Night',d.Night]].filter(([,p])=>p).map(([name,p]:any)=>({name,summary:p.IconPhrase||'Description unavailable',detail:p.LongPhrase||p.ShortPhrase||'',temp:temperatureF(name==='Day'?d.Temperature?.Maximum?.Value:d.Temperature?.Minimum?.Value,name==='Day'?d.Temperature?.Maximum?.Unit:d.Temperature?.Minimum?.Unit),daytime:name==='Day',pop:typeof p.PrecipitationProbability==='number'?p.PrecipitationProbability:null,wind:typeof p.Wind?.Speed?.Value==='number'?`${p.Wind?.Direction?.English||''} ${p.Wind.Speed.Value} ${p.Wind.Speed.Unit||''}`.trim():''}))}));
}
