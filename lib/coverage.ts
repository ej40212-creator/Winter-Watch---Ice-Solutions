export const FRESH_MS=90*60000;
export function coverageReasons(w:any,hours:number,now=Date.now()):string[]{
 if(!w)return ['Not checked yet'];
 const reasons:string[]=[];
 if(w.failureKind==='address'||/address.*(match|review|verification)/i.test(w.error||''))reasons.push('Address needs review');
 else if(w.status==='error')reasons.push('Temporary service failure');
 if(!Number.isFinite(Date.parse(w.updated))||now-Date.parse(w.updated)>FRESH_MS)reasons.push('Refresh overdue');
 if(w.status==='stale')reasons.push('Provider forecast outdated');
 if(w.alertsChecked===false||/alert check unavailable/i.test(w.error||''))reasons.push('Alert check unavailable');
 const window=w.windows?.[hours]||w;
 if(!reasons.length){
  if(window.missingFields?.length)reasons.push('Missing hourly fields');
  if(window.coverageEnd&&Date.parse(window.coverageEnd)<now+hours*3600000-60000)reasons.push('Forecast ends before outlook');
  if(!window.complete&&!reasons.length)reasons.push('Incomplete hourly forecast');
 }
 return reasons;
}
export function retryDelay(kind:string,attempt:number){return kind==='address'?24*3600000:Math.min(60,5*2**Math.min(attempt-1,4))*60000;}
