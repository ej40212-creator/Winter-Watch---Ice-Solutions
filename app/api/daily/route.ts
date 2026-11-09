import {dailyForecast} from '../../../lib/daily-weather';
export async function GET(request:Request){
 const url=new URL(request.url),key=url.searchParams.get('key'),provider=url.searchParams.get('provider')||'nws';
 if(!key||!['nws','accuweather'].includes(provider))return Response.json({error:'Choose a valid site and provider.'},{status:400});
 try{return Response.json(await dailyForecast(key,provider as 'nws'|'accuweather'),{headers:{'Cache-Control':'no-store'}});}
 catch{return Response.json({provider,status:'unavailable',error:'The daily weather service is temporarily unavailable.'},{status:503});}
}
