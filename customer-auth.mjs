const AUTH_COOKIE='__Host-macoura-client';
const REFRESH_COOKIE='__Host-macoura-refresh';
const AUTH_ORIGIN='https://macourashop.faroucks.chatgpt.site';
const authOrigin=env=>String(env.SITE_ORIGIN||AUTH_ORIGIN).replace(/\/$/,'');
export function authConfigured(env){return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.CUSTOMER_AUTH_URL||'')&&!!env.CUSTOMER_AUTH_PUBLIC_KEY}
function authError(message,status=400){return Object.assign(new Error(message),{status})}
function cookieValue(req,name){const part=(req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));return part?.slice(name.length+1)||''}
function sessionToken(req){return cookieValue(req,AUTH_COOKIE)}
function refreshToken(req){return cookieValue(req,REFRESH_COOKIE)}
async function provider(env,path,method='GET',body,token){
 if(!authConfigured(env))throw authError('L’inscription par e-mail est en cours de configuration.',503);
 const res=await fetch(env.CUSTOMER_AUTH_URL+'/auth/v1'+path,{method,headers:{apikey:env.CUSTOMER_AUTH_PUBLIC_KEY,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw authError(res.status===429?'Trop de tentatives. Réessayez plus tard.':'Connexion ou vérification impossible. Vérifiez vos informations et la confirmation de votre adresse e-mail.',res.status===429?429:res.status===401?401:400);
 return data;
}
function publicUser(u){if(!u?.id||!u?.email_confirmed_at)return null;return {id:'customer:'+u.id,email:u.email,name:String(u.user_metadata?.name||'').slice(0,100),phone:String(u.user_metadata?.phone||'').slice(0,30)}}
export async function customerIdentity(req,env){
 const token=sessionToken(req);if(!token||!authConfigured(env))return null;
 try{return publicUser(await provider(env,'/user','GET',undefined,token))}catch{return null}
}
function cookie(name,value,age){return name+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+age}
function authReply(data,session,clear=false){
 const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
 if(clear){headers.append('set-cookie',cookie(AUTH_COOKIE,'',0));headers.append('set-cookie',cookie(REFRESH_COOKIE,'',0))}
 else if(session){const accessAge=Math.max(60,Math.min(Number(session.expires_in)||3600,3600));headers.append('set-cookie',cookie(AUTH_COOKIE,session.access_token,accessAge));if(session.refresh_token)headers.append('set-cookie',cookie(REFRESH_COOKIE,session.refresh_token,60*60*24*30))}
 return new Response(JSON.stringify(data),{headers});
}
async function renewableSession(req,env){
 let user=await customerIdentity(req,env);if(user)return {user,session:null};
 const refresh=refreshToken(req);if(!refresh||!authConfigured(env))return {user:null,session:null};
 try{const session=await provider(env,'/token?grant_type=refresh_token','POST',{refresh_token:refresh});user=publicUser(session.user);if(!user||!session.access_token)return {user:null,session:null};return {user,session}}catch{return {user:null,session:null}}
}
function emailValue(b){const email=String(b.email||'').trim().toLowerCase();if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw authError('Indiquez une adresse e-mail valide.');return email}
function passwordValue(b){if(typeof b.password!=='string'||b.password.length<8||b.password.length>20)throw authError('Utilisez un mot de passe de 8 à 20 caractères.');return b.password}
async function throttle(req,env,action,email){
 const ip=req.headers.get('cf-connecting-ip')||'unknown';
 for(const [value,max] of [[ip,30],[email||ip,6]]){
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('auth:'+action+':'+value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const row=await env.DB.prepare('INSERT INTO tracking_limits(id,window,attempts) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END,window=excluded.window RETURNING attempts').bind(hash,Math.floor(Date.now()/900000)).first();
 if(row.attempts>max)throw authError('Trop de tentatives. Réessayez dans 15 minutes.',429);
 }
}
export async function customerAuthApi(req,env){
 const action=new URL(req.url).pathname.split('/').pop();
 if(req.method==='GET'&&action==='session'){const current=await renewableSession(req,env);return authReply({configured:authConfigured(env),customer:current.user},current.session,!current.user&&(!!sessionToken(req)||!!refreshToken(req)))}
 if(req.method!=='POST')throw authError('Méthode refusée.',405);
 if(req.headers.get('origin')!==authOrigin(env))throw authError('Origine refusée.',403);
 if(!req.headers.get('content-type')?.includes('application/json'))throw authError('Format invalide.');
 const raw=await req.text();if(raw.length>8192)throw authError('Formulaire trop volumineux.');
 let b;try{b=JSON.parse(raw)}catch{throw authError('Formulaire invalide.')}
 if(action==='logout'){const token=sessionToken(req);if(token&&authConfigured(env)){try{await provider(env,'/logout','POST',{},token)}catch{}}return authReply({ok:true},null,true)}
 if(!authConfigured(env))throw authError('L’inscription par e-mail est en cours de configuration.',503);
 if(['signup','login','recover'].includes(action)){
 const email=emailValue(b);await throttle(req,env,action,email);
 if(action==='recover'){try{await provider(env,'/recover','POST',{email})}catch(e){if(e.status===429)throw e}return authReply({message:'Si cette adresse correspond à un compte, un e-mail de récupération vous sera envoyé.'})}
 if(action==='signup'){const password=passwordValue(b),name=String(b.name||'').trim();if(name.length<2||name.length>100)throw authError('Indiquez votre nom (2 à 100 caractères).');await provider(env,'/signup','POST',{email,password,data:{name}});return authReply({message:'Consultez votre messagerie pour confirmer votre inscription. Si vous avez déjà un compte, connectez-vous ou réinitialisez votre mot de passe.'})}
 const session=await provider(env,'/token?grant_type=password','POST',{email,password:passwordValue(b)});if(!session.access_token||!session.refresh_token||!session.user?.email_confirmed_at)throw authError('Confirmez votre adresse e-mail avant de vous connecter.');const admin=!!env.ADMIN_EMAIL&&email===env.ADMIN_EMAIL.trim().toLowerCase();return authReply({ok:true,admin},session);
 }
 if(action==='verify'){
 await throttle(req,env,action);if(!['signup','recovery'].includes(b.type)||typeof b.token_hash!=='string'||!/^[a-f0-9]{32,128}$/.test(b.token_hash))throw authError('Lien invalide.');
 const s=await provider(env,'/verify','POST',{token_hash:b.token_hash,type:b.type});if(!s.access_token||!s.refresh_token||!s.user?.email_confirmed_at)throw authError('Lien invalide ou expiré.');return authReply({ok:true,recovery:b.type==='recovery'},s);
 }
 const current=await renewableSession(req,env),user=current.user;if(!user)throw authError('Votre session a expiré. Reconnectez-vous.',401);
 const token=current.session?.access_token||sessionToken(req);
 if(action==='password'){await throttle(req,env,action,user.id);await provider(env,'/user','PUT',{password:passwordValue(b)},token);try{await provider(env,'/logout','POST',{},token)}catch{}return authReply({message:'Mot de passe enregistré. Connectez-vous avec votre nouveau mot de passe.'},null,true)}
 if(action==='profile'){const name=String(b.name||'').trim(),phone=String(b.phone||'').trim();if(name.length<2||name.length>100||phone.length>30||(phone&&!/^[+\d\s().-]{6,30}$/.test(phone)))throw authError('Vérifiez le nom et le téléphone.');await provider(env,'/user','PUT',{data:{name,phone}},token);return authReply({ok:true},current.session)}
 throw authError('Page introuvable.',404);
}
