const endpoint=env=>`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${env.CLOUDFLARE_D1_DATABASE_ID}/query`;

function statement(sql,params=[]){return {sql,params}}

async function send(env,payload){
 const required=['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_D1_DATABASE_ID','CLOUDFLARE_D1_API_TOKEN'];
 if(required.some(key=>!env[key]))throw new Error('Configuration D1 distante incomplète.');
 const response=await fetch(endpoint(env),{method:'POST',headers:{authorization:`Bearer ${env.CLOUDFLARE_D1_API_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(payload)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.success===false)throw new Error(data.errors?.[0]?.message||'D1 distant indisponible.');
 return data.result;
}

class Prepared{
 constructor(env,sql,params=[]){this.env=env;this.sql=sql;this.params=params}
 bind(...params){return new Prepared(this.env,this.sql,params)}
 async all(){const result=(await send(this.env,statement(this.sql,this.params)))[0]||{};return {results:result.results||[],meta:result.meta||{}}}
 async first(){return (await this.all()).results[0]||null}
 async run(){const result=(await send(this.env,statement(this.sql,this.params)))[0]||{};return {results:result.results||[],meta:result.meta||{changes:0}}}
}

export function d1Database(env){
 return {
  prepare(sql){return new Prepared(env,sql)},
  async batch(items){
   const payload=items.map(item=>statement(item.sql,item.params));
   const results=await send(env,payload);
   return results.map(result=>({results:result.results||[],meta:result.meta||{changes:0}}));
  }
 };
}
