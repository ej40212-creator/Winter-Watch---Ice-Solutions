import {currentWeather} from '../../../lib/current-weather';
export async function GET(request:Request){
 const key=new URL(request.url).searchParams.get('key');
 if(!key)return Response.json({error:'Choose a site.'},{status:400});
 try{return Response.json(await currentWeather(key),{headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({status:'unavailable',error:'Current observations are unavailable. The site address may need review, or nearby stations may not be reporting. Try again shortly.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
