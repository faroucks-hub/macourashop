self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

async function refreshSession(){
 try{
  const response=await fetch('/api/auth/session',{method:'GET',credentials:'same-origin',cache:'no-store'});
  return response.ok;
 }catch{return false}
}

async function authenticatedApiFetch(request){
 const url=new URL(request.url);
 if(url.pathname==='/api/auth/session'||url.pathname==='/api/auth/login'||url.pathname==='/api/auth/logout')return fetch(request);
 const retry=request.clone();
 let response=await fetch(request);
 if(response.status!==401&&response.status!==403)return response;
 const refreshed=await refreshSession();
 if(!refreshed)return response;
 response=await fetch(retry);
 return response;
}

self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 if(url.pathname.startsWith('/api/')){
  event.respondWith(authenticatedApiFetch(request));
  return;
 }
 if(request.method!=='GET')return;
 event.respondWith(fetch(request));
});
