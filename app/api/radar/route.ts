import {radar} from '../../../lib/noaa';
export async function GET(request:Request){
 const key=new URL(request.url).searchParams.get('key');
 if(!key)return Response.json({error:'Choose a site.'},{status:400});
 try{return Response.json(await radar(key),{headers:{'Cache-Control':'no-store'}});}
 catch(e){return Response.json({error:e instanceof Error?e.message:'Radar unavailable.'},{status:503});}
}
