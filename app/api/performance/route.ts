import {performanceHistory} from '../../../lib/telemetry';
export async function GET(){try{return Response.json(await performanceHistory(),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Performance history is temporarily unavailable.'},{status:503});}}
