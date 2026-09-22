const enc=new TextEncoder();
const hex=buffer=>[...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const sha=value=>crypto.subtle.digest('SHA-256',typeof value==='string'?enc.encode(value):value);
const hmac=async(key,value)=>crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',typeof key==='string'?enc.encode(key):key,{name:'HMAC',hash:'SHA-256'},false,['sign']),enc.encode(value));
const encodePath=key=>key.split('/').map(encodeURIComponent).join('/');

async function signedFetch(env,key,method,body,contentType='application/octet-stream'){
 const required=['CLOUDFLARE_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME'];
 if(required.some(name=>!env[name]))throw new Error('Configuration R2 distante incomplète.');
 const host=`${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,path=`/${encodeURIComponent(env.R2_BUCKET_NAME)}/${encodePath(key)}`,now=new Date(),stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,''),date=stamp.slice(0,8),payloadHash=hex(await sha(body?await new Response(body).arrayBuffer():new Uint8Array()));
 const headers={host,'x-amz-content-sha256':payloadHash,'x-amz-date':stamp};
 if(body)headers['content-type']=contentType;
 const signedNames=Object.keys(headers).sort(),canonicalHeaders=signedNames.map(name=>`${name}:${headers[name]}\n`).join(''),canonicalRequest=[method,path,'',canonicalHeaders,signedNames.join(';'),payloadHash].join('\n'),scope=`${date}/auto/s3/aws4_request`,stringToSign=['AWS4-HMAC-SHA256',stamp,scope,hex(await sha(canonicalRequest))].join('\n');
 const kDate=await hmac('AWS4'+env.R2_SECRET_ACCESS_KEY,date),kRegion=await hmac(kDate,'auto'),kService=await hmac(kRegion,'s3'),kSigning=await hmac(kService,'aws4_request'),signature=hex(await hmac(kSigning,stringToSign));
 headers.authorization=`AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`;
 return fetch(`https://${host}${path}`,{method,headers,body});
}

export function r2Bucket(env){return {
 async get(key){const response=await signedFetch(env,key,'GET');if(response.status===404)return null;if(!response.ok)throw new Error('Lecture R2 impossible.');return {body:response.body,httpMetadata:{contentType:response.headers.get('content-type')||'application/octet-stream'}}},
 async put(key,body,options={}){const response=await signedFetch(env,key,'PUT',body,options.httpMetadata?.contentType);if(!response.ok)throw new Error('Enregistrement R2 impossible.');return {}},
 async delete(key){const response=await signedFetch(env,key,'DELETE');if(!response.ok&&response.status!==404)throw new Error('Suppression R2 impossible.');return {}}
};}
