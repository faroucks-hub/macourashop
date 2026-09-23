import {customerIdentity,customerAuthApi,authConfigured} from './customer-auth.mjs';
import { DEFAULT_COLORS, colorKey } from './variants.mjs';
import { CHECKOUT_DEFAULTS, PAYMENT_DEFAULTS, checkoutRules, contactDetails, whatsappDigits, effectivePrice, paymentMethods, promotionQuote } from './commerce.mjs';
import { ORDER_TRANSITIONS, cancelledOrder, cancellationWindow, returnWindow, normalizePhone, parseCosts, financeSummary, orderFigures, activityReport } from './operations.mjs';
const ORIGIN='https://macourashop.faroucks.chatgpt.site';
const requestOrigin=(req,env)=>String(env.SITE_ORIGIN||ORIGIN).replace(/\/$/,'');
const STATUS_SINCE="COALESCE(json_extract(o.details,'$.statusChangedAt'),(SELECT MIN(e.created) FROM order_events e WHERE e.order_id=o.id AND e.status=o.status),o.created)";
const CATEGORIES=['Robes','Jupes','Tuniques','Ensembles','Pantalons','Chemises','Bijoux'];
const COUNTRIES=['FR','CI','SN','BJ','BF','ML','NE','TG','GW'];
const SOCIAL_SOURCES={tiktok:'TikTok',whatsapp:'WhatsApp',instagram:'Instagram',facebook:'Facebook',phone:'Téléphone',direct:'Vente directe'};
const CONFIRMED_TEST_PRODUCTS=['3945d6c8-4815-41f5-9b55-9472e8739873','84c3fcab-50b0-4efe-b7a1-4284c0be1499','e8e14ef4-2a5f-4aac-a714-fc3f34552e5f'];
const defaults={checkout:CHECKOUT_DEFAULTS,payments:PAYMENT_DEFAULTS,colors:DEFAULT_COLORS,zones:[],promotions:[],social:{instagram:'',facebook:'',tiktok:'',whatsapp:''},merchant:{legalName:'',address:'',email:'',phone:'',registration:'',returnAddress:''}};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const str=(x,min=1,max=200)=>{if(typeof x!=='string'||x.trim().length<min||x.trim().length>max)fail('Champ invalide ou incomplet.');return x.trim()};
const num=(x,max=100000000)=>{if(!Number.isSafeInteger(x)||x<0||x>max)fail('Montant ou quantité invalide.');return x};
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
async function json(req){if(!req.headers.get('content-type')?.includes('application/json'))fail('Format attendu : JSON.',415);const raw=await req.text();if(raw.length>100000)fail('Requête trop volumineuse.',413);try{return JSON.parse(raw)}catch{fail('Données illisibles.')}}
function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})}
function storedImages(p){const images=JSON.parse(p.images||'[]');return images.length?images:p.image?[p.image]:[]}
function validatePromotions(raw){if(!Array.isArray(raw)||raw.length>40)fail('Liste de promotions invalide.');const ids=new Set();return raw.map(c=>{const id=str(c.id,1,80);if(ids.has(id))fail('Promotion en double.');ids.add(id);const type=str(c.type);if(!['fixed_price','product_percent','quantity_percent','buy_get','shipping'].includes(type))fail('Type de promotion inconnu.');const target=['all','category','products'].includes(c.target)?c.target:'all',title=str(c.title,2,80),currency=['ALL','EUR','XOF'].includes(c.currency)?c.currency:'ALL',start=str(c.start||'',0,10),end=str(c.end||'',0,10);if(start&&!/^\d{4}-\d{2}-\d{2}$/.test(start)||end&&!/^\d{4}-\d{2}-\d{2}$/.test(end)||start&&end&&start>end)fail('Période de promotion invalide.');const percent=['buy_get','fixed_price'].includes(type)?0:num(Number(c.percent||0),100),minQty=num(Number(c.minQty||0),20),buyQty=num(Number(c.buyQty||0),20),freeQty=num(Number(c.freeQty||0),20),priceEUR=num(Number(c.priceEUR||0)),priceXOF=num(Number(c.priceXOF||0));if(['product_percent','quantity_percent'].includes(type)&&(!percent||percent>100))fail('Indiquez une réduction entre 1 et 100 %.');if(type==='fixed_price'&&!priceEUR&&!priceXOF)fail('Indiquez au moins un prix spécial.');if(type==='quantity_percent'&&minQty<2)fail('La réduction par quantité commence à 2 articles.');if(type==='buy_get'&&(!buyQty||!freeQty||buyQty+freeQty>20))fail('Quantités offertes invalides.');const productIds=target==='products'?[...new Set((c.productIds||[]).map(x=>str(x)))]:[],category=target==='category'?str(c.category):'';if(target==='products'&&!productIds.length)fail('Sélectionnez au moins un produit.');if(target==='category'&&!CATEGORIES.includes(category))fail('Catégorie de promotion invalide.');const countries=type==='shipping'?[...new Set((c.countries||[]).filter(x=>COUNTRIES.includes(x)))]:[];if(type==='shipping'&&!c.freeShipping&&(!percent||percent>100))fail('Indiquez la réduction de livraison.');return {id,title,type,target,category,productIds,currency,start,end,active:!!c.active,percent,minQty,buyQty,freeQty,priceEUR,priceXOF,freeShipping:!!c.freeShipping,minSubtotal:num(Number(c.minSubtotal||0)),countries};})}
async function catalogue(db,admin=false){const ps=(await q(db,`SELECT * FROM products ${admin?'':'WHERE active=1 AND demo=0'} ORDER BY created DESC`).all()).results;const vs=(await q(db,'SELECT * FROM variants').all()).results;return ps.map(({costs,...p})=>({...p,...(admin?{costs:parseCosts(costs)}:{}),images:storedImages(p),merchandising:JSON.parse(p.merchandising||'{}'),variants:vs.filter(v=>v.product_id===p.id)}))}
async function configuration(db){const row=await q(db,'SELECT * FROM settings WHERE id=1').first();const cfg=row?{...defaults,...JSON.parse(row.data),revision:row.revision}:{...defaults,revision:0};cfg.payments={...PAYMENT_DEFAULTS,cod:cfg.payments?.cod!==false};cfg.zones=(cfg.zones||[]).map(z=>({...z,confirmed:z.confirmed!==false}));return cfg}
async function cleanupConfirmedTestCatalogue(db,env){
 const products=(await q(db,'SELECT id,name,images,image FROM products WHERE id IN (?,?,?)',...CONFIRMED_TEST_PRODUCTS).all()).results;
 if(!products.length)return {ok:true,removed:[]};
 const used=await q(db,'SELECT COUNT(*) AS value FROM order_lines WHERE variant_id IN (SELECT id FROM variants WHERE product_id IN (?,?,?))',...CONFIRMED_TEST_PRODUCTS).first();
 if(used.value)fail('Suppression refusée : un produit test est lié à une commande conservée.',409);
 const statements=[];
 for(const id of CONFIRMED_TEST_PRODUCTS)statements.push(q(db,'DELETE FROM favorites WHERE product_id=?',id),q(db,'DELETE FROM inventory_movements WHERE variant_id IN (SELECT id FROM variants WHERE product_id=?)',id),q(db,'DELETE FROM variants WHERE product_id=?',id),q(db,'DELETE FROM products WHERE id=?',id));
 const cfg=await configuration(db),promotions=(cfg.promotions||[]).map(c=>c.target==='products'?{...c,productIds:(c.productIds||[]).filter(id=>!CONFIRMED_TEST_PRODUCTS.includes(id))}:c).filter(c=>c.target!=='products'||c.productIds.length);
 if(promotions.length!==(cfg.promotions||[]).length||JSON.stringify(promotions)!==JSON.stringify(cfg.promotions||[])){const {revision,...clean}=cfg;clean.promotions=promotions;statements.push(q(db,'UPDATE settings SET data=?,revision=revision+1 WHERE id=1 AND revision=?',JSON.stringify(clean),revision));}
 await db.batch(statements);
 const keys=[...new Set(products.flatMap(p=>{let images=[];try{images=JSON.parse(p.images||'[]')}catch{}return [...images,p.image].filter(x=>typeof x==='string'&&x.startsWith('/media/products/')).map(x=>x.slice(7))}))];
 for(const key of keys)await env.BUCKET.delete?.(key);
 return {ok:true,removed:products.map(p=>p.name)};
}
function validateSettings(b){if(!Array.isArray(b.zones)||b.zones.length>80)fail('Zones invalides.');const seen=new Set();const zones=b.zones.map(z=>{const id=str(z.id);if(seen.has(id))fail('Zone en double.');seen.add(id);if(!COUNTRIES.includes(z.country))fail('Pays non pris en charge.');const confirmed=z.confirmed!==false,enabled=!!z.enabled,delay=str(z.delay,0);if(enabled&&(!confirmed||!delay))fail('Une zone active doit avoir un tarif et un délai vérifiés.',400);return {id,name:str(z.name),country:z.country,currency:z.country==='FR'?'EUR':'XOF',fee:num(z.fee),delay,enabled,confirmed,cod:!!z.cod,coversNeighborhood:!!z.coversNeighborhood}});const social={};for(const key of Object.keys(defaults.social)){const value=str(b.social?.[key]||'',0,500);if(value){let url;try{url=new URL(value)}catch{fail('Lien social invalide.')}const allowed={instagram:['instagram.com','www.instagram.com'],facebook:['facebook.com','www.facebook.com','fb.me'],tiktok:['tiktok.com','www.tiktok.com'],whatsapp:['wa.me','api.whatsapp.com']}[key];if(url.protocol!=='https:'||!allowed.includes(url.hostname))fail('Utilisez un lien HTTPS vers le réseau concerné.');}social[key]=value;}const merchant=Object.fromEntries(Object.keys(defaults.merchant).map(key=>[key,str(b.merchant?.[key]||'',0,key==='address'||key==='returnAddress'?500:200)]));if(merchant.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(merchant.email))fail('Adresse e-mail du vendeur invalide.');if(merchant.phone&&!/^[+\d\s().-]{6,30}$/.test(merchant.phone))fail('Téléphone du vendeur invalide.');const raw=b.colors||DEFAULT_COLORS;if(!Array.isArray(raw)||raw.length<1||raw.length>60)fail('La palette doit contenir entre 1 et 60 couleurs.');const names=new Set();const colors=raw.map(c=>{const name=str(c.name,1,60),hex=str(c.hex,7,7),key=colorKey(name);if(!/^#[0-9a-f]{6}$/i.test(hex))fail('Couleur invalide : utilisez le sélecteur de couleur.');if(names.has(key))fail('Chaque couleur doit avoir un nom distinct.');names.add(key);return {name,hex:hex.toUpperCase()}});const checkout={...CHECKOUT_DEFAULTS,...b.checkout};if(b.payments&&Object.keys(b.payments).some(k=>!Object.hasOwn(PAYMENT_DEFAULTS,k)))fail('Moyen de paiement inconnu.');const payments={...PAYMENT_DEFAULTS,cod:b.payments?.cod!==false};
if(typeof checkout.enabled!=='boolean'||typeof checkout.emailRequired!=='boolean'||Object.values(payments).some(v=>typeof v!=='boolean'))fail('Réglage de commande invalide.');
if(typeof checkout.addressEnabled!=='boolean'||typeof checkout.whatsappContactEnabled!=='boolean'||(!checkout.addressEnabled&&!checkout.whatsappContactEnabled))fail('Activez au moins une façon de préciser l’adresse.');
delete checkout.whatsappEnabled;delete checkout.whatsappNumber;
num(checkout.minimumEUR);num(checkout.minimumXOF);checkout.confirmationMessage=str(checkout.confirmationMessage,0,500);
return {commercialSetupVersion:1,zones,social,merchant,colors,checkout,payments,promotions:validatePromotions(b.promotions||[])};}
async function orderDetail(db,id,admin=false){
 const o=await q(db,'SELECT * FROM orders WHERE id=?',id).first();if(!o)return null;
 const lines=(await q(db,'SELECT * FROM order_lines WHERE order_id=?',id).all()).results.map(({costs,...line})=>({...line,...(admin?{costs:parseCosts(costs)}:{})}));
 const events=(await q(db,'SELECT status,note,created FROM order_events WHERE order_id=? ORDER BY created',id).all()).results;
 const details=JSON.parse(o.details||'{}'),{internalCostCorrections,...publicDetails}=details;let lastStatus=null,changed=o.created;for(const e of events){if(e.status!==lastStatus){changed=e.created;lastStatus=e.status}}
 const since=details.statusChangedAt||changed,days=Math.max(0,Math.floor((Date.now()-Date.parse(since))/86400000)),active=details.reminder&&!details.reminder.resolved;
 const reminder={since,days,active:!!active,created:details.reminder?.created||null,eligible:days>=3&&!active&&!['Livrée','Rejetée','Annulée'].includes(o.status)};
 const {delivery_cost,...publicOrder}=o;const result={...publicOrder,...(admin?{delivery_cost}:{}),details:admin?details:publicDetails,lines,events,reminder,cancellation:cancellationWindow(o)};return {...result,returnPolicy:returnWindow(result)};
}
async function cancelByCustomer(db,o){
 if(o.status==='Annulée')return {ok:true};
 const window=cancellationWindow(o);if(!window.eligible)fail(window.reason||'Annulation indisponible.',409);
 const now=new Date().toISOString(),details={...o.details,statusChangedAt:now,cancelledBy:'customer',...(o.details.reminder?{reminder:{...o.details.reminder,resolved:now}}:{})};
 const statements=[q(db,"UPDATE orders SET status='Annulée',details=?,revision=revision+1 WHERE id=? AND revision=? AND paid=0 AND status=? AND julianday(created)>julianday(?,'-1 day')",JSON.stringify(details),o.id,o.revision,o.status,now),q(db,"INSERT INTO products(id,name,category,description,eur,xof,image,created) SELECT ?, '', '', '', -1, 0, '', '' WHERE changes()=0",crypto.randomUUID())];
 for(const l of o.lines)statements.push(q(db,'UPDATE variants SET stock=stock+? WHERE id=?',l.quantity,l.variant_id));
 statements.push(q(db,'UPDATE products SET revision=revision+1 WHERE id IN (SELECT product_id FROM variants WHERE id IN (SELECT variant_id FROM order_lines WHERE order_id=?))',o.id));
 statements.push(q(db,'INSERT INTO order_events(id,order_id,status,note,created) VALUES(?,?,?,?,?)',crypto.randomUUID(),o.id,'Annulée','Annulée par la cliente dans le délai de 24 heures.',now));
 try{await db.batch(statements)}catch{fail('La commande vient de changer. Actualisez le suivi avant de réessayer.',409)}
 return {ok:true};
}
async function requestReminder(db,o){
 if(!o.reminder.eligible)fail(o.reminder.active?'Une relance est déjà en cours.':'Relance disponible après 3 jours sans changement, pour une commande en cours.',409);
 const details={...o.details,reminder:{created:new Date().toISOString(),status:o.status,resolved:null}};
 const result=await q(db,'UPDATE orders SET details=?,revision=revision+1 WHERE id=? AND revision=?',JSON.stringify(details),o.id,o.revision).run();
 if(!result.meta.changes)fail('La commande vient de changer. Actualisez le suivi.',409);
 return {ok:true};
}
async function requestReturn(db,o,b){
 const window=returnWindow(o);if(!window.eligible)fail(window.reason||'Retour indisponible.',409);
 const reason=str(b.reason,3,500),condition=str(b.condition,3,500);if(b.confirmed!==true)fail('Confirmez que les articles sont non portés, non lavés et complets.');
 const now=new Date().toISOString(),request={status:'Demandé',created:now,reason,condition,customerConfirmed:true};
 const details={...o.details,returnRequest:request};const result=await q(db,'UPDATE orders SET details=?,revision=revision+1 WHERE id=? AND revision=?',JSON.stringify(details),o.id,o.revision).run();
 if(!result.meta.changes)fail('La commande vient de changer. Actualisez le suivi.',409);
 await q(db,'INSERT INTO order_events(id,order_id,status,note,created) VALUES(?,?,?,?,?)',crypto.randomUUID(),o.id,o.status,'Demande de retour enregistrée : '+reason,now).run();return {ok:true};
}
async function manageReturn(db,o,b){
 const current=o.details.returnRequest;if(!current)fail('Aucune demande de retour.',404);const action=str(b.action),note=str(b.note||'',0,500),allowed={approve:['Demandé','Autorisé'],refuse:['Demandé','Autorisé'],receive:['Autorisé'],refund:['Reçu']}[action];
 if(!allowed||!allowed.includes(current.status))fail('Cette action de retour n’est pas autorisée.',409);if(action==='refuse'&&!note)fail('Indiquez le motif du refus.');
 const labels={approve:'Autorisé',refuse:'Refusé',receive:'Reçu',refund:'Remboursé'},status=labels[action],now=new Date().toISOString(),next={...current,status,updated:now,...(note?{note}:{})},details={...o.details,returnRequest:next};
 const statements=[q(db,'UPDATE orders SET details=?,revision=revision+1 WHERE id=? AND revision=?',JSON.stringify(details),o.id,o.revision),q(db,"INSERT INTO products(id,name,category,description,eur,xof,image,created) SELECT ?, '', '', '', -1, 0, '', '' WHERE changes()=0",crypto.randomUUID())];
 if(action==='receive'){for(const l of o.lines)statements.push(q(db,'UPDATE variants SET stock=stock+? WHERE id=?',l.quantity,l.variant_id));statements.push(q(db,'UPDATE products SET revision=revision+1 WHERE id IN (SELECT product_id FROM variants WHERE id IN (SELECT variant_id FROM order_lines WHERE order_id=?))',o.id))}
 statements.push(q(db,'INSERT INTO order_events(id,order_id,status,note,created) VALUES(?,?,?,?,?)',crypto.randomUUID(),o.id,o.status,'Retour '+status.toLowerCase()+(note?' : '+note:''),now));try{await db.batch(statements)}catch{fail('La demande a été modifiée. Actualisez.',409)}return {ok:true};
}
function validateCosts(raw){const result={};for(const currency of ['EUR','XOF']){const v=raw?.[currency]||{};result[currency]={};for(const field of ['purchase','transport']){const n=v[field]??null;if(n!==null)num(n);result[currency][field]=n}}return result}
function orderFilters(params){
 const f=Object.fromEntries(['from','to','status','currency','paid','search','realOnly'].map(k=>[k,params.get(k)||'']));
 for(const key of ['from','to'])if(f[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(f[key])||!Number.isFinite(Date.parse(f[key]+'T00:00:00Z'))||new Date(f[key]+'T00:00:00Z').toISOString().slice(0,10)!==f[key]))fail('Date invalide.');
 if(f.from&&f.to&&f.from>f.to)fail('Période invalide.');
 if(f.status&&!Object.hasOwn(ORDER_TRANSITIONS,f.status))fail('Statut invalide.');
 if(!['','EUR','XOF'].includes(f.currency)||!['','paid','unpaid'].includes(f.paid)||!['','1'].includes(f.realOnly))fail('Filtre invalide.');
 f.search=str(f.search,0,100);return f;
}
async function adminOrderRows(db,f){
 const clauses=[],args=[];
 if(f.from){clauses.push('o.created>=?');args.push(f.from+'T00:00:00.000Z')}
 if(f.to){clauses.push('o.created<?');args.push(new Date(Date.parse(f.to+'T00:00:00Z')+86400000).toISOString())}
 if(f.status){clauses.push('o.status=?');args.push(f.status)}
 if(f.currency){clauses.push('o.currency=?');args.push(f.currency)}
 if(f.paid){clauses.push('o.paid=?');args.push(f.paid==='paid'?1:0)}
 if(f.realOnly)clauses.push('o.demo=0');
 if(f.search){clauses.push("instr(lower(o.id||' '||o.customer||' '||o.phone),lower(?))>0");args.push(f.search)}
 const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
 const orders=(await q(db,'SELECT o.id,o.customer,o.phone,o.country,o.zone,o.currency,o.subtotal,o.shipping,o.total,o.status,o.paid,o.demo,o.created,o.delivery_cost,o.details,'+STATUS_SINCE+' AS status_since FROM orders o'+where+' ORDER BY o.created DESC,o.id DESC',...args).all()).results;
 const lines=(await q(db,'SELECT l.id,l.order_id,l.name,l.size,l.color,l.price,l.quantity,l.costs FROM order_lines l JOIN orders o ON o.id=l.order_id'+where+' ORDER BY l.rowid',...args).all()).results;
 const grouped=new Map();for(const line of lines){if(!grouped.has(line.order_id))grouped.set(line.order_id,[]);grouped.get(line.order_id).push(line)}
 return orders.map(({details,...o})=>{const d=JSON.parse(details||'{}'),items=grouped.get(o.id)||[],full={...o,details:d};return {...o,returnStatus:d.returnRequest?.status||null,source:d.source||'site',proof:d.proof?{name:d.proof.name,type:d.proof.type,created:d.proof.created}:null,statusChangedAt:o.status_since,reminderActive:!!(d.reminder&&!d.reminder.resolved),location:{city:d.city||'',neighborhood:d.neighborhood||''},lines:items.map(l=>({...l,costs:parseCosts(l.costs)})),figures:orderFigures(full,items)}});
}
async function stockData(db){
 const rows=(await q(db,`SELECT v.id AS variant_id,v.product_id,v.size,v.color,v.stock AS available,p.name,p.category,p.image,p.active,
  COALESCE((SELECT SUM(l.quantity) FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE l.variant_id=v.id AND o.demo=0 AND o.status NOT IN ('Livrée','Annulée','Rejetée')),0) AS reserved,
  COALESCE((SELECT SUM(m.unusable_delta) FROM inventory_movements m WHERE m.variant_id=v.id),0) AS unusable
  FROM variants v JOIN products p ON p.id=v.product_id WHERE p.demo=0 ORDER BY p.name,v.size,v.color`).all()).results;
 const movements=(await q(db,`SELECT m.*,p.name,v.size,v.color FROM inventory_movements m JOIN variants v ON v.id=m.variant_id JOIN products p ON p.id=v.product_id ORDER BY m.created DESC LIMIT 500`).all()).results;
 return {rows:rows.map(r=>({...r,physical:r.available+r.reserved+r.unusable})),movements};
}
export async function handleApi(req,env){
 const url=new URL(req.url),path=url.pathname,db=env.DB;
 const platformUser=req.headers.get('oai-authenticated-user-id');
 const customer=await customerIdentity(req,env);
 const user=customer?.id||platformUser;
 const email=req.headers.get('oai-authenticated-user-email')||customer?.email||'';
 const admin=!!user&&!!env.ADMIN_EMAIL&&email.toLowerCase()===env.ADMIN_EMAIL.trim().toLowerCase();
 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('origin')!==requestOrigin(req,env))fail('Origine refusée.',403);
 if(path.startsWith('/api/admin/')&&!admin)fail('Accès réservé à l’administrateur.',403);
 if(path==='/api/admin/notifications'&&req.method==='GET'){
  const row=await q(db,"SELECT count(*) AS count FROM orders o WHERE demo=0 AND COALESCE(json_extract(details,'$.source'),'site')='site' AND status IN ('Nouvelle','Adresse à confirmer')").first();return reply(row);
 }
 if((path==='/api/admin/report'||path==='/api/admin/orders')&&req.method==='GET'){
  const f=orderFilters(url.searchParams);if(path.endsWith('/report'))f.realOnly='1';
  const rows=await adminOrderRows(db,f);
  return reply(path.endsWith('/report')?activityReport(rows,f):{orders:rows,filters:f});
 }
 if(path==='/api/tracking'&&req.method==='POST'){
  const b=await json(req),identity=user||req.headers.get('cf-connecting-ip')||'anonymous',minute=Math.floor(Date.now()/60000);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const limit=await q(db,'INSERT INTO tracking_limits(id,window,attempts) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END,window=excluded.window RETURNING attempts',hash,minute).first();
  if(limit.attempts>12)fail('Trop de tentatives. Réessayez dans une minute.',429);
  const code=typeof b.code==='string'?b.code.replace(/[\s-]/g,'').toUpperCase():'',phone=normalizePhone(b.phone);
  if(!/^[A-F0-9]{32}$/.test(code)||phone.length<6)fail('Téléphone ou code reçu incorrect.',404);
  const row=await q(db,'SELECT id,phone FROM orders WHERE tracking_code=?',code).first();
  if(!row||normalizePhone(row.phone)!==phone)fail('Téléphone ou code reçu incorrect.',404);
  const o=await orderDetail(db,row.id);
  if(b.remind===true)return reply(await requestReminder(db,o));
  if(b.cancel===true)return reply(await cancelByCustomer(db,o));
  if(b.returnRequest)return reply(await requestReturn(db,o,b.returnRequest));
  if(b.receiptType==='final'&&(o.status!=='Livrée'||!o.paid))fail('Le reçu final nécessite une commande livrée et payée.');
  o.document_type=b.receiptType==='final'?'final':'order';
  return reply({document_type:o.document_type,id:o.id,created:o.created,customer:o.customer,phone:o.phone,country:o.country,zone:o.zone,currency:o.currency,subtotal:o.subtotal,shipping:o.shipping,total:o.total,status:o.status,paid:o.paid,demo:o.demo,payment:o.payment,tracking_code:o.tracking_code,details:{city:o.details.city,neighborhood:o.details.neighborhood,returnRequest:o.details.returnRequest},lines:o.lines,events:o.events,reminder:o.reminder,cancellation:o.cancellation,returnPolicy:o.returnPolicy});
 }
 if(path.endsWith('/cancel')&&path.startsWith('/api/order/')&&req.method==='POST'){
  if(!user)fail('Connexion requise.',401);const o=await orderDetail(db,path.split('/')[3]);if(!o||o.user_id!==user)fail('Commande introuvable.',404);return reply(await cancelByCustomer(db,o));
 }
 if(path.endsWith('/reminder')&&path.startsWith('/api/order/')&&req.method==='POST'){
  if(!user)fail('Connexion requise.',401);const o=await orderDetail(db,path.split('/')[3]);if(!o||o.user_id!==user)fail('Commande introuvable.',404);return reply(await requestReminder(db,o));
 }
 if(path.endsWith('/return')&&path.startsWith('/api/order/')&&req.method==='POST'){
  if(!user)fail('Connexion requise.',401);const o=await orderDetail(db,path.split('/')[3]);if(!o||o.user_id!==user)fail('Commande introuvable.',404);return reply(await requestReturn(db,o,await json(req)));
 }
 if(path.endsWith('/receipt')&&path.startsWith('/api/order/')&&req.method==='POST'){
  if(!user)fail('Connexion requise.',401);const id=path.split('/')[3],o=await orderDetail(db,id);if(!o||(!admin&&o.user_id!==user))fail('Commande introuvable.',404);
  const b=await json(req);if(b.type==='final'&&(o.status!=='Livrée'||!o.paid))fail('Le reçu final nécessite une commande livrée et payée.');
  if(!o.tracking_code)await q(db,'UPDATE orders SET tracking_code=? WHERE id=? AND tracking_code IS NULL',crypto.randomUUID().replace(/-/g,'').toUpperCase(),id).run();
  return reply({...await orderDetail(db,id),document_type:b.type==='final'?'final':'order'});
 }
 if(path==='/api/admin/finances'&&req.method==='GET'){
  const from=url.searchParams.get('from')||'0000-01-01',to=url.searchParams.get('to')||'9999-12-31';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)fail('Période invalide.');
  const os=(await q(db,"SELECT * FROM orders WHERE substr(created,1,10)>=? AND substr(created,1,10)<=? AND demo=0",from,to).all()).results;
  const ls=(await q(db,"SELECT l.* FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE substr(o.created,1,10)>=? AND substr(o.created,1,10)<=? AND o.demo=0",from,to).all()).results;
  const es=(await q(db,'SELECT * FROM expenses WHERE spent_on>=? AND spent_on<=? ORDER BY spent_on DESC',from,to).all()).results;
  return reply({EUR:financeSummary(os,ls,es,'EUR'),XOF:financeSummary(os,ls,es,'XOF'),expenses:es});
 }
 if(path==='/api/admin/expense'&&req.method==='POST'){
  const b=await json(req);if(!['EUR','XOF'].includes(b.currency))fail('Devise invalide.');const amount=num(b.amount);if(!amount)fail('Montant positif requis.');const date=str(b.spent_on,10,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||(Number.isNaN(Date.parse(date+'T00:00:00Z'))?'':new Date(date+'T00:00:00Z').toISOString()).slice(0,10)!==date)fail('Date invalide.');
  const key=str(b.key,10,100),existing=await q(db,'SELECT id FROM expenses WHERE request_key=?',key).first();if(existing)return reply({id:existing.id});
  const id=crypto.randomUUID();await q(db,'INSERT INTO expenses(id,request_key,currency,amount,category,description,spent_on,created) VALUES(?,?,?,?,?,?,?,?)',id,key,b.currency,amount,str(b.category,1,60),str(b.description,1,300),date,new Date().toISOString()).run();return reply({id},201);
 }
 if(path==='/api/admin/expense'&&req.method==='PATCH'){
  const b=await json(req);const result=await q(db,'UPDATE expenses SET voided=1 WHERE id=?',str(b.id)).run();if(!result.meta.changes)fail('Dépense introuvable.',404);return reply({ok:true});
 }
 if(path==='/api/bootstrap'&&req.method==='GET')return reply({products:await catalogue(db),settings:await configuration(db),user:!!user,admin,customer,authConfigured:authConfigured(env),favorites:user?(await q(db,'SELECT product_id FROM favorites WHERE user_id=?',user).all()).results.map(x=>x.product_id):[]});
 if(path==='/api/admin/data'&&req.method==='GET')return reply({products:await catalogue(db,true),settings:await configuration(db),orders:(await q(db,'SELECT * FROM orders ORDER BY created DESC LIMIT 500').all()).results});
 if(path==='/api/admin/stock'&&req.method==='GET')return reply(await stockData(db));
 if(path==='/api/admin/stock/movement'&&req.method==='POST'){
  const b=await json(req),variantId=str(b.variantId),type=str(b.type),note=str(b.note,3,300),variant=await q(db,`SELECT v.*,p.name FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.demo=0`,variantId).first();if(!variant)fail('Variante introuvable.',404);
  const reserved=(await q(db,`SELECT COALESCE(SUM(l.quantity),0) AS value FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE l.variant_id=? AND o.status NOT IN ('Livrée','Annulée','Rejetée')`,variantId).first()).value;
  const unusable=(await q(db,'SELECT COALESCE(SUM(unusable_delta),0) AS value FROM inventory_movements WHERE variant_id=?',variantId).first()).value;
  let quantity=0,availableDelta=0,unusableDelta=0,expectedPhysical=null,countedPhysical=null;
  if(type==='inventory'){countedPhysical=num(b.countedPhysical,100000);expectedPhysical=variant.stock+reserved+unusable;availableDelta=countedPhysical-expectedPhysical;quantity=Math.abs(availableDelta);if(!quantity)fail('Aucun écart à enregistrer.');}
  else{quantity=num(b.quantity,100000);if(!quantity)fail('La quantité doit être positive.');const rules={entry:[quantity,0],correction_add:[quantity,0],correction_remove:[-quantity,0],unusable:[-quantity,quantity],restore:[quantity,-quantity],discard:[0,-quantity]};if(!rules[type])fail('Type de mouvement invalide.');[availableDelta,unusableDelta]=rules[type]}
  if(variant.stock+availableDelta<0)fail('Stock disponible insuffisant pour ce mouvement.',409);if(unusable+unusableDelta<0)fail('Stock inutilisable insuffisant pour ce mouvement.',409);
  let currency=null,unitCost=null,supplier='';if(type==='entry'){supplier=str(b.supplier||'',0,100);currency=['EUR','XOF'].includes(b.currency)?b.currency:null;if(b.unitCost!==null&&b.unitCost!==undefined&&b.unitCost!==''){unitCost=num(b.unitCost);if(!currency)fail('Sélectionnez la devise du coût.')}}
  const id=crypto.randomUUID(),created=new Date().toISOString(),statements=[q(db,'UPDATE variants SET stock=stock+? WHERE id=? AND stock=? AND stock+?>=0',availableDelta,variantId,variant.stock,availableDelta),q(db,"INSERT INTO products(id,name,category,description,eur,xof,image,created) SELECT ?, '', '', '', -1, 0, '', '' WHERE changes()=0",crypto.randomUUID()),q(db,'INSERT INTO inventory_movements(id,variant_id,type,quantity,available_delta,unusable_delta,expected_physical,counted_physical,supplier,note,currency,unit_cost,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,variantId,type,quantity,availableDelta,unusableDelta,expectedPhysical,countedPhysical,supplier,note,currency,unitCost,created),q(db,'UPDATE products SET revision=revision+1 WHERE id=?',variant.product_id)];
  try{await db.batch(statements)}catch{fail('Le stock vient de changer. Actualisez avant de recommencer.',409)}return reply({id,...await stockData(db)},201);
 }
 if(path==='/api/admin/social-order'&&req.method==='POST'){
  const b=await json(req),source=str(b.source);if(!SOCIAL_SOURCES[source])fail('Origine de commande invalide.');
  const key=str(b.key,10,100),owner='admin-social:'+platformUser,duplicate=await q(db,'SELECT id FROM orders WHERE user_id=? AND request_key=?',owner,key).first();if(duplicate)return reply(await orderDetail(db,duplicate.id,true));
  const customerName=str(b.customer,2,100),phone=str(b.phone,6,30);if(!/^[+\d\s().-]+$/.test(phone)||phone.replace(/\D/g,'').length<6)fail('Numéro de téléphone invalide.');
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)fail('Ajoutez au moins un article.');
  const cfg=await configuration(db),zone=cfg.zones.find(z=>z.id===b.zone&&z.enabled&&z.confirmed!==false);if(!zone)fail('Sélectionnez une zone de livraison vérifiée et active.');
  const selected=[],seen=new Set();for(const line of b.items){str(line.id);if(seen.has(line.id))fail('Variante répétée.');seen.add(line.id);num(line.qty,20);if(line.qty<1)fail('Quantité invalide.');const p=await q(db,'SELECT v.*,p.name,p.eur,p.xof,p.active,p.demo,p.revision,p.merchandising,p.costs FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?',line.id).first();if(!p||!p.active||p.demo||p.stock<line.qty)fail('Article indisponible ou stock insuffisant.',409);selected.push({...p,qty:line.qty,price:effectivePrice(p,zone.currency)})}
  for(let i=0;i<selected.length;i++){const override=b.items[i].price;if(override!==undefined&&override!==null){const price=num(override);if(price!==selected[i].price){selected[i].catalogPrice=selected[i].price;selected[i].price=price}}}
  const shipping=b.shipping===undefined?zone.fee:num(b.shipping),subtotal=selected.reduce((sum,p)=>sum+p.price*p.qty,0),total=subtotal+shipping,created=new Date().toISOString(),id='MC-'+crypto.randomUUID().toUpperCase();
  const payment=b.payment===undefined?'manual':str(b.payment);if(!['manual','cod','wave','orange_money','card','paypal','cash','transfer'].includes(payment))fail('Moyen de paiement invalide.');if(b.paid!==undefined&&typeof b.paid!=='boolean')fail('État du paiement invalide.');
  const address=str(b.address||'',0,500),postalCode=str(b.postalCode||'',0,20);if(address&&address.length<8)fail('Précisez suffisamment l’adresse.');if(address&&zone.country==='FR'&&!/^\d{5}$/.test(postalCode))fail('Code postal français requis.');
  const details={source,socialOrder:true,firstName:str(b.firstName||'',0,50),lastName:str(b.lastName||'',0,50),city:str(b.city||'',0,100),neighborhood:str(b.neighborhood||'',0,100),postalCode,deliveryMode:address?'address':'whatsapp',whatsappContact:phone,note:str(b.note||'',0,500),statusChangedAt:created,priceOverrides:selected.filter(p=>p.catalogPrice!==undefined).map(p=>({variantId:p.id,catalogPrice:p.catalogPrice,price:p.price})),...(b.paid?{paymentDeclaredAt:created}:{} )};
  const status=address?'Nouvelle':'Adresse à confirmer';
  const statements=[q(db,'INSERT INTO orders(id,user_id,request_key,customer,phone,address,country,zone,currency,subtotal,shipping,total,demo,created,details,status,payment,tracking_code,paid) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,owner,key,customerName,phone,address,zone.country,zone.name,zone.currency,subtotal,shipping,total,0,created,JSON.stringify(details),status,payment,crypto.randomUUID().replace(/-/g,'').toUpperCase(),b.paid?1:0),q(db,'INSERT INTO order_events(id,order_id,status,note,created) VALUES(?,?,?,?,?)',crypto.randomUUID(),id,status,'Commande saisie manuellement depuis '+SOCIAL_SOURCES[source]+'.'+(b.paid?' Paiement intégral déclaré reçu.':''),created)];
  for(const p of selected){statements.push(q(db,'UPDATE variants SET stock=stock-? WHERE id=? AND stock>=?',p.qty,p.id,p.qty));statements.push(q(db,"INSERT INTO products(id,name,category,description,eur,xof,image,created) SELECT ?, '', '', '', -1, 0, '', '' WHERE changes()=0",crypto.randomUUID()));statements.push(q(db,'INSERT INTO order_lines(id,order_id,variant_id,name,size,color,quantity,price,costs) VALUES(?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),id,p.id,p.name,p.size,p.color,p.qty,p.price,JSON.stringify(parseCosts(p.costs)[zone.currency]||{})))}
  for(const pid of new Set(selected.map(p=>p.product_id)))statements.push(q(db,'UPDATE products SET revision=revision+1 WHERE id=?',pid));
  try{await db.batch(statements)}catch{fail('Le stock a changé. Actualisez puis réessayez.',409)}return reply(await orderDetail(db,id,true),201);
 }
 const proofMatch=path.match(/^\/api\/admin\/order\/([^/]+)\/proof$/);
 if(proofMatch&&req.method==='GET'){
  const o=await orderDetail(db,decodeURIComponent(proofMatch[1]),true),proof=o?.details?.proof;if(!o||!proof?.key||!proof.key.startsWith('order-proofs/'+o.id+'/'))fail('Preuve introuvable.',404);
  const object=await env.BUCKET.get(proof.key);if(!object)fail('Preuve introuvable.',404);const name=String(proof.name||'preuve').replace(/["\r\n]/g,'_');return new Response(object.body,{headers:{'content-type':proof.type,'content-disposition':'inline; filename="'+name+'"','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
 }
 if(proofMatch&&req.method==='POST'){
  const id=decodeURIComponent(proofMatch[1]),o=await orderDetail(db,id,true);if(!o)fail('Commande introuvable.',404);
  const type=req.headers.get('content-type')||'',allowed=['image/jpeg','image/png','image/webp','application/pdf'];if(!allowed.includes(type))fail('Ajoutez une image JPEG, PNG, WebP ou un PDF.');if(Number(req.headers.get('content-length')||0)>5000000)fail('Preuve limitée à 5 Mo.',413);
  const bytes=new Uint8Array(await req.arrayBuffer());if(!bytes.length||bytes.length>5000000)fail('Preuve limitée à 5 Mo.',413);const head=new TextDecoder().decode(bytes.slice(0,12));const valid=type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:type==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78:type==='image/webp'?head.slice(0,4)==='RIFF'&&head.slice(8,12)==='WEBP':head.startsWith('%PDF-');if(!valid)fail('Le fichier ne correspond pas au format annoncé.');
  let name='preuve.'+(type==='application/pdf'?'pdf':type.split('/')[1]);try{name=decodeURIComponent(req.headers.get('x-file-name')||name)}catch{}name=str(name,1,120).replace(/[\\/]/g,'_');const created=new Date().toISOString(),key='order-proofs/'+id+'/'+crypto.randomUUID(),details={...o.details,proof:{key,name,type,created}};
  await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type},customMetadata:{originalName:name}});const result=await q(db,'UPDATE orders SET details=?,revision=revision+1 WHERE id=? AND revision=?',JSON.stringify(details),id,o.revision).run();if(!result.meta.changes){await env.BUCKET.delete?.(key);fail('Commande modifiée : rechargez avant de joindre la preuve.',409)}if(o.details.proof?.key)await env.BUCKET.delete?.(o.details.proof.key);return reply({proof:{name,type,created}},201);
 }
 if(path==='/api/admin/settings'&&req.method==='PUT'){
  const b=await json(req);const current=await configuration(db);const value=JSON.stringify(validateSettings({...b,colors:b.colors??current.colors,checkout:b.checkout??current.checkout,payments:b.payments??current.payments}));if(b.revision!==current.revision)fail('Les réglages ont changé. Rechargez avant de sauvegarder.',409);
  if(current.revision===0){try{await q(db,'INSERT INTO settings(id,data,revision) VALUES(1,?,1)',value).run()}catch{fail('Réglages modifiés simultanément.',409)}}
  else{const r=await q(db,'UPDATE settings SET data=?, revision=revision+1 WHERE id=1 AND revision=?',value,b.revision).run();if(!r.meta.changes)fail('Réglages modifiés simultanément.',409)}return reply({ok:true});
 }
 if(path==='/api/admin/image'&&req.method==='POST'){
  const contentType=req.headers.get('content-type')||'';if(!['image/jpeg','image/png','image/webp'].includes(contentType))fail('Photo JPEG, PNG ou WebP requise.');
  if(Number(req.headers.get('content-length')||0)>5000000)fail('Photo limitée à 5 Mo.',413);
  const bytes=new Uint8Array(await req.arrayBuffer());if(bytes.length>5000000)fail('Photo limitée à 5 Mo.',413);
  const valid=contentType==='image/jpeg'?bytes[0]===255&&bytes[1]===216:contentType==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78: new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';if(!valid)fail('Le fichier ne correspond pas à une photo valide.');
  const key='products/'+crypto.randomUUID();await env.BUCKET.put(key,bytes,{httpMetadata:{contentType}});return reply({image:'/media/'+key},201);
 }
 if(path==='/api/admin/product'&&req.method==='POST'){
  const b=await json(req),id=b.id?str(b.id):crypto.randomUUID(),name=str(b.name),description=str(b.description,0,3000),category=str(b.category);if(!CATEGORIES.includes(category))fail('Catégorie inconnue.');
  const eur=num(b.eur),xof=num(b.xof);
  if(!Array.isArray(b.variants)||b.variants.length<1||b.variants.length>100)fail('Ajoutez au moins une taille/couleur.');
  const old=await q(db,'SELECT * FROM products WHERE id=?',id).first();if(b.id&&!old)fail('Produit introuvable.',404);if(old&&b.revision!==old.revision)fail('Produit modifié : rechargez avant de sauvegarder.',409);
  const images=b.images===undefined?(old?storedImages(old):(b.image?[b.image]:[])):b.images;
  if(!Array.isArray(images)||images.length>8||new Set(images).size!==images.length||images.some(url=>typeof url!=='string'||!/^\/media\/products\/[a-f0-9-]{36}$/.test(url)))fail('Ajoutez jusqu’à 8 photos importées distinctes.');
  const raw=b.merchandising??(old?JSON.parse(old.merchandising||'{}'):{});
  const merchandising={isNew:!!raw.isNew,featured:!!raw.featured,promoEUR:raw.promoEUR??null,promoXOF:raw.promoXOF??null,...(raw.restocking?{restocking:true}:{})};
  for(const [key,base] of [['promoEUR',eur],['promoXOF',xof]])if(merchandising[key]!==null){num(merchandising[key]);if(merchandising[key]>=base)fail('Le prix promotionnel doit être inférieur au prix habituel.');}
  const costsJSON=JSON.stringify(validateCosts(b.costs??(old?parseCosts(old.costs):{})));
  const oldInformation=old?JSON.parse(old.merchandising||'{}').information||{}:{};
  const information=raw.information===undefined?oldInformation:raw.information;
  if(!information||typeof information!=='object'||Array.isArray(information))fail('Informations produit invalides.');
  const cleanInformation=Object.fromEntries(['composition','care','sizing','delivery'].map(k=>[k,str(information[k]||'',0,2000)]));
  if(Object.values(cleanInformation).some(Boolean))merchandising.information=cleanInformation;
  const merchandisingJSON=JSON.stringify(merchandising);
  const image=images[0]||'',imagesJSON=JSON.stringify(images);
  const seen=new Set();const rows=b.variants.map(v=>{const size=str(v.size,1,30),color=str(v.color,1,60),key=size+'|'+color;if(seen.has(key))fail('Taille/couleur en double.');seen.add(key);return {size,color,stock:num(v.stock,100000)}});
  // Every stock mutation increments the product revision; a guard insert forces a rollback on a concurrent edit.
  const statements=[];
  if(old){statements.push(q(db,'UPDATE products SET name=?,category=?,description=?,eur=?,xof=?,image=?,images=?,merchandising=?,costs=?,active=?,revision=revision+1 WHERE id=? AND revision=?',name,category,description,eur,xof,image,imagesJSON,merchandisingJSON,costsJSON,b.active?1:0,id,b.revision));
   statements.push(q(db,"INSERT INTO products(id,name,category,description,eur,xof,image,active,demo,revision,created) SELECT ?, '', '', '', -1, 0, '', 0, 0, 1, '' WHERE changes()=0",crypto.randomUUID()));
   statements.push(q(db,'UPDATE variants SET stock=0 WHERE product_id=?',id));
  }else statements.push(q(db,'INSERT INTO products(id,name,category,description,eur,xof,image,images,merchandising,costs,active,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,name,category,description,eur,xof,image,imagesJSON,merchandisingJSON,costsJSON,b.active?1:0,new Date().toISOString()));
  for(const v of rows)statements.push(q(db,'INSERT INTO variants(id,product_id,size,color,stock) VALUES(?,?,?,?,?) ON CONFLICT(product_id,size,color) DO UPDATE SET stock=excluded.stock',crypto.randomUUID(),id,v.size,v.color,v.stock));
  try{await db.batch(statements)}catch{fail('Modification concurrente : rechargez puis réessayez.',409)}return reply({id},old?200:201);
 }
 if(path==='/api/admin/demo'&&req.method==='POST'){
  const existing=await q(db,"SELECT id FROM products WHERE id='demo-amara'").first();if(existing)return reply({ok:true});
  await db.batch([q(db,"INSERT INTO products(id,name,category,description,eur,xof,image,active,demo,created) VALUES('demo-amara','Robe Amara — démonstration','Robes','Article fictif pour tester le parcours. À remplacer par votre catalogue.',6500,42500,'',1,1,?)",new Date().toISOString()),q(db,"INSERT INTO variants(id,product_id,size,color,stock) VALUES('demo-amara-m','demo-amara','M','Bordeaux',5)"),q(db,"INSERT INTO variants(id,product_id,size,color,stock) VALUES('demo-amara-l','demo-amara','L','Bordeaux',3)")]);return reply({ok:true},201);
 }
 if(path==='/api/admin/test-data'&&req.method==='DELETE'){
  const b=await json(req),ids=Array.isArray(b.ids)?[...new Set(b.ids.map(id=>str(id)))]:[];
  if(!ids.length||ids.length>50)fail('Sélection de commandes d’essai invalide.');
  const statements=[],removed=[],restored=[];
  for(const id of ids){
   const order=await orderDetail(db,id,true);if(!order)fail('Commande d’essai introuvable.',404);
   const isTest=order.demo===1||order.customer.trim().toLowerCase()==='test'||order.details?.paymentTest===true;
   if(!isTest)fail('Suppression refusée : cette commande n’est pas identifiée comme un essai.',409);
   const mustRestore=order.demo===0&&!cancelledOrder(order);
   if(mustRestore)for(const line of order.lines){statements.push(q(db,'UPDATE variants SET stock=stock+? WHERE id=?',line.quantity,line.variant_id));restored.push({variantId:line.variant_id,quantity:line.quantity});}
   if(mustRestore)statements.push(q(db,'UPDATE products SET revision=revision+1 WHERE id IN (SELECT product_id FROM variants WHERE id IN (SELECT variant_id FROM order_lines WHERE order_id=?))',order.id));
   statements.push(q(db,'DELETE FROM order_events WHERE order_id=?',order.id),q(db,'DELETE FROM order_lines WHERE order_id=?',order.id),q(db,'DELETE FROM orders WHERE id=?',order.id));removed.push(order.id);
  }
  await db.batch(statements);return reply({ok:true,removed,restored});
 }
 if(path==='/api/admin/test-catalogue'&&req.method==='DELETE'){
  return reply(await cleanupConfirmedTestCatalogue(db,env));
 }
 if(path==='/api/favorites'&&req.method==='POST'){
  if(!user)fail('Connectez-vous pour enregistrer vos favoris.',401);const b=await json(req);str(b.id);if(!await q(db,'SELECT id FROM products WHERE id=? AND active=1',b.id).first())fail('Produit introuvable.',404);
  if(b.selected)await q(db,'INSERT OR IGNORE INTO favorites(id,user_id,product_id) VALUES(?,?,?)',crypto.randomUUID(),user,b.id).run();else await q(db,'DELETE FROM favorites WHERE user_id=? AND product_id=?',user,b.id).run();return reply({ok:true});
 }
 if(path==='/api/orders'&&req.method==='GET'){
  if(!user)fail('Connexion requise.',401);return reply({orders:(await q(db,'SELECT id,user_id,customer,country,currency,total,status,paid,demo,created FROM orders WHERE user_id=? ORDER BY created DESC LIMIT 200',user).all()).results});
 }
 if(path.startsWith('/api/order/')&&req.method==='GET'){
  if(!user)fail('Connexion requise.',401);const o=await orderDetail(db,path.split('/').pop(),admin);if(!o||(!admin&&o.user_id!==user))fail('Commande introuvable.',404);return reply(o);
 }
 if(path==='/api/orders'&&req.method==='POST'){
  const b=await json(req),key=str(b.key,10,100);
  if(!user&&!(typeof b.guestAccess==='string'&&/^[a-f0-9]{64}$/.test(b.guestAccess)))fail('Rechargez le récapitulatif pour commander sans compte.');
  const owner=user||'guest:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(b.guestAccess)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const duplicate=await q(db,'SELECT id FROM orders WHERE user_id=? AND request_key=?',owner,key).first();if(duplicate)return reply(await orderDetail(db,duplicate.id));
  const customer=str(b.customer,2,100),phone=str(b.phone,6,30),address=b.deliveryMode==='whatsapp'?'':str(b.address,8,500);if(!/^[+\d\s().-]+$/.test(phone)||phone.replace(/\D/g,'').length<6)fail('Numéro de téléphone invalide.');
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)fail('Panier invalide.');
  const cfg=await configuration(db),zone=cfg.zones.find(z=>z.id===b.zone&&z.enabled&&z.confirmed!==false);if(!zone)fail('Sélectionnez une zone de livraison vérifiée et active.');const method=paymentMethods(zone.country,cfg.payments,zone).find(m=>m.id===b.payment);if(!method)fail('Ce moyen de paiement n’est pas disponible pour cette zone.');const paymentTest=method.online&&method.test;if(method.online&&!paymentTest)fail('Ce paiement en ligne n’est pas encore activé.');
  const rules=checkoutRules(cfg);if(!rules.enabled)fail('Les commandes sont temporairement suspendues.');
  if(b.settingsRevision!==cfg.revision)fail('Les conditions de commande ont changé. Revenez au sac pour les actualiser.',409);
  if(b.reviewConfirmed!==true)fail('Vérifiez le récapitulatif avant de confirmer.');
  let details;try{details=contactDetails(b,zone.country,{...rules,zoneNeighborhood:zone.coversNeighborhood?zone.name:''})}catch(e){fail(e.message)}
  details.confirmationMessage=rules.confirmationMessage;if(paymentTest){details.paymentTest=true;details.paymentMethod=b.payment}
  const selected=[],seen=new Set();for(const line of b.items){str(line.id);if(seen.has(line.id))fail('Variante répétée.');seen.add(line.id);num(line.qty,20);if(line.qty<1)fail('Quantité invalide.');const p=await q(db,'SELECT v.*,p.name,p.category,p.eur,p.xof,p.active,p.demo,p.revision,p.merchandising,p.costs FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?',line.id).first();if(!p||!p.active||p.stock<line.qty)fail('Stock insuffisant : actualisez le panier.',409);if(p.demo&&!admin)fail('Les articles de démonstration ne sont pas à vendre.');selected.push({...p,qty:line.qty,price:effectivePrice(p,zone.currency)})}
  const quote=promotionQuote(selected,cfg,zone.currency,zone.fee,zone.country),subtotal=quote.subtotal,total=quote.total;if(quote.savings)details.pricing={regularSubtotal:quote.regularSubtotal,productDiscount:quote.productDiscount,shippingBase:quote.shippingBase,shippingDiscount:quote.shippingDiscount,applied:quote.applied.map(x=>({id:x.id,title:x.title,discount:x.discount}))};if(subtotal<(zone.currency==='EUR'?rules.minimumEUR:rules.minimumXOF))fail('Le minimum de commande hors livraison n’est pas atteint.');if(b.total!==total||b.currency!==zone.currency)fail('Le prix ou la livraison a changé. Actualisez avant de confirmer.',409);
  const id='MC-'+crypto.randomUUID().toUpperCase(),created=new Date().toISOString(),demo=selected.some(p=>p.demo)||paymentTest?1:0;const statements=[q(db,'INSERT INTO orders(id,user_id,request_key,customer,phone,address,country,zone,currency,subtotal,shipping,total,demo,created,details,status,payment,paid,tracking_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,owner,key,customer,phone,address,zone.country,zone.name,zone.currency,subtotal,quote.shipping,total,demo,created,JSON.stringify(details),details.deliveryMode==='whatsapp'?'Adresse à confirmer':'Nouvelle',b.payment,paymentTest?1:0,crypto.randomUUID().replace(/-/g,'').toUpperCase())];
  statements.push(q(db,'INSERT INTO order_events(id,order_id,status,note,created) VALUES(?,?,?,?,?)',crypto.randomUUID(),id,details.deliveryMode==='whatsapp'?'Adresse à confirmer':'Nouvelle','Commande enregistrée',created));
  for(const p of selected){if(!demo)statements.push(q(db,'UPDATE variants SET stock=stock-? WHERE id=?',p.qty,p.id));statements.push(q(db,'INSERT INTO order_lines(id,order_id,variant_id,name,size,color,quantity,price,costs) VALUES(?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),id,p.id,p.name,p.size,p.color,p.qty,p.price,JSON.stringify(parseCosts(p.costs)[zone.currency]||{})))}
  if(!demo)for(const pid of new Set(selected.map(p=>p.product_id))){const revision=selected.find(p=>p.product_id===pid).revision;statements.push(q(db,'UPDATE products SET revision=revision+1 WHERE id=? AND revision=? AND active=1',pid,revision));statements.push(q(db,"INSERT INTO products(id,name,category,description,eur,xof,image,created) SELECT ?, '', '', '', -1, 0, '', '' WHERE changes()=0",crypto.randomUUID()))}
  if(paymentTest)statements.push(q(db,'INSERT INTO order_events(id,order_id,status,note,created) VALUES(?,?,?,?,?)',crypto.randomUUID(),id,'Nouvelle','Paiement '+method.label+' simulé avec succès — aucun argent encaissé.',created));
  statements.push(q(db,"INSERT INTO products(id,name,category,description,eur,xof,image,created) SELECT ?, '', '', '', -1, 0, '', '' WHERE NOT EXISTS(SELECT 1 FROM settings WHERE id=1 AND revision=?)",crypto.randomUUID(),cfg.revision));
  try{await db.batch(statements)}catch{const retry=await q(db,'SELECT id FROM orders WHERE user_id=? AND request_key=?',owner,key).first();if(retry)return reply(await orderDetail(db,retry.id));fail('Le stock a changé. Actualisez le panier.',409)}return reply(await orderDetail(db,id),201);
 }
 if(path==='/api/admin/order'&&req.method==='PATCH'){
  const b=await json(req);const old=await orderDetail(db,str(b.id),true);if(!old)fail('Commande introuvable.',404);
  const transitions=ORDER_TRANSITIONS;
  if(b.status!==old.status&&!transitions[old.status]?.includes(b.status))fail('Transition de statut non autorisée.');
  const paid=b.paid?1:0;
  if(cancelledOrder({status:b.status})&&(paid||old.paid))fail('Une commande encaissée doit être traitée avant rejet ou annulation.');
  const note=str(b.note||'',0,500),correctionReason=b.costCorrectionReason===undefined?'':str(b.costCorrectionReason,5,300),corrections=[];if(b.status==='Rejetée'&&old.status!=='Rejetée'&&!note)fail('Indiquez le motif du rejet, visible par le client.');
  if(b.expectedStatus!==undefined&&(b.expectedStatus!==old.status||b.expectedPaid!==old.paid))fail('Commande modifiée : rechargez avant de sauvegarder.',409);
  if(b.expectedRevision!==undefined&&b.expectedRevision!==old.revision)fail('Commande modifiée : rechargez avant de sauvegarder.',409);
  const deliveryCost=b.delivery_cost===undefined?old.delivery_cost:b.delivery_cost;if(deliveryCost!==null)num(deliveryCost);if(old.delivery_cost!=null&&deliveryCost!==old.delivery_cost){if(!correctionReason)fail('Utilisez « Corriger une saisie » et indiquez le motif.');corrections.push({field:'delivery',from:old.delivery_cost,to:deliveryCost});}
  let address=old.address,details=old.details;
  if(old.status==='Adresse à confirmer'&&['Nouvelle','Validée'].includes(b.status)){address=str(b.address,8,500);const postalCode=str(b.postalCode||'',old.country==='FR'?5:0,20);if(old.country==='FR'&&!/^\d{5}$/.test(postalCode))fail('Code postal français requis.');details={...details,postalCode,addressConfirmedAt:new Date().toISOString()};}
  if(b.status==='Adresse à confirmer'&&paid)fail('Confirmez la livraison avant de marquer le paiement encaissé.');
  if(b.status!==old.status){const now=new Date().toISOString();details={...details,statusChangedAt:now,...(details.reminder?{reminder:{...details.reminder,resolved:now}}:{})};}
  const statements=[q(db,'UPDATE orders SET status=?,paid=?,address=?,details=?,delivery_cost=?,revision=revision+1 WHERE id=? AND status=? AND paid=? AND revision=?',b.status,paid,address,JSON.stringify(details),deliveryCost,old.id,old.status,old.paid,old.revision),q(db,"INSERT INTO products(id,name,category,description,eur,xof,image,created) SELECT ?, '', '', '', -1, 0, '', '' WHERE changes()=0",crypto.randomUUID())];
  if(b.lineCosts!==undefined){
   if(!Array.isArray(b.lineCosts)||!b.lineCosts.length||b.lineCosts.length>old.lines.length)fail('Coûts produits invalides.');
   const known=new Map(old.lines.map(l=>[l.id,l])),seen=new Set();
   for(const change of b.lineCosts){const id=str(change.id);if(seen.has(id)||!known.has(id))fail('Article de commande invalide.');seen.add(id);const line=known.get(id),costs=parseCosts(line.costs),next={...costs};let changed=false;
    for(const key of ['purchase','transport'])if(change[key]!==undefined){num(change[key]);if(costs[key]!=null&&change[key]!==costs[key]){if(!correctionReason)fail('Utilisez « Corriger une saisie » et indiquez le motif.');corrections.push({field:key,lineId:id,from:costs[key],to:change[key]});}if(costs[key]!==change[key]){next[key]=change[key];changed=true;}}
    if(changed)statements.push(q(db,'UPDATE order_lines SET costs=? WHERE id=? AND order_id=?',JSON.stringify(next),id,old.id));
   }
  }
  if(correctionReason){if(!corrections.length)fail('Aucune valeur n’a été modifiée.');details={...details,internalCostCorrections:[...(details.internalCostCorrections||[]),{created:new Date().toISOString(),reason:correctionReason,changes:corrections}]};statements.push(q(db,'UPDATE orders SET details=? WHERE id=?',JSON.stringify(details),old.id));}
  if(cancelledOrder({status:b.status})&&!cancelledOrder(old)){for(const l of old.lines)statements.push(q(db,'UPDATE variants SET stock=stock+? WHERE id=?',l.quantity,l.variant_id));statements.push(q(db,'UPDATE products SET revision=revision+1 WHERE id IN (SELECT product_id FROM variants WHERE id IN (SELECT variant_id FROM order_lines WHERE order_id=?))',old.id))}
  if(b.status!==old.status||paid!==old.paid||note||(b.lineCosts!==undefined&&!correctionReason))statements.push(q(db,'INSERT INTO order_events(id,order_id,status,note,created) VALUES(?,?,?,?,?)',crypto.randomUUID(),old.id,b.status,note||(b.lineCosts!==undefined?'Coûts internes manquants complétés':paid!==old.paid?'État du paiement mis à jour':'Statut mis à jour'),new Date().toISOString()));
  try{await db.batch(statements)}catch{fail('Commande modifiée simultanément. Rechargez.',409)}return reply({ok:true});
 }
 if(path==='/api/admin/return'&&req.method==='PATCH'){
  const b=await json(req),o=await orderDetail(db,str(b.id),true);if(!o)fail('Commande introuvable.',404);return reply(await manageReturn(db,o,b));
 }
 fail('Route introuvable.',404);
}
export default {
 async fetch(req,env){try{
  const path=new URL(req.url).pathname;
  if(path.startsWith('/api/auth/'))return await customerAuthApi(req,env);
  if(path.startsWith('/api/'))return await handleApi(req,env);
  if(path.startsWith('/media/products/')&&req.method==='GET'){const object=await env.BUCKET.get(path.slice(7));if(!object)return new Response('Photo introuvable',{status:404});return new Response(object.body,{headers:{'content-type':object.httpMetadata.contentType,'cache-control':'public, max-age=86400','x-content-type-options':'nosniff'}})}
  if(!['GET','HEAD'].includes(req.method))return new Response('Méthode refusée',{status:405});
  const asset=STATIC_ASSETS[path==='/'||path==='/admin'?'/index.html':path];if(!asset)return new Response('Page introuvable',{status:404});
  return new Response(req.method==='HEAD'?null:Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0)),{headers:{'content-type':asset.type,'cache-control':path.startsWith('/assets/')?'public,max-age=86400':'no-cache','x-content-type-options':'nosniff','referrer-policy':'same-origin','content-security-policy':"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"}});
 }catch(error){return reply({error:error.status?error.message:'Une erreur est survenue. Réessayez sans vider votre panier.'},error.status||500)}}
};
