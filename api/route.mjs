import worker from '../worker.mjs';
import {d1Database} from '../vercel/d1-http.mjs';
import {r2Bucket} from '../vercel/r2-http.mjs';

export default {
 async fetch(request){
  const env={...process.env};
  env.DB=d1Database(env);
  env.BUCKET=r2Bucket(env);
  const incoming=new URL(request.url),original=incoming.searchParams.get('__path');
  let routed=request;
  if(original){incoming.pathname=original;incoming.searchParams.delete('__path');routed=new Request(incoming,request)}
  return worker.fetch(routed,env);
 }
};
