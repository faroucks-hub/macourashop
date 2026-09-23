const encodePath=key=>key.split('/').map(encodeURIComponent).join('/');

function config(env){
 const url=String(env.CUSTOMER_AUTH_URL||'').replace(/\/$/,'');
 const key=env.SUPABASE_SERVICE_ROLE_KEY;
 const bucket=env.SUPABASE_STORAGE_BUCKET||'macourashop-private';
 if(!url||!key)throw new Error('Configuration Supabase Storage incomplète.');
 return {url,key,bucket};
}

async function storageFetch(env,key,method,body,contentType){
 const cfg=config(env),headers={apikey:cfg.key,authorization:`Bearer ${cfg.key}`};
 if(contentType)headers['content-type']=contentType;
 if(method==='POST')headers['x-upsert']='true';
 return fetch(`${cfg.url}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${encodePath(key)}`,{method,headers,body});
}

export function supabaseBucket(env){return {
 async get(key){const response=await storageFetch(env,key,'GET');if(response.status===404)return null;if(!response.ok)throw new Error('Lecture Supabase Storage impossible.');return {body:response.body,httpMetadata:{contentType:response.headers.get('content-type')||'application/octet-stream'}}},
 async put(key,body,options={}){const response=await storageFetch(env,key,'POST',body,options.httpMetadata?.contentType||'application/octet-stream');if(!response.ok)throw new Error('Enregistrement Supabase Storage impossible.');return {}},
 async delete(key){const cfg=config(env);const response=await fetch(`${cfg.url}/storage/v1/object/${encodeURIComponent(cfg.bucket)}`,{method:'DELETE',headers:{apikey:cfg.key,authorization:`Bearer ${cfg.key}`,'content-type':'application/json'},body:JSON.stringify({prefixes:[key]})});if(!response.ok&&response.status!==404)throw new Error('Suppression Supabase Storage impossible.');return {}}
};}
