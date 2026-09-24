import worker from '../worker.mjs';
import {supabaseDatabase} from '../vercel/supabase-postgres.mjs';
import {supabaseBucket} from '../vercel/supabase-storage.mjs';
import {productImageBucket} from '../vercel/cloudinary-images.mjs';

export default {
 async fetch(request){
  const env={...process.env};
  env.DB=supabaseDatabase(env);
  const privateBucket=supabaseBucket(env);
  env.BUCKET=productImageBucket(env,privateBucket);
  const incoming=new URL(request.url),original=incoming.searchParams.get('__path');
  let routed=request;
  if(original){incoming.pathname=original;incoming.searchParams.delete('__path');routed=new Request(incoming,request)}
  const response=await worker.fetch(routed,env);
  // Le bootstrap d'un visiteur sans session ne contient aucune donnée personnelle.
  // Il peut donc être servi brièvement par le CDN Vercel au lieu de refaire les
  // mêmes lectures PostgreSQL pour chaque nouveau visiteur. Toute requête avec
  // cookie/session reste strictement privée et non mise en cache.
  const path=new URL(routed.url).pathname;
  if(request.method==='GET'&&path==='/api/bootstrap'&&!request.headers.get('cookie')&&response.ok){
   const headers=new Headers(response.headers);
   headers.set('cache-control','public, s-maxage=60, stale-while-revalidate=300');
   headers.set('vary','Cookie');
   return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }
  return response;
 }
};
