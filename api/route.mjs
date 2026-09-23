import worker from '../worker.mjs';
import {supabaseDatabase} from '../vercel/supabase-postgres.mjs';
import {supabaseBucket} from '../vercel/supabase-storage.mjs';

export default {
 async fetch(request){
  const env={...process.env};
  env.DB=supabaseDatabase(env);
  env.BUCKET=supabaseBucket(env);
  const incoming=new URL(request.url),original=incoming.searchParams.get('__path');
  let routed=request;
  if(original){incoming.pathname=original;incoming.searchParams.delete('__path');routed=new Request(incoming,request)}
  return worker.fetch(routed,env);
 }
};
