import {coverageReasons,FRESH_MS} from './coverage';
export function networkAnalytics(sites:any[],data:Record<string,any>,hours:number,now:number){
 const freshness=[{name:'Within 15 min',count:0,color:'#287f83'},{name:'15–90 min',count:0,color:'#6eb4bd'},{name:'Over 90 min',count:0,color:'#cf9142'},{name:'Not checked / unknown',count:0,color:'#a6b3bf'}];
 let retries=0,resolved=0;const grids=new Set<string>(),states=new Map<string,{name:string,total:number,complete:number,gaps:number}>();
 for(const s of sites){const w=data[s.key],t=Date.parse(w?.updated),age=now-t;freshness[!Number.isFinite(t)||age<0?3:age<=900000?0:age<=FRESH_MS?1:2].count++;
  if(w?.nextRetry>now)retries++;if(w?.grid){resolved++;grids.add(w.grid);}
  const st=states.get(s.state)||{name:s.state,total:0,complete:0,gaps:0};st.total++;if(!coverageReasons(w,hours,now).length)st.complete++;else st.gaps++;states.set(s.state,st);
 }
 return {freshness,retries,resolved,grids:grids.size,reuse:resolved-grids.size,windows:[24,48,72,168].map(h=>({name:h===168?'One week':`${h} hours`,hours:h,complete:sites.filter(s=>!coverageReasons(data[s.key],h,now).length).length,total:sites.length})),states:[...states.values()].sort((a,b)=>b.gaps-a.gaps||a.name.localeCompare(b.name))};
}
export function performanceSeries(buckets:any[],rangeHours:number,now:number){
 const step=rangeHours===1?300000:rangeHours===24?3600000:6*3600000;
 const end=Math.floor(now/step)*step,start=end-(Math.ceil(rangeHours*3600000/step)-1)*step;
 const points=Array.from({length:Math.ceil(rangeHours*3600000/step)},(_,i)=>({at:start+i*step,count:0,failed:0,durationMs:0}));
 for(const b of buckets){const i=Math.floor((b.at-start)/step);if(i>=0&&i<points.length){points[i].count+=b.count;points[i].failed+=b.failed;points[i].durationMs+=b.durationMs;}}
 const totals=points.reduce((a,b)=>({count:a.count+b.count,failed:a.failed+b.failed,durationMs:a.durationMs+b.durationMs}),{count:0,failed:0,durationMs:0});
 return {points,totals,step};
}
