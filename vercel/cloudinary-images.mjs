const encoder=new TextEncoder();

function config(env){
 const cloudName=String(env.CLOUDINARY_CLOUD_NAME||'').trim();
 const apiKey=String(env.CLOUDINARY_API_KEY||'').trim();
 const apiSecret=String(env.CLOUDINARY_API_SECRET||'').trim();
 if(!cloudName||!apiKey||!apiSecret)throw new Error('Configuration Cloudinary incomplète.');
 return {cloudName,apiKey,apiSecret};
}

async function sha1(value){
 const digest=await crypto.subtle.digest('SHA-1',encoder.encode(value));
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

const publicId=key=>'macourashop/products/'+key.slice('products/'.length);
const deliveryUrl=(env,key)=>{
 const {cloudName}=config(env);
 return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload/c_limit,w_1800/f_auto/q_auto/${publicId(key)}`;
};

async function upload(env,key,body,contentType){
 const {cloudName,apiKey,apiSecret}=config(env),timestamp=Math.floor(Date.now()/1000),id=publicId(key);
 const signature=await sha1(`overwrite=true&public_id=${id}&timestamp=${timestamp}${apiSecret}`);
 const form=new FormData();
 form.set('file',new Blob([body],{type:contentType}));
 form.set('api_key',apiKey);form.set('timestamp',String(timestamp));form.set('public_id',id);form.set('overwrite','true');form.set('signature',signature);
 const response=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,{method:'POST',body:form});
 if(!response.ok)throw new Error('Enregistrement Cloudinary impossible.');
}

async function destroy(env,key){
 const {cloudName,apiKey,apiSecret}=config(env),timestamp=Math.floor(Date.now()/1000),id=publicId(key);
 const signature=await sha1(`public_id=${id}&timestamp=${timestamp}${apiSecret}`);
 const form=new FormData();form.set('public_id',id);form.set('timestamp',String(timestamp));form.set('api_key',apiKey);form.set('signature',signature);
 const response=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`,{method:'POST',body:form});
 if(!response.ok)throw new Error('Suppression Cloudinary impossible.');
}

export function productImageBucket(env,privateBucket){return {
 async get(key){
  if(!key.startsWith('products/'))return privateBucket.get(key);
  const response=await fetch(deliveryUrl(env,key));
  if(response.status===404)return null;
  if(!response.ok)throw new Error('Lecture Cloudinary impossible.');
  return {body:response.body,httpMetadata:{contentType:response.headers.get('content-type')||'image/webp'}};
 },
 async put(key,body,options={}){
  if(!key.startsWith('products/'))return privateBucket.put(key,body,options);
  await upload(env,key,body,options.httpMetadata?.contentType||'image/jpeg');return {};
 },
 async delete(key){
  if(!key.startsWith('products/'))return privateBucket.delete?.(key);
  await destroy(env,key);return {};
 }
};}
