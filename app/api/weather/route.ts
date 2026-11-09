import { forecast, snapshot, nationalAlerts } from '../../../lib/weather';
export async function GET(request:Request){
 const u=new URL(request.url);
 try{
 if(u.searchParams.has('key'))return Response.json(await forecast(u.searchParams.get('key')!),{headers:{'Cache-Control':'no-store'}});
 if(u.searchParams.has('alerts'))return Response.json(await nationalAlerts(),{headers:{'Cache-Control':'no-store'}});
 return Response.json(await snapshot(),{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Weather service is temporarily unavailable. Please retry.'},{status:503});}
}
