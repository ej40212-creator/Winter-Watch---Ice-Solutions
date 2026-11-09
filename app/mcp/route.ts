import {refreshBatch,refreshStatus} from '../../lib/background';
const list=[{name:'refresh_weather_batch',description:'Refresh up to 40 due Winter Watch sites and persist results. Repeat until remainingDue is zero. Uses shared NWS grid forecasts, verified locations, and retry backoff.',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'weather_refresh_status',description:'Read persisted background refresh status, checked count, and addresses requiring review.',inputSchema:{type:'object',properties:{},additionalProperties:false}}];
export async function POST(request:Request){
 const b:any=await request.json();const reply=(result:any)=>Response.json({jsonrpc:'2.0',id:b.id,result});
 if(b.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
 if(b.method==='tools/list')return reply({tools:list});
 if(b.method==='tools/call'){
  if(!request.headers.get('oai-authenticated-user-id'))return Response.json({error:'Authenticated access required.'},{status:401});
  try{const data=b.params?.name==='refresh_weather_batch'?await refreshBatch():b.params?.name==='weather_refresh_status'?await refreshStatus():null;
   if(!data)throw Error('Unknown tool.');return reply({content:[{type:'text',text:JSON.stringify(data)}]});
  }catch(e){return reply({content:[{type:'text',text:e instanceof Error?e.message:'Refresh failed.'}],isError:true});}
 }
 return Response.json({jsonrpc:'2.0',id:b.id,error:{code:-32601,message:'Method not found'}});
}
