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

export function isCloudinaryProductImage(url){
 return typeof url==='string'&&/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url);
}

export async function uploadProductImage(env,bytes,contentType){
 const {cloudName,apiKey,apiSecret}=config(env);
 const timestamp=Math.floor(Date.now()/1000);
 const folder='macourashop/products';
 const publicId=crypto.randomUUID();
 const signature=await sha1(`folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`);
 const form=new FormData();
 form.set('file',new Blob([bytes],{type:contentType}),publicId);
 form.set('api_key',apiKey);
 form.set('timestamp',String(timestamp));
 form.set('folder',folder);
 form.set('public_id',publicId);
 form.set('signature',signature);
 const response=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,{method:'POST',body:form});
 if(!response.ok)throw new Error('Import Cloudinary impossible.');
 const result=await response.json();
 if(!result.secure_url)throw new Error('Réponse Cloudinary invalide.');
 return result.secure_url;
}
