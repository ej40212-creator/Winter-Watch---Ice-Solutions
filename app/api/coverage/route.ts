import {cached} from '../../../lib/weather';
export async function GET(){return Response.json(await cached('background-status',false)||{lastRun:null},{headers:{'Cache-Control':'no-store'}});}
