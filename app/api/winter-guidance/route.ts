import {winterGuidance} from '../../../lib/noaa';
export async function GET(request:Request){
 const key=new URL(request.url).searchParams.get('key');
 if(!key)return Response.json({error:'Choose a site.'},{status:400});
 try{return Response.json(await winterGuidance(key),{headers:{'Cache-Control':'no-store'}});}
 catch(e){return Response.json({error:e instanceof Error?e.message:'Guidance unavailable.'},{status:503});}
}
