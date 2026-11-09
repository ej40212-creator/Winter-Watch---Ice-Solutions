export const winterEvents = /Winter Storm|Winter Weather|Ice Storm|Blizzard|Snow Squall|Lake Effect Snow|Freezing Rain|Freezing Drizzle|Frost Advisory|Freeze Warning|Freeze Watch|Cold Weather|Extreme Cold/i;
export function alertRank(event: string) {
 if (/Ice Storm Warning|Blizzard Warning|Winter Storm Warning|Snow Squall Warning|Lake Effect Snow Warning/i.test(event)) return 4;
 if (/Winter Weather Advisory|Freezing Rain Advisory|Freezing Drizzle Advisory/i.test(event)) return 3;
 if (/Winter Storm Watch|Blizzard Watch|Lake Effect Snow Watch/i.test(event)) return 2;
 return winterEvents.test(event) ? 1 : 0;
}
export function validAlert(p: any, now = Date.now(), horizon=48) {
 const end=Date.parse(p.ends || p.expires), start=Date.parse(p.onset || p.effective);
 return p.status === 'Actual' && p.messageType !== 'Cancel' && winterEvents.test(p.event) && end > now && start < now+horizon*3600000;
}
export function summarize(periods: any[], alerts: any[], now=Date.now(), horizon=48) {
 const end=now+horizon*3600000;
 const hours = periods.filter(p=>Date.parse(p.endTime)>now && Date.parse(p.startTime)<end).map((p,i,all)=>{
  const temp=typeof p.temperature==='number' ? (p.temperatureUnit==='C'?p.temperature*1.8+32:p.temperature):null;
  const dew=typeof p.dewpoint?.value==='number' ? p.dewpoint.value*1.8+32:null;
  const rh=typeof p.relativeHumidity?.value==='number'?p.relativeHumidity.value:null;
  const pop=typeof p.probabilityOfPrecipitation?.value==='number'?p.probabilityOfPrecipitation.value:null;
  const text=String(p.shortForecast||''); const hazards:string[]=[];
  if(/snow|flurr|blizzard/i.test(text)) hazards.push('Snow');
  if(/freezing rain|freezing drizzle|ice pellets|sleet|freezing fog/i.test(text)) hazards.push('Freezing precipitation');
  const priorWet=all.slice(Math.max(0,i-6),i+1).some(q=>/rain|drizzle|snow|sleet/i.test(q.shortForecast||'') && (q.probabilityOfPrecipitation?.value??0)>=30);
  if(temp!==null && temp<=32 && priorWet && !hazards.includes('Freezing precipitation')) hazards.push('Refreeze risk');
  const wind=Number(String(p.windSpeed||'').match(/\d+/)?.[0]??99);
  if(temp!==null && ((temp<=32 && ((dew!==null&&temp-dew<=2)||(rh!==null&&rh>=90))) || (temp<=36&&!p.isDaytime&&wind<=7&&/clear|mostly clear/i.test(text)&&(rh??0)>=80))) hazards.push('Frost risk');
  return {time:p.startTime,end:p.endTime,temp,dew,rh,pop,summary:text,wind:p.windSpeed,hazards};
 });
 const active=alerts.filter(a=>validAlert(a,now,horizon)).sort((a,b)=>alertRank(b.event)-alertRank(a.event));
 let priority=Math.max(0,...active.map(a=>alertRank(a.event)));
 if(hours.some(h=>h.hazards.includes('Freezing precipitation'))) priority=Math.max(priority,3);
 if(hours.some(h=>h.hazards.includes('Snow')||h.hazards.includes('Refreeze risk'))) priority=Math.max(priority,2);
 if(hours.some(h=>h.hazards.includes('Frost risk'))) priority=Math.max(priority,1);
 const triggers=hours.filter(h=>h.hazards.length);
 const firstTimes=[...triggers.map(h=>Math.max(now,Date.parse(h.time))),...active.map(a=>Math.max(now,Date.parse(a.onset||a.effective)))].filter(Number.isFinite);
 const complete=hours.length>=horizon-1 && Date.parse(hours.at(-1)?.end||'')>=end-60000 && hours.every(h=>h.temp!==null&&h.dew!==null&&h.rh!==null&&h.pop!==null&&h.summary);
 return {hours,alerts:active,priority,complete,coverageEnd:hours.at(-1)?.end||null,missingFields:[...new Set(hours.flatMap(h=>[h.temp===null?'temperature':null,h.dew===null?'dew point':null,h.rh===null?'humidity':null,h.pop===null?'precipitation chance':null,!h.summary?'weather description':null].filter(Boolean)))],onset:firstTimes.length?new Date(Math.min(...firstTimes)).toISOString():null,hazards:[...new Set(triggers.flatMap(h=>h.hazards))],minTemp:hours.some(h=>h.temp!==null)?Math.min(...hours.filter(h=>h.temp!==null).map(h=>h.temp!)):null};
}
