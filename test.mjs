import {filterCatalogue,visibleBadges,cartAdditionError} from './storefront.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import worker from './worker.mjs';
import {ORDER_TRANSITIONS,cancelledOrder,refundedOrder,financeSummary,orderFigures,activityReport,managementRisks} from './operations.mjs';
import {activityPDF,activityWorkbook} from './reports.mjs';
import ExcelJS from 'exceljs';
import {receiptPDF} from './receipt.mjs';
import { checkoutRules, contactDetails, cartSummary, effectivePrice, productBadges, productMarginPreview, orderWhatsappLink, whatsappDigits, paymentMethods, promotionQuote, productOffer } from './commerce.mjs';
import {STANDARD_SIZES,DEFAULT_COLORS,paletteFor,stockDraft,selectedVariants,availableVariant,variantKey} from './variants.mjs';
import {cancellationWindow,returnWindow} from './operations.mjs';

test('Annulation cliente : 24 heures, paiement et expédition contrôlés',()=>{
 const created='2026-09-01T12:00:00Z',o={created,status:'Préparation',paid:0};
 assert.equal(cancellationWindow(o,Date.parse(created)+86400000-1).eligible,true);
 assert.equal(cancellationWindow(o,Date.parse(created)+86400000).eligible,false);
 for(const status of ['Expédiée','En livraison','Livrée','Rejetée','Annulée'])assert.equal(cancellationWindow({...o,status},Date.parse(created)+1000).eligible,false);
 assert.equal(cancellationWindow({...o,paid:1},Date.parse(created)+1000).eligible,false);
});
test('Retours : 14 jours France et 10 jours ouvrables Côte d’Ivoire',()=>{
 const friday='2026-09-04T12:00:00Z',events=[{status:'Livrée',created:friday}];
 assert.equal(returnWindow({status:'Livrée',country:'FR',events,details:{}},Date.parse(friday)+14*86400000).eligible,true);
 assert.equal(returnWindow({status:'Livrée',country:'FR',events,details:{}},Date.parse(friday)+14*86400000+1).eligible,false);
 const ci=returnWindow({status:'Livrée',country:'CI',events,details:{}},Date.parse('2026-09-18T12:00:00Z'));
 assert.equal(ci.eligible,true);assert.equal(ci.deadline,'2026-09-18T12:00:00.000Z');
});
test('Retour suivi : demande cliente, validation, réception et stock restitué une seule fois',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v),'client')).data;
 for(const status of ['Validée','Préparation','Expédiée','En livraison','Livrée'])assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status,paid:status==='Livrée'})).status,200);
 const body={reason:'Taille inadaptée',condition:'Non portée, étiquette présente',confirmed:true};
 assert.equal((await t.call('/api/order/'+o.id+'/return','POST',body,'client')).status,200);
 assert.equal((await t.call('/api/order/'+o.id+'/return','POST',body,'client')).status,409);
 let current=(await t.call('/api/order/'+o.id,'GET',null,'client')).data;assert.equal(current.returnPolicy.request.status,'Demandé');
 assert.equal((await t.call('/api/admin/return','PATCH',{id:o.id,action:'approve',note:'Retour accepté'})).status,200);
 assert.equal((await t.call('/api/admin/return','PATCH',{id:o.id,action:'receive',note:'Article contrôlé'})).status,200);
 assert.equal(t.sqlite.prepare('SELECT stock FROM variants WHERE id=?').get(t.v.id).stock,2);
 assert.equal((await t.call('/api/admin/return','PATCH',{id:o.id,action:'receive',note:'Double réception'})).status,409);
 assert.equal((await t.call('/api/admin/return','PATCH',{id:o.id,action:'refund',note:'Remboursé'})).status,200);
 current=(await t.call('/api/order/'+o.id,'GET',null,'client')).data;assert.equal(current.returnPolicy.request.status,'Remboursé');
});
test('Commande sans compte : secret, idempotence, suivi et annulation sans double restitution',async()=>{
 const t=await ready(),body={...order(t.v),guestAccess:'a'.repeat(64)};
 const r=await t.call('/api/orders','POST',body,null);assert.equal(r.status,201);const o=r.data;
 assert.equal((await t.call('/api/orders','POST',body,null)).data.id,o.id);
 assert.equal((await t.call('/api/orders','POST',{...body,guestAccess:'court'},null)).status,400);
 assert.equal((await t.call('/api/order/'+o.id,'GET',null,'other')).status,404);
 const auth={code:o.tracking_code,phone:o.phone};
 assert.equal((await t.call('/api/tracking','POST',{...auth,phone:'12345678',cancel:true},null)).status,404);
 assert.equal((await t.call('/api/tracking','POST',{...auth,cancel:true},null)).status,200);
 assert.equal((await t.call('/api/tracking','POST',{...auth,cancel:true},null)).status,200);
 const current=(await t.call('/api/tracking','POST',auth,null)).data;
 assert.equal(current.status,'Annulée');assert.equal(current.cancellation.eligible,false);assert.equal(current.events.filter(e=>e.status==='Annulée').length,1);
 assert.equal(t.sqlite.prepare('SELECT stock FROM variants WHERE id=?').get(t.v.id).stock,t.v.stock);
 assert.equal(current.lines[0].costs,undefined);assert.equal(current.user_id,undefined);
});
test('Annulation cliente : refus hors délai, tiers et commande encaissée',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v),'client')).data,path='/api/order/'+o.id+'/cancel';
 assert.equal((await t.call(path,'POST',{},'other')).status,404);
 t.sqlite.prepare('UPDATE orders SET created=? WHERE id=?').run(new Date(Date.now()-25*3600000).toISOString(),o.id);
 assert.equal((await t.call(path,'POST',{},'client')).status,409);
 t.sqlite.prepare('UPDATE orders SET created=?,paid=1 WHERE id=?').run(new Date().toISOString(),o.id);
 assert.equal((await t.call(path,'POST',{},'client')).status,409);
 assert.equal(t.sqlite.prepare('SELECT stock FROM variants WHERE id=?').get(t.v.id).stock,t.v.stock-1);
});
test('Alertes : une note récente ne remet pas le compteur de statut à zéro',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v),'client')).data;
 await t.call('/api/admin/order','PATCH',{id:o.id,status:'Validée',paid:false});
 const old=new Date(Date.now()-73*3600000).toISOString();
 t.sqlite.prepare('UPDATE orders SET details=? WHERE id=?').run(JSON.stringify({...o.details,statusChangedAt:old}),o.id);
 await t.call('/api/admin/order','PATCH',{id:o.id,status:'Validée',paid:false,note:'Appel récent'});
 const rows=(await t.call('/api/admin/orders')).data.orders;
 assert.equal(managementRisks(rows).stalled.length,1);assert.equal((await t.call('/api/admin/notifications')).data.count,0);
 assert.equal((await t.call('/api/order/'+o.id,'GET',null,'client')).data.reminder.eligible,true);
});
test('Pages dédiées : adresse, retour et aucun dialogue ouvert',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const nodes=new Map(),make=()=>({classList:{toggle(){},add(){},remove(){}},addEventListener(){},setAttribute(){},focus(){this.focused=true},append(child){nodes.set('#'+child.id,child)},remove(){nodes.delete('#'+this.id)}});
 const get=s=>{if(s==='#recordView')return nodes.get(s)||null;if(!nodes.has(s))nodes.set(s,make());return nodes.get(s)};
 const location={pathname:'/admin',hash:'#orders'};let scroll;
 const context={document:{querySelector:get,querySelectorAll:()=>[],createElement:make,body:make()},localStorage:{getItem(){}},location,history:{pushState(a,b,url){location.hash=url}},window:{scrollY:450,scrollTo(x,y){scroll=y}},Intl,setTimeout(){}};
 runInNewContext(source+"\nshowRecord('<h2>Commande</h2>','commande','MC-123','Détail');this.savedReturn=recordReturn;",context);
 assert.equal(location.hash,'#commande/MC-123');assert.equal(get('#adminContent').hidden,true);assert.equal(get('#dialog').open,undefined);assert.match(get('#recordView').innerHTML,/href="#orders"/);assert.equal(context.savedReturn.scroll,450);assert.equal(scroll,0);
 assert.equal(get('#recordView').className,'record-page record-commande');
 runInNewContext('leaveRecord()',context);assert.equal(get('#recordView'),null);assert.equal(get('#adminContent').hidden,false);
});
test('Onglets produit : sélection clavier, saisie préservée et champ invalide révélé',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const tabs=['presentation','prix','visibilite'].map(id=>({dataset:{productTab:id},setAttribute(k,v){this[k]=v},click(){this.onclick()},focus(){}})),panels=tabs.map(t=>({dataset:{productPanel:t.dataset.productTab}})),listeners={};
 const form={querySelectorAll:s=>s==='[data-product-tab]'?tabs:panels,addEventListener:(k,f)=>listeners[k]=f},stub={addEventListener(){}};
 const context={document:{querySelector:s=>s==='#productForm'?form:stub,querySelectorAll:()=>[]},localStorage:{getItem(){}},Intl,setTimeout(){}};
 runInNewContext(source+'\nmountProductInformationFields=()=>{};mountProductTabs()',context);
 assert.equal(panels[0].hidden,false);assert.equal(panels[1].hidden,true);
 tabs[0].onkeydown({key:'ArrowRight',preventDefault(){}});assert.equal(panels[1].hidden,false);assert.equal(tabs[1]['aria-selected'],'true');
 listeners.invalid({target:{closest:()=>panels[2]}});assert.equal(panels[2].hidden,false);
});
test('Formulaire produit : trois panneaux complets hors navigation, sauvegarde branchée',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const node={addEventListener(){},elements:{promoEUR:{},promoXOF:{}}};
 const context={document:{querySelector:()=>node,querySelectorAll:()=>[]},localStorage:{getItem(){}},Intl,setTimeout(){}};
 runInNewContext(source+`\nshowRecord=(html,kind)=>{this.html=html;this.kind=kind};mountProductTabs=()=>{};mountVariantEditor=()=>()=>[];mountPhotoEditor=()=>({});mountProductMargins=()=>{};management={products:[]};editProduct();`,context);
 assert.equal(context.kind,'edition');assert.equal(typeof node.onsubmit,'function');
 assert.match(context.html,/<\/nav><section role="tabpanel"/);
 for(const id of ['presentation','prix','visibilite'])assert.equal((context.html.match(new RegExp('id="panel-'+id+'"','g'))||[]).length,1);
 for(const name of ['name','category','description','eur','xof','active','restocking'])assert.equal((context.html.match(new RegExp('name="'+name+'"','g'))||[]).length,1);
});
test('Nouvelle commande : le clic construit réellement les cinq étapes sans dépendance au checkout',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0],node={addEventListener(){}},context={document:{querySelector:()=>node,querySelectorAll:()=>[]},localStorage:{getItem(){}},Intl,PAYMENT_LABELS:{cod:'Paiement à la livraison'},setTimeout(){}};
 runInNewContext(source+`\nmanagement={settings:{zones:[{id:'ci',name:'Abidjan',country:'CI',currency:'XOF',enabled:true,fee:2500}]},products:[]};showRecord=html=>{this.formHtml=html;throw new Error('FORM_READY')};try{openSocialOrder()}catch(e){this.result=e.message}`,context);
 assert.equal(context.result,'FORM_READY');for(const text of ['name="firstName"','name="lastName"','name="phone"','name="address"','name="payment"','name="proof"','id="entrySave"','data-entry-panel="4"'])assert.ok(context.formHtml.includes(text),text);
});
test('Cartes commandes mobiles : traitement, paiement et prochaine action restent lisibles',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const node={addEventListener(){}};const context={document:{querySelector:()=>node,querySelectorAll:()=>[]},localStorage:{getItem(){}},Intl,setTimeout(){},cancelledOrder,refundedOrder};
 runInNewContext(source+`\nthis.html=mobileOrderCards([{id:'MC-123',created:'2026-09-01',status:'Préparation',currency:'EUR',total:2400,country:'FR',lines:[{name:'<robe>',size:'M',color:'Noir',quantity:2,price:1000,costs:{purchase:400}}],figures:{delivery:300,margin:1300}}]);`,context);
 for(const text of ['Traitement','À expédier','Paiement','À encaisser','PROCHAINE ACTION','Remettre au livreur','2 article(s)','data-order="MC-123"'])assert.ok(context.html.includes(text));
 assert.ok(!context.html.includes('<robe>'));
});
const ORIGIN='https://macourashop.faroucks.chatgpt.site';
test('Confirmation directe : adresse vérifiée obligatoire et stock réservé une seule fois',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v,{deliveryMode:'whatsapp',whatsappContact:'+2250779922982',address:''}),'client')).data;
 assert.equal(o.status,'Adresse à confirmer');
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Validée',paid:false})).status,400);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Validée',paid:false,address:'Adresse confirmée à Abidjan'})).status,200);
 assert.equal((await t.call('/api/order/'+o.id,'GET',null,'client')).data.status,'Validée');
});
test('Menu Collection : liens verticaux, sélection, fermeture et recherche réinitialisée',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const nodes=new Map(),get=s=>{if(!nodes.has(s))nodes.set(s,{classList:{toggle(){}},addEventListener(){}});return nodes.get(s)};
 const listeners={},menus=[0,1].map(()=>{const a={dataset:{collection:'Jupes'},hash:'#catalogue?collection=Jupes',setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]}},summary={focus(){this.focused=true}},list={};return {open:false,a,summary,list,events:{},querySelector:s=>s==='summary'?summary:list,querySelectorAll:()=>[a],addEventListener(k,fn){this.events[k]=fn},contains(target){return target===a||target===summary}}});
 const context={document:{querySelector:get,querySelectorAll:s=>s==='.collection-menu'?menus:s==='[data-collection]'?menus.map(m=>m.a):[],addEventListener:(k,f)=>listeners[k]=f},localStorage:{getItem(){}},Intl,URLSearchParams,setTimeout(){},location:{pathname:'/',hash:'#catalogue?collection=Jupes'}};
 runInNewContext(source+"\nshowRecord=show;mountDetailGallery=()=>{};bindProductCards=()=>{};"+"\nsearch='introuvable';favoritesOnly=true;applyCollectionRoute();mountCollectionMenus();this.selected=category;this.query=search;this.favs=favoritesOnly;route=()=>{this.routed=true};",context);
 assert.equal(context.selected,'Jupes');assert.equal(context.query,'');assert.equal(context.favs,false);assert.equal(menus[0].a['aria-current'],'true');
 assert.equal((menus[0].list.innerHTML.match(/data-collection=/g)||[]).length,8);assert.match(menus[0].list.innerHTML,/Toutes les collections/);
 menus[0].open=true;menus[0].a.onclick();assert.equal(menus[0].open,false);assert.equal(context.routed,true);
 menus[0].open=true;menus[0].events.keydown({key:'Escape'});assert.equal(menus[0].open,false);assert.equal(menus[0].summary.focused,true);
 menus[1].open=true;listeners.pointerdown({target:{}});assert.equal(menus[1].open,false);
});
test('Traitement gérant : les boutons sont branchés et valident réellement la commande',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v),'client')).data;
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const nodes=new Map(),node=()=>({classList:{toggle(){}},addEventListener(){}}),get=s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)};
 const buttons=['Validée','Rejetée','Annulée'].map(status=>({dataset:{nextStatus:status},disabled:false})),save={disabled:false},err={textContent:''};
 const f={dataset:{},elements:{status:{value:o.status},paid:{checked:false},note:{value:'',focus(){}},deliveryCost:{value:''}},querySelector:()=>err,querySelectorAll:()=>[...buttons,save],requestSubmit(){this.pending=this.onsubmit({preventDefault(){}})}};
 nodes.set('#statusForm',f);nodes.set('#saveOrderFields',save);
 const context={document:{querySelector:get,querySelectorAll:s=>s==='[data-next-status]'?buttons:[]},localStorage:{getItem(){}},Intl,setTimeout(){},ORDER_TRANSITIONS,cancelledOrder,refundedOrder,orderFigures,location:{hash:''},o,call:t.call};
 runInNewContext(source+"\nshowRecord=show;mountDetailGallery=()=>{};bindProductCards=()=>{};"+"\napi=async(path,method,body)=>{const r=await call(path,method,body);if(r.status>=400)throw Error(r.data.error);return r.data};refreshAdmin=async()=>{};viewOrder=async id=>{this.opened=id};toast=()=>{};bindOrderWorkflow(o);this.html=orderControls(o);",context);
 buttons[1].onclick();assert.match(err.textContent,/motif/);assert.equal(f.pending,undefined);
 buttons[0].onclick();await f.pending;
 assert.equal((await t.call('/api/order/'+o.id,'GET',null,'client')).data.status,'Validée');assert.equal(context.opened,o.id);
 assert.match(context.html,/Valider la commande/);assert.match(context.html,/ACTION À EFFECTUER/);assert.doesNotMatch(context.html,/<select name="status"/);
 save.onclick();assert.equal(f.elements.status.value,o.status);
});
test('Relances : seuil 72 h, confidentialité, unicité, notifications et résolution',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v),'client')).data;
 const endpoint='/api/order/'+o.id+'/reminder';
 assert.equal((await t.call(endpoint,'POST',{},'other')).status,404);
 assert.equal((await t.call(endpoint,'POST',{},'client')).status,409);
 const details={...o.details,statusChangedAt:new Date(Date.now()-73*3600000).toISOString()};
 t.sqlite.prepare('UPDATE orders SET details=? WHERE id=?').run(JSON.stringify(details),o.id);
 assert.equal((await t.call(endpoint,'POST',{},'client')).status,200);
 assert.equal((await t.call(endpoint,'POST',{},'client')).status,409);
 assert.equal((await t.call('/api/admin/orders')).data.orders[0].reminderActive,true);
 assert.equal((await t.call('/api/admin/notifications')).data.count,1);
 let current=(await t.call('/api/order/'+o.id,'GET',null,'client')).data;
 assert.equal(current.reminder.active,true);assert.equal(current.lines[0].costs,undefined);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Validée',paid:false})).status,200);
 current=(await t.call('/api/order/'+o.id,'GET',null,'client')).data;
 assert.equal(current.reminder.active,false);assert.equal(current.reminder.days,0);
 assert.equal((await t.call('/api/admin/notifications')).data.count,0);
 assert.equal((await t.call(endpoint,'POST',{},'client')).status,409);
});
test('Relance via téléphone/code et reçu final seulement livré et payé',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v),'client')).data;
 t.sqlite.prepare('UPDATE orders SET details=? WHERE id=?').run(JSON.stringify({...o.details,statusChangedAt:new Date(Date.now()-4*86400000).toISOString()}),o.id);
 const receipt='/api/order/'+o.id+'/receipt';
 const r=(await t.call(receipt,'POST',{},'client')).data;
 assert.equal((await t.call('/api/tracking','POST',{phone:o.phone,code:r.tracking_code,remind:true},null)).status,200);
 assert.equal((await t.call(receipt,'POST',{type:'final'},'client')).status,400);
 for(const status of ['Validée','Préparation','Expédiée','En livraison','Livrée'])assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status,paid:false})).status,200);
 assert.equal((await t.call(receipt,'POST',{type:'final'},'client')).status,400);
 await t.call('/api/admin/order','PATCH',{id:o.id,status:'Livrée',paid:true});
 const final=await t.call(receipt,'POST',{type:'final'},'client');assert.equal(final.status,200);assert.equal(final.data.document_type,'final');assert.equal(final.data.delivery_cost,undefined);
 assert.equal((await t.call('/api/order/'+o.id+'/reminder','POST',{},'client')).status,409);
});
test('Régression : les boutons Détails / Paramètres et Modifier sont branchés pour chaque produit',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const node=()=>({classList:{toggle(){}},addEventListener(){},showModal(){this.open=true},dataset:{}});
 const params=[{...node(),dataset:{productParams:'p1'}},{...node(),dataset:{productParams:'p2'}}],edits=[{...node(),dataset:{edit:'p1'}},{...node(),dataset:{edit:'p2'}}];
 const lists={'[data-product-params]':params,'[data-edit]':edits},nodes=new Map(),get=s=>{if(lists[s])return lists[s][0];if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)};
 const context={document:{querySelector:get,querySelectorAll:s=>lists[s]||[]},localStorage:{getItem(){}},Intl,setTimeout(){},ORDER_TRANSITIONS,cancelledOrder,refundedOrder,orderFigures,effectivePrice,STANDARD_SIZES,DEFAULT_COLORS,location:{hash:''}};
 runInNewContext(source+"\nshowRecord=show;mountDetailGallery=()=>{};bindProductCards=()=>{};"+"\nmanagement={products:[{id:'p1',name:'Robe A',category:'Robes',eur:5000,xof:30000,variants:[],costs:{EUR:{purchase:1200,transport:100}}},{id:'p2',name:'Jupe B',category:'Jupes',eur:4000,xof:25000,variants:[]}],settings:{zones:[]}};section='products';renderAdmin();editProduct=id=>{this.edited=id};",context);
 for(const button of params)assert.equal(typeof button.onclick,'function');
 params[0].onclick();assert.match(get('#dialogContent').innerHTML,/Robe A/);assert.match(get('#dialogContent').innerHTML,/Prix d’achat/);assert.match(get('#dialogContent').innerHTML,/12,00/);
 params[1].onclick();assert.match(get('#dialogContent').innerHTML,/Jupe B/);
 edits[1].onclick();assert.equal(context.edited,'p2');
 get('#editFromParameters').onclick();assert.equal(context.edited,'p2');
});
test('Liste commandes : localisation et prix de chaque article accessibles sans ouvrir',async()=>{
 const t=await ready();
 await t.call('/api/admin/product','POST',{...product,id:t.p.id,revision:t.p.revision,costs:{XOF:{purchase:10000,transport:2000}}});
 const other=(await t.call('/api/admin/product','POST',{...product,name:'Jupe modèle B',category:'Jupes',xof:20000,costs:{XOF:{purchase:8000,transport:1000}}})).data;
 const p2=(await t.call('/api/admin/data')).data.products.find(p=>p.id===other.id);
 const body=order(t.v,{items:[{id:t.v.id,qty:1},{id:p2.variants[0].id,qty:2}],total:85000,city:'Abidjan',neighborhood:'Riviera'});
 const created=await t.call('/api/orders','POST',body,'client');assert.equal(created.status,201);
 await t.call('/api/admin/order','PATCH',{id:created.data.id,status:'Validée',paid:false,delivery_cost:1500});
 const row=(await t.call('/api/admin/orders')).data.orders[0];
 assert.equal(row.lines.length,2);assert.deepEqual(row.lines.map(l=>l.quantity),[1,2]);
 assert.deepEqual(row.lines.map(l=>l.price),[42500,20000]);assert.deepEqual(row.lines.map(l=>l.costs.purchase),[10000,8000]);
 assert.deepEqual(row.location,{city:'Abidjan',neighborhood:'Riviera'});assert.equal(row.figures.margin,53500);
 assert.equal(row.details,undefined);assert.equal(row.tracking_code,undefined);
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const nodes=new Map(),get=s=>{if(!nodes.has(s))nodes.set(s,{classList:{toggle(){}},addEventListener(){}});return nodes.get(s)};
 const context={document:{querySelector:get,querySelectorAll:()=>[]},localStorage:{getItem(){}},Intl,setTimeout(){},ORDER_TRANSITIONS,cancelledOrder,refundedOrder,orderFigures,location:{hash:''},row};
 runInNewContext(source+"\nshowRecord=show;mountDetailGallery=()=>{};bindProductCards=()=>{};"+'\nthis.html=orderTable([row],true);',context);
 for(const label of ['Commande','Cliente / origine','Articles','Total','Traitement','Paiement','Prochaine action','Jupe modèle B','Robe essai','Riviera'])assert.ok(context.html.includes(label),label);
 assert.equal((context.html.match(/data-order=/g)||[]).length,1);
 assert.equal((context.html.match(/rowspan=/g)||[]).length,0);
 assert.equal((context.html.match(/<tr>/g)||[]).length,2);
 assert.equal((context.html.match(/85[\s\u00a0\u202f]000/g)||[]).length,1);
});
test('Vue d’ensemble rétablie et compteurs financiers limités aux indicateurs utiles',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const nodes=new Map(),get=s=>{if(!nodes.has(s))nodes.set(s,{classList:{toggle(){}},addEventListener(){}});return nodes.get(s)};
 const context={document:{querySelector:get,querySelectorAll:()=>[]},localStorage:{getItem(){}},Intl,setTimeout(){},ORDER_TRANSITIONS,cancelledOrder,refundedOrder,orderFigures,managementRisks,location:{hash:''},activityReport};
 await runInNewContext(source+"\nshowRecord=show;mountDetailGallery=()=>{};bindProductCards=()=>{};"+"\nmanagement={products:[],settings:{zones:[]}};api=async()=>activityReport([]);renderOverview(document.querySelector('#adminContent'));",context);
 const html=get('#adminContent').innerHTML;assert.match(html,/Points d’attention/);assert.match(html,/Aucun point d’attention détecté/);assert.match(html,/Commandes en cours/);assert.match(html,/Produits publiés/);assert.match(html,/Rapport & téléchargements/);assert.equal((html.match(/<article>/g)||[]).length,4);for(const removed of ['Dernières commandes','setup-cards','status-counters','activityFilters','reliability-grid'])assert.ok(!html.includes(removed));
 runInNewContext("this.counters=financeCounters({EUR:{orders:2,deliveredSales:5000,received:2000,estimatedResult:null,incomplete:1},XOF:{orders:0,deliveredSales:0,received:0,estimatedResult:0,incomplete:0}});",context);
 assert.equal((context.counters.match(/<article>/g)||[]).length,12);assert.match(context.counters,/Incomplet/);assert.match(context.counters,/Ventes livrées/);
});
test('Finances simplifiées : devise unique, quatre indicateurs, coûts manquants actionnables',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const context={document:{querySelector:()=>({addEventListener(){},classList:{toggle(){}}}),querySelectorAll:()=>[]},localStorage:{getItem(){}},Intl,setTimeout(){},ORDER_TRANSITIONS,cancelledOrder,refundedOrder,orderFigures,managementRisks,location:{hash:''}};
 runInNewContext(source+"\nthis.output=financeWorkspace({EUR:{orders:1,ordered:5000,received:5000,outstanding:0,deliveredSales:5000,purchase:null,transport:null,knownMargin:0,overhead:0,incomplete:1,estimatedResult:null}},'EUR');",context);
 assert.equal((context.output.match(/<article>/g)||[]).length,4);assert.match(context.output,/Calcul en attente/);assert.match(context.output,/montants manquants/);assert.match(context.output,/commande reste modifiable même après livraison/);assert.match(context.output,/id="financeMissingCosts"/);assert.match(context.output,/Comprendre le calcul/);assert.doesNotMatch(context.output,/FCFA|Incomplet/);
 assert.match(source,/id="expenseForm"/);assert.match(source,/renderFinances\(root\)/);assert.match(source,/data-finance-currency/);
});
test('Stock par modèle : sommes exactes, alertes par variante et Catalogue avant Stock',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const context={document:{querySelector:()=>({addEventListener(){},classList:{toggle(){}}}),querySelectorAll:()=>[]},localStorage:{getItem(){}},Intl,setTimeout(){},ORDER_TRANSITIONS,cancelledOrder,refundedOrder,orderFigures,managementRisks,location:{hash:''}};
 runInNewContext(source+"\nthis.grouped=stockModels([{product_id:'a',name:'Robe',physical:8,reserved:2,unusable:1,available:5},{product_id:'a',name:'Robe',physical:1,reserved:1,unusable:0,available:0},{product_id:'b',name:'Robe',physical:2,reserved:0,unusable:0,available:2}]);",context);
 assert.equal(context.grouped.length,2);assert.equal(context.grouped[0].physical,9);assert.equal(context.grouped[0].reserved,3);assert.equal(context.grouped[0].available,5);assert.equal(context.grouped[0].out,1);assert.equal(context.grouped[1].low,1);
 const html=await readFile('index.html','utf8');assert.ok(html.indexOf('data-admin="products"')<html.indexOf('data-admin="stock"'));assert.match(source,/Voir les variantes/);assert.match(source,/openStockDetail\(row,\[row\]\)/);
});
test('Chiffres : quantités, zéro explicite, coût manquant et annulation',()=>{
 const o={subtotal:10000,shipping:500,total:10500,delivery_cost:300,status:'Validée'};
 const lines=[{quantity:2,costs:{purchase:1500,transport:100}},{quantity:1,costs:{purchase:1000,transport:0}}];
 assert.deepEqual(orderFigures(o,lines),{purchase:4000,transport:200,delivery:300,merchandiseMargin:5800,margin:6000});
 assert.equal(orderFigures({...o,delivery_cost:null},lines).margin,null);
 assert.equal(orderFigures(o,[{quantity:1,costs:{purchase:null,transport:0}}]).purchase,null);
 assert.equal(orderFigures({...o,status:'Annulée'},lines).margin,null);
});
test('Gestion fiable : anomalies prioritaires sans double comptage',()=>{
 const now=Date.parse('2026-09-10T12:00:00Z'),old='2026-09-05T12:00:00Z',recent='2026-09-10T10:00:00Z';
 const orders=[
  {id:'n',status:'Nouvelle',created:old,paid:0,demo:0},
  {id:'s',status:'Préparation',created:old,last_event:old,paid:0,demo:0},
  {id:'p',status:'Livrée',created:recent,paid:0,delivery_cost:null,demo:0},
  {id:'x',status:'Livrée',created:old,paid:1,delivery_cost:0,demo:0},
  {id:'d',status:'Nouvelle',created:old,paid:0,demo:1}
 ];
 const products=[{id:'low',active:1,demo:0,variants:[{stock:2}]},{id:'out',active:1,demo:0,variants:[{stock:0}]},{id:'hidden',active:0,demo:0,variants:[{stock:0}]}];
 const r=managementRisks(orders,products,now);
 assert.deepEqual(r.awaiting.map(o=>o.id),['n']);assert.deepEqual(r.stalled.map(o=>o.id),['n','s']);assert.deepEqual(r.payment.map(o=>o.id),['p']);assert.deepEqual(r.deliveryCost.map(o=>o.id),['p']);assert.equal(r.total,3);assert.deepEqual(r.lowStock.map(p=>p.id),['low']);assert.deepEqual(r.outOfStock.map(p=>p.id),['out']);
});
test('Rapport : totaux complets, statuts, devises, filtres et confidentialité',async()=>{
 const t=await ready();
 await t.call('/api/admin/product','POST',{...product,id:t.p.id,revision:t.p.revision,costs:{XOF:{purchase:10000,transport:2000},EUR:{purchase:2000,transport:100}}});
 const a=(await t.call('/api/orders','POST',order(t.v),'client')).data;
 const b=(await t.call('/api/orders','POST',order(t.v,{key:crypto.randomUUID(),currency:'EUR',zone:'fr',total:7000,postalCode:'75001'}),'client')).data;
 assert.ok(b.id);
 t.sqlite.prepare('UPDATE orders SET created=?,status=?,paid=?,delivery_cost=? WHERE id=?').run('2026-09-01T00:00:00.000Z','Livrée',1,1500,a.id);
 t.sqlite.prepare('UPDATE orders SET created=?,status=? WHERE id=?').run('2026-09-30T23:59:59.999Z','Annulée',b.id);
 let result=await t.call('/api/admin/report?from=2026-09-01&to=2026-09-30');assert.equal(result.status,200);let r=result.data;
 assert.equal(r.orders.length,2);assert.equal(r.summaries.XOF.received,45000);assert.equal(r.summaries.EUR.activeTotal,0);
 assert.equal(r.summaries.EUR.statuses.find(s=>s.status==='Annulée').total,7000);
 assert.equal(r.orders.find(o=>o.id===a.id).figures.margin,31500);
 assert.equal(r.orders[0].tracking_code,undefined);assert.equal(r.orders[0].address,undefined);
 assert.equal((await t.call('/api/admin/report?currency=EUR')).data.orders.length,1);
 assert.equal((await t.call('/api/admin/report?paid=paid')).data.orders.length,1);
 assert.equal((await t.call('/api/admin/report?status=Livrée&search='+encodeURIComponent(a.id))).data.orders.length,1);
 assert.equal((await t.call('/api/admin/report?to=2026-08-31')).data.orders.length,0);
 for(const query of ['from=2026-02-30','from=2026-10-01&to=2026-09-01','currency=USD','status=FAUX','paid=yes'])assert.equal((await t.call('/api/admin/report?'+query)).status,400);
 for(const path of ['/api/admin/report','/api/admin/orders'])for(const user of [null,'client'])assert.equal((await t.call(path,'GET',null,user)).status,403);
 assert.equal((await t.call('/api/admin/report','POST',{},'owner')).status,404);
 t.sqlite.prepare('UPDATE orders SET demo=1 WHERE id=?').run(a.id);
 assert.equal((await t.call('/api/admin/report')).data.orders.length,1);
 assert.equal((await t.call('/api/admin/orders')).data.orders.length,2);
 assert.equal((await t.call('/api/admin/orders?realOnly=1')).data.orders.length,1);
});
test('Rapport : aucune troncature silencieuse à 500 commandes',async()=>{
 const t=await ready(),a=(await t.call('/api/orders','POST',order(t.v))).data;
 const sql=t.sqlite.prepare("INSERT INTO orders(id,user_id,request_key,customer,phone,address,country,zone,currency,subtotal,shipping,total,status,paid,demo,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
 for(let i=0;i<501;i++)sql.run('bulk-'+i,'client','key-'+i,'Test synthétique','00000000','Adresse test','CI','Test','XOF',1000,0,1000,'Nouvelle',0,0,'2026-09-01T12:00:00.000Z');
 const r=(await t.call('/api/admin/report')).data;assert.equal(r.orders.length,502);assert.equal(r.summaries.XOF.activeTotal,501000+a.total);
});
test('Exports : Excel typé, formules, filtres et PDF sans données de suivi',async()=>{
 const order={id:'MC-test',created:'2026-09-01T12:00:00Z',customer:'=HYPERLINK("evil")',country:'CI',zone:'Abidjan',currency:'XOF',status:'Livrée',paid:1,subtotal:10000,shipping:500,total:10500,figures:{purchase:4000,transport:200,delivery:300,margin:6000}};
 const report=activityReport([order],{from:'2026-09-01',to:'2026-09-30'},'2026-10-01T12:00:00Z');
 const workbook=activityWorkbook(report),bytes=await workbook.xlsx.writeBuffer(),loaded=new ExcelJS.Workbook();await loaded.xlsx.load(bytes);
 const sheet=loaded.getWorksheet('Commandes XOF');assert.equal(sheet.getCell('C2').value,order.customer);assert.equal(sheet.getCell('C2').type,ExcelJS.ValueType.String);
 assert.equal(sheet.getCell('H2').value,10000);assert.equal(sheet.getCell('N2').value.result,6000);assert.match(sheet.getCell('N2').value.formula,/COUNT/);
 assert.equal(loaded.getWorksheet('Synthèse XOF').getCell('C12').value.result,10500);
 assert.equal(loaded.getWorksheet('Commandes EUR').rowCount,1);
 assert.match(loaded.getWorksheet('Lecture').getCell('B3').value,/2026-09-01/);
 const fonts={regular:(await readFile('assets/receipt-sans.ttf')).toString('base64'),bold:(await readFile('assets/receipt-sans-bold.ttf')).toString('base64')};
 const pdf=activityPDF(report,fonts);assert.equal(pdf.getNumberOfPages(),2);assert.ok(pdf.output().startsWith('%PDF-'));assert.ok(!pdf.output().includes('#suivi?code'));
});
test('Interface : paramètres produits consultables et chiffres réservés au gérant',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const nodes=new Map(),get=s=>{if(!nodes.has(s))nodes.set(s,{classList:{toggle(){}},showModal(){},addEventListener(){},querySelector(){return {}}});return nodes.get(s)};
 const context={document:{querySelector:get,querySelectorAll:()=>[]},localStorage:{getItem(){}},Intl,setTimeout(){},ORDER_TRANSITIONS,cancelledOrder,refundedOrder,orderFigures,effectivePrice,STANDARD_SIZES,DEFAULT_COLORS,location:{hash:''}};
 runInNewContext(source+"\nshowRecord=show;mountDetailGallery=()=>{};bindProductCards=()=>{};"+`
 management={products:[{id:'p',name:'Robe',category:'Robes',active:1,eur:5000,xof:30000,costs:{EUR:{purchase:1000,transport:200}},variants:[]}]};
 productParameters('p');this.params=document.querySelector('#dialogContent').innerHTML;
 this.internal=orderInternalDetails({id:'MC-123',created:'2026-09-01',currency:'EUR',subtotal:5000,shipping:0,total:5000,customer:'Test',country:'FR',status:'Validée',delivery_cost:0,lines:[{name:'Robe',size:'M',color:'Noir',quantity:1,price:5000,costs:{purchase:1000,transport:200}}]});
 this.client=orderTable([{id:'MC-123',created:'2026-09-01',currency:'EUR',total:5000,status:'Validée'}]);
 this.controls=orderControls({currency:'EUR',status:'Validée',lines:[]});
 `,context);
 assert.match(context.params,/Prix d’achat/);assert.match(context.params,/editFromParameters/);assert.match(context.internal,/Livraison remise à la cliente/);assert.match(context.internal,/Transport des articles jusqu’au stock/);assert.match(context.internal,/Corriger une erreur de saisie/);assert.ok(!context.client.includes('Marge estimée'));
 assert.ok(!context.controls.includes('name="purchase'));assert.ok(context.controls.includes('name="deliveryCost"'));
});
test('Bouton Ajouter au sac : choix, clic, persistance et limite de stock',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const nodes=new Map(),storage=new Map(),node=()=>({value:'1',dataset:{},classList:{toggle(){},add(){},remove(){}},addEventListener(){},setAttribute(){},showModal(){this.open=true},close(){this.open=false}});
 const sizes=[node(),node()],colors=[node(),node()];sizes.forEach((n,i)=>n.value=String(i));colors.forEach((n,i)=>n.value=String(i));
 const lists={'[name=shopSize]':sizes,'[name=shopColor]':colors,'[data-gallery]':[]};
 const get=s=>{if(lists[s])return lists[s][0];if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)};
 const context={document:{querySelector:get,querySelectorAll:s=>lists[s]||[]},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout(){},Intl,ORDER_TRANSITIONS,cancelledOrder,location:{hash:''},checkoutRules,contactDetails,cartSummary,effectivePrice,visibleBadges,filterCatalogue,cartAdditionError,productBadges,productOffer,promotionQuote,orderWhatsappLink,whatsappDigits,STANDARD_SIZES,DEFAULT_COLORS,paletteFor,variantKey,stockDraft,selectedVariants,availableVariant};
 runInNewContext(source+"\nshowRecord=show;mountDetailGallery=()=>{};bindProductCards=()=>{};"+"\nerror=t=>document.querySelector('#dialogContent .form-error').textContent=t;state.products=[{id:'p',name:'Robe',category:'Robes',eur:100,xof:1000,variants:[{id:'v',size:'M',color:'Bleu',stock:2},{id:'r',size:'L',color:'Rouge',stock:1}]}];productDetail('p');",context);
 assert.equal(get('#addProduct').textContent,'Choisir ma taille');
 colors[0].onchange();assert.equal(sizes[1].disabled,true);sizes[0].onchange();assert.equal(get('#addProduct').disabled,false);
 get('#quantity').value='2';get('#addProduct').onclick();
 assert.deepEqual(JSON.parse(storage.get('macoura-cart-v2')),[{id:'v',qty:2}]);assert.equal(get('#cartCount').textContent,2);assert.match(get('#bagNotice').innerHTML,/Voir mon panier/);assert.match(get('#bagNotice').innerHTML,/Continuer mes achats/);get('#dismissBagNotice').onclick();assert.equal(get('#bagNotice').hidden,true);
 get('#addProduct').onclick();assert.match(get('#dialogContent .form-error').textContent,/stock/);
 colors[1].onchange();assert.equal(get('#addProduct').textContent,'Choisir ma taille');
});
test('Galerie : création, photo principale, conservation et retrait',async()=>{
 const t=await setup(),images=[1,2,3].map(()=>'/media/products/'+crypto.randomUUID());
 const created=await t.call('/api/admin/product','POST',{...product,images});assert.equal(created.status,201);
 let p=(await t.call('/api/bootstrap')).data.products[0];assert.deepEqual(p.images,images);assert.equal(p.image,images[0]);
 assert.equal((await t.call('/api/admin/product','POST',{...product,id:p.id,revision:p.revision})).status,200);
 p=(await t.call('/api/bootstrap')).data.products[0];assert.deepEqual(p.images,images);
 assert.equal((await t.call('/api/admin/product','POST',{...product,id:p.id,revision:p.revision,images:[images[2],images[0]]})).status,200);
 p=(await t.call('/api/bootstrap')).data.products[0];assert.equal(p.image,images[2]);assert.deepEqual(p.images,[images[2],images[0]]);
 assert.equal((await t.call('/api/admin/product','POST',{...product,id:p.id,revision:p.revision,images:[]})).status,200);
 p=(await t.call('/api/bootstrap')).data.products[0];assert.deepEqual(p.images,[]);assert.equal(p.image,'');
});
test('Galerie : anciennes photos conservées et entrées invalides refusées',async()=>{
 const t=await ready(),image='/media/products/'+crypto.randomUUID();
 t.sqlite.prepare('UPDATE products SET image=? WHERE id=?').run(image,t.p.id);
 assert.deepEqual((await t.call('/api/bootstrap')).data.products[0].images,[image]);
 for(const images of ['bad',[image,image],['https://evil.test/image'],Array.from({length:9},()=>'/media/products/'+crypto.randomUUID())]){
 assert.equal((await t.call('/api/admin/product','POST',{...product,images})).status,400);}
});
async function setup(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of (await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(await readFile('drizzle/'+file,'utf8'));
 const prepare=sql=>({bind(...args){return {sql,args,first:async()=>sqlite.prepare(sql).get(...args)||null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>({meta:{changes:sqlite.prepare(sql).run(...args).changes}})};}});
 const DB={prepare,batch:async statements=>{sqlite.exec('BEGIN');try{const result=statements.map(s=>({meta:{changes:sqlite.prepare(s.sql).run(...s.args).changes}}));sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 const objects=new Map(),BUCKET={put:async(key,bytes,meta={})=>objects.set(key,{bytes:new Uint8Array(bytes),httpMetadata:meta.httpMetadata||{},customMetadata:meta.customMetadata||{}}),get:async key=>{const value=objects.get(key);return value?{body:value.bytes,httpMetadata:value.httpMetadata,customMetadata:value.customMetadata}:null},delete:async key=>objects.delete(key)};
 const env={DB,ADMIN_EMAIL:'owner@example.test',BUCKET};
 const call=async(path,method='GET',body,who='owner',origin=ORIGIN)=>{const headers={origin};if(who){headers['oai-authenticated-user-id']=who;headers['oai-authenticated-user-email']=who==='owner'?'owner@example.test':'client@example.test'}if(body)headers['content-type']='application/json';const res=await worker.fetch(new Request(ORIGIN+path,{method,headers,body:body?JSON.stringify(body):undefined}),env);return {status:res.status,data:await res.json()}};
 const raw=async(path,method,body,headers={},who='owner')=>{const h={origin:ORIGIN,...headers};if(who){h['oai-authenticated-user-id']=who;h['oai-authenticated-user-email']=who==='owner'?'owner@example.test':'client@example.test'}return worker.fetch(new Request(ORIGIN+path,{method,headers:h,body}),env)};
 return {call,raw,sqlite,DB,env,objects};}
const product={name:'Robe essai',category:'Robes',description:'Données synthétiques de test uniquement',eur:6500,xof:42500,image:'',active:true,variants:[{size:'M',color:'Prune',stock:2}]};
const settings={revision:0,zones:[{id:'ci',name:'Zone test',country:'CI',fee:2500,delay:'Délai test',enabled:true,cod:true},{id:'fr',name:'Zone France test',country:'FR',fee:500,delay:'Délai test',enabled:true,cod:true}],social:{}};
test('Suivi : téléphone et code requis, réponse sans adresse ni coûts privés',async()=>{
 const t=await ready(),created=await t.call('/api/orders','POST',order(t.v),'client'),o=created.data;
 assert.match(o.tracking_code,/^[A-F0-9]{32}$/);
 assert.equal((await t.call('/api/tracking','POST',{phone:o.phone,code:o.id},null)).status,404);
 assert.equal((await t.call('/api/tracking','POST',{phone:'+33111111111',code:o.tracking_code},null)).status,404);
 const found=await t.call('/api/tracking','POST',{phone:o.phone,code:o.tracking_code},null);assert.equal(found.status,200);assert.equal(found.data.status,'Nouvelle');
 assert.equal(found.data.address,undefined);assert.equal(found.data.delivery_cost,undefined);assert.equal(found.data.lines[0].costs,undefined);assert.equal(found.data.details.email,undefined);
 assert.equal(found.data.events[0].status,'Nouvelle');
});
test('Suivi : limitation des essais successifs',async()=>{
 const t=await ready();for(let i=0;i<12;i++)assert.equal((await t.call('/api/tracking','POST',{phone:'+33123456789',code:'A'.repeat(32)},null)).status,404);
 assert.equal((await t.call('/api/tracking','POST',{phone:'+33123456789',code:'A'.repeat(32)},null)).status,429);
});
test('Reçu : ancien achat reçoit un code stable, accès tiers refusé',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v),'client')).data;t.sqlite.prepare('UPDATE orders SET tracking_code=NULL WHERE id=?').run(o.id);
 assert.equal((await t.call('/api/order/'+o.id+'/receipt','POST',{},'other')).status,404);
 assert.equal((await t.call('/api/order/'+o.id+'/receipt','POST',{},null)).status,401);
 const a=await t.call('/api/order/'+o.id+'/receipt','POST',{},'client'),b=await t.call('/api/order/'+o.id+'/receipt','POST',{},'client');
 assert.match(a.data.tracking_code,/^[A-F0-9]{32}$/);assert.equal(a.data.tracking_code,b.data.tracking_code);
});
test('Rejet : motif requis, historique enregistré et stock restitué une fois',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v),'client')).data;
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Rejetée',paid:false})).status,400);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Rejetée',paid:false,note:'Destination non desservie'})).status,200);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Rejetée',paid:false})).status,200);
 assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,2);
 const result=(await t.call('/api/order/'+o.id,'GET',null,'client')).data;assert.equal(result.events.at(-1).note,'Destination non desservie');
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Validée',paid:false})).status,400);
});
test('Coûts : privés, figés lorsqu’ils existent et complétables lorsqu’ils manquent',async()=>{
 const t=await ready(),costs={EUR:{purchase:2000,transport:300},XOF:{purchase:10000,transport:2000}};
 await t.call('/api/admin/product','POST',{...product,id:t.p.id,revision:t.p.revision,costs});
 const publicProduct=(await t.call('/api/bootstrap','GET',null,'client')).data.products[0];assert.equal(publicProduct.costs,undefined);
 const o=(await t.call('/api/orders','POST',order(t.v),'client')).data;assert.equal(o.lines[0].costs,undefined);
 let admin=(await t.call('/api/order/'+o.id)).data;assert.deepEqual(admin.lines[0].costs,costs.XOF);
 const p=(await t.call('/api/admin/data')).data.products[0];await t.call('/api/admin/product','POST',{...p,costs:{...costs,XOF:{purchase:9999,transport:0}}});
 assert.deepEqual((await t.call('/api/order/'+o.id)).data.lines[0].costs,costs.XOF);
 const payload={id:o.id,status:'Validée',paid:false,expectedRevision:admin.revision,delivery_cost:1500,lineCosts:[{id:admin.lines[0].id,purchase:11000,transport:2000}]};
 assert.equal((await t.call('/api/admin/order','PATCH',payload,'client')).status,403);
 assert.equal((await t.call('/api/admin/order','PATCH',{...payload,lineCosts:[{id:'foreign',purchase:0,transport:0}]})).status,400);
 assert.equal((await t.call('/api/admin/order','PATCH',payload)).status,400);
 delete payload.lineCosts;
 assert.equal((await t.call('/api/admin/order','PATCH',payload)).status,200);
 assert.equal((await t.call('/api/admin/order','PATCH',payload)).status,409);
 admin=(await t.call('/api/order/'+o.id)).data;assert.equal(admin.delivery_cost,1500);assert.equal(admin.lines[0].costs.purchase,10000);
 assert.equal((await t.call('/api/order/'+o.id,'GET',null,'client')).data.delivery_cost,undefined);
 assert.equal((await t.call('/api/orders','GET',null,'client')).data.orders[0].delivery_cost,undefined);
});
test('Coûts historiques : seuls les montants manquants peuvent être complétés',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v),'client')).data;let admin=(await t.call('/api/order/'+o.id)).data;
 const costs=[{id:admin.lines[0].id,purchase:10000,transport:2000}];
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:o.status,paid:false,expectedRevision:admin.revision,lineCosts:costs})).status,200);
 admin=(await t.call('/api/order/'+o.id)).data;assert.deepEqual(admin.lines[0].costs,{purchase:10000,transport:2000});
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:o.status,paid:false,expectedRevision:admin.revision,lineCosts:[{id:admin.lines[0].id,purchase:9000}]})).status,400);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:o.status,paid:false,expectedRevision:admin.revision,lineCosts:[{id:'foreign',purchase:1}]})).status,400);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:o.status,paid:false,delivery_cost:600,expectedRevision:admin.revision,lineCosts:[{id:admin.lines[0].id,purchase:9000,transport:2000}],costCorrectionReason:'Erreur de saisie corrigée'})).status,200);
 admin=(await t.call('/api/order/'+o.id)).data;assert.equal(admin.delivery_cost,600);assert.equal(admin.lines[0].costs.purchase,9000);assert.equal(admin.details.internalCostCorrections.length,1);assert.equal((await t.call('/api/order/'+o.id,'GET',null,'client')).data.details.internalCostCorrections,undefined);
});
test('Commande livrée : tous les coûts manquants restent complétables en une fois',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v))).data;
 for(const status of ['Validée','Préparation','Expédiée','En livraison','Livrée'])assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status,paid:status==='Livrée'})).status,200);
 let admin=(await t.call('/api/order/'+o.id)).data;assert.equal(admin.delivery_cost,null);assert.equal(admin.lines[0].costs.purchase,null);assert.equal(admin.lines[0].costs.transport,null);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Livrée',paid:true,delivery_cost:3000,expectedStatus:'Livrée',expectedPaid:1,expectedRevision:admin.revision,lineCosts:[{id:admin.lines[0].id,purchase:10000,transport:2000}]})).status,200);
 admin=(await t.call('/api/order/'+o.id)).data;assert.equal(admin.delivery_cost,3000);assert.deepEqual(admin.lines[0].costs,{purchase:10000,transport:2000});assert.equal((await t.call('/api/admin/finances')).data.XOF.incomplete,0);
});
test('Finances : devises séparées, coûts manquants explicites, dépenses annulables',async()=>{
 const t=await ready(),p=t.p;await t.call('/api/admin/product','POST',{...product,id:p.id,revision:p.revision,costs:{XOF:{purchase:10000,transport:2000}}});
 const o=(await t.call('/api/orders','POST',order(t.v))).data;
 for(const status of ['Validée','Préparation','Expédiée','En livraison','Livrée'])assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status,paid:status==='Livrée'})).status,200);
 let f=(await t.call('/api/admin/finances')).data;assert.equal(f.XOF.incomplete,1);assert.equal(f.XOF.estimatedResult,null);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Livrée',paid:true,delivery_cost:2000})).status,200);
 const expense={key:crypto.randomUUID(),currency:'XOF',amount:1000,category:'Publicité',description:'Frais test',spent_on:'2026-09-01'};
 const e=await t.call('/api/admin/expense','POST',expense);assert.equal(e.status,201);assert.equal((await t.call('/api/admin/expense','POST',expense)).data.id,e.data.id);
 f=(await t.call('/api/admin/finances')).data;assert.equal(f.XOF.received,45000);assert.equal(f.XOF.knownMargin,31000);assert.equal(f.XOF.overhead,1000);assert.equal(f.XOF.estimatedResult,30000);assert.equal(f.EUR.received,0);
 await t.call('/api/admin/expense','PATCH',{id:e.data.id});assert.equal((await t.call('/api/admin/finances')).data.XOF.overhead,0);
 assert.equal((await t.call('/api/admin/finances','GET',null,'client')).status,403);
 assert.equal((await t.call('/api/admin/expense','POST',{...expense,key:crypto.randomUUID(),spent_on:'2026-13-90'})).status,400);
});
test('Finances : rejet, démonstration et changement de prix exclus du résultat',()=>{
 const os=[{id:'a',currency:'EUR',status:'Livrée',paid:1,demo:0,total:10000,delivery_cost:500},{id:'b',currency:'EUR',status:'Rejetée',paid:0,demo:0,total:90000},{id:'d',currency:'EUR',status:'Livrée',paid:1,demo:1,total:80000}];
 const f=financeSummary(os,[{order_id:'a',quantity:2,costs:'{"purchase":1000,"transport":100}'}],[],'EUR');assert.equal(f.ordered,10000);assert.equal(f.knownMargin,7300);assert.equal(f.estimatedResult,7300);
});
test('Reçu PDF : code QR et références présents, coûts internes absents',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v),'client')).data,fonts={regular:(await readFile('assets/receipt-sans.ttf')).toString('base64'),bold:(await readFile('assets/receipt-sans-bold.ttf')).toString('base64')};
 const pdf=receiptPDF(o,fonts).output();assert.ok(pdf.startsWith('%PDF-'));assert.ok(pdf.includes('/#suivi?code='+o.tracking_code));assert.ok(!pdf.includes('delivery_cost'));
});
test('Documents : logo original intégré, pagination et garde du reçu final',async()=>{
 const t=await ready(),o=(await t.call('/api/orders','POST',order(t.v),'client')).data;
 const fonts={regular:(await readFile('assets/receipt-sans.ttf')).toString('base64'),bold:(await readFile('assets/receipt-sans-bold.ttf')).toString('base64'),logo:'data:image/png;base64,'+(await readFile('assets/macourashop-logo.png')).toString('base64')};
 const pdf=receiptPDF(o,fonts);
 assert.match(pdf.output(),/\/Subtype \/Image/);assert.equal(pdf.getNumberOfPages(),1);
 const long=receiptPDF({...o,lines:Array.from({length:30},()=>({...o.lines[0],name:'Robe longue avec une description détaillée et une variante en plusieurs mots'}))},fonts);
 assert.ok(long.getNumberOfPages()>1);assert.ok(long.output().includes('/#suivi?code='+o.tracking_code));
 assert.throws(()=>receiptPDF({...o,document_type:'final',status:'Validée',paid:1},fonts),/avant livraison et paiement/);
 const final=receiptPDF({...o,document_type:'final',status:'Livrée',paid:1},fonts);assert.match(final.output(),/\/Subtype \/Image/);
 const html=await readFile('index.html','utf8');assert.equal((html.match(/src="\/assets\/macourashop-logo.png"/g)||[]).length,2);assert.match(html,/<div class="admin-brand"><span>MacouraShop<\/span><\/div>/);
});
async function whatsappReady(){
 const t=await ready(),cfg=(await t.call('/api/bootstrap')).data.settings;
 assert.equal((await t.call('/api/admin/settings','PUT',{...cfg,checkout:{...checkoutRules(cfg),whatsappContactEnabled:true,emailRequired:true}})).status,200);return t;
}
test('WhatsApp : commande sauvegardée sans adresse ni e-mail, avec deux numéros conservés',async()=>{
 const t=await whatsappReady(),body=order(t.v,{settingsRevision:2,deliveryMode:'whatsapp',whatsappContact:'+2250708091011',phone:'+2250102030405',address:'',postalCode:'',email:''});
 const result=await t.call('/api/orders','POST',body,'client');assert.equal(result.status,201);
 assert.equal(result.data.status,'Adresse à confirmer');assert.equal(result.data.address,'');assert.equal(result.data.paid,0);assert.equal(result.data.details.email,'');
 assert.equal(result.data.phone,'+2250102030405');assert.equal(result.data.details.whatsappContact,'2250708091011');assert.match(orderWhatsappLink(result.data,result.data.details.whatsappContact),/^https:\/\/wa.me\/2250708091011\?text=/);
 assert.equal((await t.call('/api/orders','POST',body,'client')).data.id,result.data.id);
 assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,1);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:result.data.id,status:'Préparation',paid:false})).status,400);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:result.data.id,status:'Nouvelle',paid:false})).status,400);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:result.data.id,status:'Nouvelle',address:'Adresse convenue test',paid:false})).status,200);
 const confirmed=(await t.call('/api/order/'+result.data.id)).data;assert.equal(confirmed.address,'Adresse convenue test');assert.ok(confirmed.details.addressConfirmedAt);
});
test('WhatsApp : annulation libère le stock une seule fois',async()=>{
 const t=await whatsappReady(),o=(await t.call('/api/orders','POST',order(t.v,{settingsRevision:2,deliveryMode:'whatsapp',whatsappContact:'+2250708091011',phone:'+2250102030405',address:''}))).data;
 for(let i=0;i<2;i++)assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Annulée',paid:false})).status,200);
 assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,2);
});
test('WhatsApp : aucun numéro de boutique requis, contact dédié et destination obligatoires',async()=>{
 const t=await ready(),cfg=(await t.call('/api/bootstrap')).data.settings;
 assert.equal(checkoutRules(cfg).whatsappContactEnabled,true);
 const base={deliveryMode:'whatsapp',whatsappContact:'+2250708091011',phone:'+2250102030405',address:''};
 for(const extra of [{customer:''},{phone:''},{city:''},{zone:''},{neighborhood:''},{whatsappContact:''},{whatsappContact:'01020304'}]){
 assert.equal((await t.call('/api/orders','POST',order(t.v,{...base,...extra}))).status,400);}
 assert.equal((await t.call('/api/admin/settings','PUT',{...cfg,zones:cfg.zones.map(z=>({...z,coversNeighborhood:true})),checkout:{...checkoutRules(cfg),whatsappContactEnabled:true}})).status,200);
 const result=await t.call('/api/orders','POST',order(t.v,{...base,settingsRevision:2,neighborhood:''}));
 assert.equal(result.status,201);assert.equal(result.data.details.neighborhood,'Zone test');
});
test('WhatsApp : option désactivable sans modifier les autres paramètres',async()=>{
 const t=await ready(),cfg=(await t.call('/api/bootstrap')).data.settings;
 await t.call('/api/admin/settings','PUT',{...cfg,checkout:{...checkoutRules(cfg),whatsappContactEnabled:false}});
 assert.equal((await t.call('/api/orders','POST',order(t.v,{deliveryMode:'whatsapp',whatsappContact:'+2250708091011',address:'',settingsRevision:2}))).status,400);
 assert.equal((await t.call('/api/orders','POST',order(t.v,{settingsRevision:2}))).status,201);
});
test('France sur WhatsApp : code postal demandé seulement lors de confirmation de l’adresse',async()=>{
 const t=await whatsappReady(),result=await t.call('/api/orders','POST',order(t.v,{settingsRevision:2,deliveryMode:'whatsapp',whatsappContact:'+2250708091011',phone:'+33612345678',zone:'fr',currency:'EUR',total:7000,address:'',postalCode:''}));
 assert.equal(result.status,201);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:result.data.id,status:'Nouvelle',address:'Adresse de test',paid:false})).status,400);
 assert.equal((await t.call('/api/admin/order','PATCH',{id:result.data.id,status:'Nouvelle',address:'Adresse de test',postalCode:'75001',paid:false})).status,200);
});
test('Promotions : prix réduits identiques au catalogue et à la commande',async()=>{
 const t=await ready(),m={isNew:true,featured:true,promoEUR:5000,promoXOF:35000};
 assert.equal((await t.call('/api/admin/product','POST',{...product,id:t.p.id,revision:t.p.revision,merchandising:m})).status,200);
 const p=(await t.call('/api/bootstrap')).data.products[0];assert.deepEqual(p.merchandising,m);assert.equal(effectivePrice(p,'XOF'),35000);assert.equal(effectivePrice(p,'EUR'),5000);assert.deepEqual(productBadges(p,'EUR'),['Nouveau','Coup de cœur']);
 assert.equal((await t.call('/api/orders','POST',order(t.v))).status,409);
 const result=await t.call('/api/orders','POST',order(t.v,{total:37500}));assert.equal(result.status,201);assert.equal(result.data.lines[0].price,35000);
});
test('Badges : statuts explicites, badges cumulables et fausses promotions refusées',async()=>{
 const p={...product,merchandising:{isNew:true,featured:true}};
 assert.deepEqual(productBadges(p,'EUR'),['Nouveau','Coup de cœur']);assert.deepEqual(productBadges({...p,variants:[{stock:0}]},'EUR'),['Stock épuisé','Nouveau','Coup de cœur']);
 assert.deepEqual(productBadges({...p,merchandising:{featured:true}},'EUR'),['Coup de cœur']);
 const t=await ready();for(const promoEUR of [6500,7000,-1,1.2])assert.equal((await t.call('/api/admin/product','POST',{...product,merchandising:{promoEUR}})).status,400);
});
test('Réapprovisionnement : persisté, stock prioritaire et commande interdite sans stock',async()=>{
 const t=await ready();
 const merchandising={restocking:true,isNew:true,featured:false,promoEUR:5000,promoXOF:null};
 const saved=await t.call('/api/admin/product','POST',{...product,id:t.p.id,revision:t.p.revision,variants:t.p.variants.map(v=>({...v,stock:0})),merchandising});assert.equal(saved.status,200);
 let p=(await t.call('/api/bootstrap')).data.products[0];assert.equal(p.merchandising.restocking,true);
 assert.deepEqual(productBadges(p,'EUR'),['Réapprovisionnement','Nouveau']);
 assert.deepEqual(productBadges(p,'XOF'),['Réapprovisionnement','Nouveau']);
 assert.equal((await t.call('/api/orders','POST',order(t.v),'client')).status,409);
 assert.equal((await t.call('/api/admin/product','POST',{...product,id:p.id,revision:p.revision,variants:p.variants.map(v=>({...v,stock:3}))})).status,200);
 p=(await t.call('/api/bootstrap')).data.products[0];assert.equal(p.merchandising.restocking,true);assert.ok(!productBadges(p,'EUR').includes('En stock'));
 const css=await readFile('interface.css','utf8');assert.match(css,/\.admin aside \.admin-brand\.brand-logo\{display:none\}/);
 for(const kind of ['stock','soldout','restocking','promo','new','featured'])assert.ok(css.includes('.badge-'+kind+'{'));
});
test('Carrousel : exclut produits du sac et épuisés, ouvre le choix sans vider le brouillon',async()=>{
 const nodes=new Map(),storage=new Map();
 const get=s=>{if(!nodes.has(s))nodes.set(s,{value:'',classList:{toggle(){},add(){},remove(){}},addEventListener(){},append(x){this.child=x},showModal(){},close(){},innerHTML:'',scrollBy(v){this.scrolled=v}});return nodes.get(s)};
 const button={dataset:{recommend:'extra'}},section={querySelectorAll:()=>[button]};
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const context={document:{querySelector:get,querySelectorAll:()=>[],createElement:()=>section},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTimeout(){},Intl,ORDER_TRANSITIONS,cancelledOrder,checkoutRules,contactDetails,cartSummary,effectivePrice,visibleBadges,filterCatalogue,cartAdditionError,productBadges,productOffer,promotionQuote,orderWhatsappLink,whatsappDigits,STANDARD_SIZES,DEFAULT_COLORS,paletteFor,variantKey,stockDraft,selectedVariants,availableVariant};
 const products=[{...product,id:'inbag',variants:[{id:'v',size:'M',color:'Prune',stock:2}]},{...product,id:'extra'},{...product,id:'soldout',variants:[{stock:0}]}];
 runInNewContext(source+"\nshowRecord=show;mountDetailGallery=()=>{};bindProductCards=()=>{};"+"\nstate.products="+JSON.stringify(products)+";cart=[{id:'v',qty:1}];checkoutDraft={city:'Abidjan'};let opened='';productDetail=id=>opened=id;mountRecommendations();",context);
 assert.match(section.innerHTML,/data-recommend="extra"/);assert.doesNotMatch(section.innerHTML,/data-recommend="inbag"|data-recommend="soldout"/);
 button.onclick();assert.equal(runInNewContext("opened",context),'extra');assert.equal(runInNewContext("checkoutDraft.city",context),'Abidjan');
 get('#recommendNext').onclick();assert.equal(get('#recommendTrack').scrolled.left,260);
});
test('Commande : coordonnées complètes conservées et accessibles uniquement au bon compte',async()=>{
 const t=await ready(),extra={deliveryMode:'address',neighborhood:'Quartier test',city:'Abidjan',postalCode:'',email:'cliente@example.test',landmark:'Repère test',note:'Instructions test'};
 const result=await t.call('/api/orders','POST',order(t.v,extra),'client');assert.equal(result.status,201);
 assert.deepEqual(result.data.details,{...extra,confirmationMessage:''});
 assert.equal((await t.call('/api/order/'+result.data.id,'GET',null,'other')).status,404);
 assert.equal((await t.call('/api/order/'+result.data.id)).data.details.email,extra.email);
});
test('Commande : récapitulatif, ville, téléphone et code postal français contrôlés',async()=>{
 const t=await ready();
 for(const extra of [{reviewConfirmed:false},{city:''},{phone:'++++++'},{email:'incorrect'},{zone:'fr',currency:'EUR',total:7000,postalCode:'ABC'}]){
 assert.equal((await t.call('/api/orders','POST',order(t.v,extra),'client')).status,400);}
 assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,2);
});
test('Règles de validation : pause, e-mail et minimum bloquent sans réserver de stock',async()=>{
 for(const rule of [{enabled:false},{emailRequired:true},{minimumXOF:42501}]){
 const t=await ready();const cfg=(await t.call('/api/bootstrap')).data.settings;
 assert.equal((await t.call('/api/admin/settings','PUT',{...cfg,checkout:{...cfg.checkout,...rule}})).status,200);
 assert.equal((await t.call('/api/orders','POST',order(t.v,{settingsRevision:2}),'client')).status,400);
 assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,2);
 }
});
test('Tarifs révisés : anciennes conditions refusées et montant exact accepté',async()=>{
 const t=await ready(),cfg=(await t.call('/api/bootstrap')).data.settings;
 await t.call('/api/admin/settings','PUT',{...cfg,zones:cfg.zones.map(z=>({...z,fee:z.fee+100}))});
 assert.equal((await t.call('/api/orders','POST',order(t.v,{total:45100}),'client')).status,409);
 assert.equal((await t.call('/api/orders','POST',order(t.v,{settingsRevision:2,total:45000}),'client')).status,409);
 assert.equal((await t.call('/api/orders','POST',order(t.v,{settingsRevision:2,total:45100}),'client')).status,201);
});
test('Paiement : désactivation globale et faux moyens en ligne refusés',async()=>{
 const t=await ready(),cfg=(await t.call('/api/bootstrap')).data.settings;
 assert.equal((await t.call('/api/admin/settings','PUT',{...cfg,payments:{cod:true,card:true}})).status,400);
 assert.equal((await t.call('/api/admin/settings','PUT',{...cfg,payments:{cod:false}})).status,200);
 assert.equal((await t.call('/api/orders','POST',order(t.v,{settingsRevision:2}),'client')).status,400);
});
test('Règles conservées lors de modification des livraisons et message figé avec la commande',async()=>{
 const t=await ready(),cfg=(await t.call('/api/bootstrap')).data.settings;
 await t.call('/api/admin/settings','PUT',{...cfg,checkout:{...cfg.checkout,minimumXOF:42500,confirmationMessage:'Message test'}});
 await t.call('/api/admin/settings','PUT',{...settings,revision:2});
 const current=(await t.call('/api/bootstrap')).data.settings;assert.equal(current.checkout.minimumXOF,42500);
 const result=await t.call('/api/orders','POST',order(t.v,{settingsRevision:3}),'client');assert.equal(result.status,201);assert.equal(result.data.details.confirmationMessage,'Message test');
});
test('Résumé du sac : articles retirés, quantités excessives et calculs en centimes',()=>{
 const row={price:1299,qty:2,v:{stock:3}};
 assert.deepEqual(cartSummary([row]),{subtotal:2598,invalid:false});
 for(const rows of [[],[{...row,qty:4}],[{missing:true,qty:1}],[{...row,qty:0}],[{...row,qty:1.5}],[{...row,qty:21,v:{stock:50}}]])assert.equal(cartSummary(rows).invalid,true);
});
test('Campagnes : meilleure offre article, cadeau et livraison sans double remise',()=>{
 const rows=[{product_id:'p1',category:'Robes',price:2000,qty:3,v:{stock:9}}],settings={promotions:[
  {id:'p10',title:'−10 %',type:'product_percent',target:'all',currency:'ALL',active:true,percent:10},
  {id:'lot',title:'2 + 1 offert',type:'buy_get',target:'all',currency:'ALL',active:true,buyQty:2,freeQty:1},
  {id:'port',title:'Livraison offerte',type:'shipping',target:'all',currency:'ALL',active:true,freeShipping:true,minSubtotal:3000,minQty:1,countries:['FR']}
 ]};
 const quote=promotionQuote(rows,settings,'EUR',500,'FR',Date.parse('2026-09-16T12:00:00Z'));
 assert.equal(quote.regularSubtotal,6000);assert.equal(quote.productDiscount,2000);assert.equal(quote.subtotal,4000);assert.equal(quote.shippingDiscount,500);assert.equal(quote.total,4000);assert.equal(quote.lines[0].offer.id,'lot');
});
test('Campagnes : période, seuil et pays sont respectés',()=>{
 const rows=[{product_id:'p1',category:'Bijoux',price:1000,qty:2,v:{stock:9}}],settings={promotions:[
  {id:'future',title:'Future',type:'product_percent',target:'all',currency:'ALL',active:true,percent:50,start:'2026-10-01'},
  {id:'qty',title:'Lot bijoux',type:'quantity_percent',target:'category',category:'Bijoux',currency:'ALL',active:true,percent:15,minQty:2},
  {id:'port',title:'Port CI',type:'shipping',target:'all',currency:'ALL',active:true,freeShipping:true,minSubtotal:1000,minQty:1,countries:['CI']}
 ]};
 const quote=promotionQuote(rows,settings,'EUR',300,'FR',Date.parse('2026-09-16T12:00:00Z'));
 assert.equal(quote.productDiscount,300);assert.equal(quote.shippingDiscount,0);assert.equal(quote.total,2000);
});
test('Campagnes : prix spécial centralisé par produit et devise',()=>{
 const rows=[{product_id:'p1',category:'Robes',price:2500,qty:2,v:{stock:5}}],settings={promotions:[{id:'prix',title:'Prix privilège',type:'fixed_price',target:'products',productIds:['p1'],currency:'ALL',active:true,priceEUR:1900,priceXOF:12000}]};
 const eur=promotionQuote(rows,settings,'EUR',0,'FR');assert.equal(eur.productDiscount,1200);assert.equal(eur.total,3800);assert.equal(productOffer({id:'p1',category:'Robes',eur:2500,xof:16000,variants:[]},settings,'EUR').label,'Prix spécial');
});
test('Audit financier 1/4 : prix normal, prix spécial et arrondis exacts',()=>{
 const product={id:'p1',category:'Robes',eur:2500,xof:16000,merchandising:{promoEUR:1900,promoXOF:12000},variants:[{stock:10}]};
 assert.equal(effectivePrice(product,'EUR'),1900);assert.equal(effectivePrice(product,'XOF'),12000);
 const normal=promotionQuote([{product_id:'p1',category:'Robes',price:2500,qty:2,v:{stock:10}}],{},'EUR',500,'FR');assert.deepEqual([normal.subtotal,normal.shipping,normal.total],[5000,500,5500]);
 const percent=promotionQuote([{product_id:'p1',category:'Robes',price:1299,qty:3,v:{stock:10}}],{promotions:[{id:'p15',title:'15 %',type:'product_percent',target:'all',currency:'EUR',active:true,percent:15}]},'EUR',0,'FR');
 assert.equal(percent.regularSubtotal,3897);assert.equal(percent.productDiscount,585);assert.equal(percent.total,3312);
});
test('Audit financier 2/4 : quantité, 2 + 1 offert et livraison réduite',()=>{
 const row=qty=>[{product_id:'p1',category:'Robes',price:2000,qty,v:{stock:10}}];
 const quantity={promotions:[{id:'q',title:'Quantité',type:'quantity_percent',target:'all',currency:'ALL',active:true,percent:10,minQty:3}]};
 assert.equal(promotionQuote(row(2),quantity,'EUR',0,'FR').total,4000);assert.equal(promotionQuote(row(3),quantity,'EUR',0,'FR').total,5400);
 const bundle={promotions:[{id:'b',title:'2 + 1 offert',type:'buy_get',target:'all',currency:'ALL',active:true,buyQty:2,freeQty:1}]};
 assert.equal(promotionQuote(row(2),bundle,'EUR',0,'FR').total,4000);assert.equal(promotionQuote(row(3),bundle,'EUR',0,'FR').total,4000);assert.equal(promotionQuote(row(6),bundle,'EUR',0,'FR').total,8000);
 const shipping={promotions:[{id:'s',title:'Livraison -40 %',type:'shipping',target:'all',currency:'ALL',active:true,percent:40,minSubtotal:3000,minQty:2,countries:['FR']}]};
 const quote=promotionQuote(row(2),shipping,'EUR',750,'FR');assert.equal(quote.shippingDiscount,300);assert.equal(quote.shipping,450);assert.equal(quote.total,4450);
});
test('Audit financier 3/4 : achat, acheminement, livraison et marge',()=>{
 const o={id:'o1',currency:'EUR',subtotal:10000,shipping:500,total:10500,delivery_cost:300,status:'Livrée',paid:1,demo:0,details:{}};
 const lines=[{order_id:'o1',quantity:2,costs:{purchase:1500,transport:100}},{order_id:'o1',quantity:1,costs:{purchase:1000,transport:0}}];
 assert.deepEqual(orderFigures(o,lines),{purchase:4000,transport:200,delivery:300,merchandiseMargin:5800,margin:6000});
 assert.deepEqual(financeSummary([o],lines,[],'EUR'),{purchase:4000,transport:500,orders:1,ordered:10500,received:10500,outstanding:0,deliveredSales:10500,knownMargin:6000,incomplete:0,overhead:0,estimatedResult:6000});
});
test('Audit financier 4/4 : annulation et remboursement exclus des finances',()=>{
 const base={currency:'EUR',subtotal:10000,shipping:500,total:10500,delivery_cost:300,status:'Livrée',paid:1,demo:0},line=id=>({order_id:id,quantity:1,costs:{purchase:4000,transport:200}});
 const refunded={...base,id:'retour',details:JSON.stringify({returnRequest:{status:'Remboursé'}})},cancelled={...base,id:'annulation',status:'Annulée',paid:0,details:'{}'};
 assert.equal(refundedOrder(refunded),true);assert.equal(orderFigures(refunded,[line('retour')]).margin,null);
 const summary=financeSummary([refunded,cancelled],[line('retour'),line('annulation')],[],'EUR');assert.deepEqual(summary,{purchase:0,transport:0,orders:0,ordered:0,received:0,outstanding:0,deliveredSales:0,knownMargin:0,incomplete:0,overhead:0,estimatedResult:0});
 const report=activityReport([refunded,cancelled],{currency:'EUR'});assert.equal(report.summaries.EUR.activeCount,0);assert.equal(report.summaries.EUR.received,0);
});
for(const deliveryMode of ['address','whatsapp'])test('Parcours client complet sans redirection : '+deliveryMode,async()=>{
 const t=await ready(),nodes=new Map(),storage=new Map(),data={deliveryMode,whatsappContact:'+2250708091011',neighborhood:'Quartier test',customer:'Cliente test',phone:'+2250102030405',email:'client@example.test',country:'CI',zone:'ci',city:'Abidjan',postalCode:'',address:'Adresse fictive test',landmark:'',note:''};
 const get=s=>{if(!nodes.has(s))nodes.set(s,{value:'',querySelector:()=>({value:data.deliveryMode}),querySelectorAll:()=>[],parentElement:{firstChild:{textContent:''}},classList:{toggle(){},add(){},remove(){}},addEventListener(){},setAttribute(){},focus(){},showModal(){},close(){},innerHTML:''});return nodes.get(s)};
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const bootstrap=(await t.call('/api/bootstrap')).data;
 data.payment='cod';
 const context={document:{querySelector:get,querySelectorAll:()=>[]},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},FormData:class{constructor(){return Object.entries(data)}},setTimeout(){},Intl,ORDER_TRANSITIONS,cancelledOrder,crypto,TextEncoder,checkoutRules,contactDetails,cartSummary,effectivePrice,visibleBadges,filterCatalogue,cartAdditionError,productBadges,productOffer,promotionQuote,orderWhatsappLink,whatsappDigits,paymentMethods,PAYMENT_LABELS:{cod:'Paiement à la livraison'},STANDARD_SIZES,DEFAULT_COLORS,paletteFor,variantKey,stockDraft,selectedVariants,availableVariant,fetch:async(path,opts)=>{const result=await t.call(path,opts.method,opts.body?JSON.parse(opts.body):undefined);return {ok:result.status<400,json:async()=>result.data}}};
 runInNewContext(source+"\nshowRecord=show;mountDetailGallery=()=>{};bindProductCards=()=>{};"+"\nstate="+JSON.stringify(bootstrap)+";cart=[{id:"+JSON.stringify(t.v.id)+",qty:1}];checkoutDraft="+JSON.stringify(data)+";checkout();",context);
 get('#deliveryCountry').value='CI';get('#deliveryZone').value='ci';runInNewContext("checkoutDraft.payment='cod'",context);get('#deliveryZone').onchange();
 assert.equal(get('#reviewOrder').disabled,false);
 assert.equal(get('#contactFields').hidden,false);
 assert.equal(get('#addressFields').hidden,deliveryMode!=='address');
 assert.equal(get('#whatsappFields').hidden,deliveryMode!=='whatsapp');
 const selectedMode=data.deliveryMode;data.deliveryMode='';get('#deliveryZone').onchange();assert.equal(get('#contactFields').hidden,false);assert.equal(get('#reviewOrder').disabled,true);data.deliveryMode=selectedMode;get('#deliveryZone').onchange();
 get('#checkoutForm').onsubmit({preventDefault(){}});
 assert.match(get('#bagContent').innerHTML,/Vérifiez votre commande/);
 get('#reviewConfirmed').checked=true;get('#reviewConfirmed').onchange({target:get('#reviewConfirmed')});
 await get('#confirmOrder').onclick();
 assert.equal(t.sqlite.prepare('SELECT count(*) AS n FROM orders').get().n,1);
 assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,1);
 assert.match(get('#bagContent').innerHTML,/COMMANDE ENREGISTRÉE/);
 if(deliveryMode==='whatsapp'){assert.match(get('#bagContent').innerHTML,/2250708091011/);assert.doesNotMatch(get('#bagContent').innerHTML,/wa\.me|Continuer sur WhatsApp/);const o=t.sqlite.prepare('SELECT phone,details FROM orders').get();assert.equal(o.phone,data.phone);assert.equal(JSON.parse(o.details).whatsappContact,'2250708091011');}
 assert.deepEqual(JSON.parse(storage.get('macoura-cart-v2')),[]);
});
async function ready(){const t=await setup();assert.equal((await t.call('/api/admin/settings','PUT',settings)).status,200);assert.equal((await t.call('/api/admin/product','POST',product)).status,201);const data=(await t.call('/api/bootstrap')).data;return {...t,p:data.products[0],v:data.products[0].variants[0]}}
const order=(v,extra={})=>({key:crypto.randomUUID(),customer:'Cliente de test',phone:'+0000000000',address:'Adresse fictive de test',deliveryMode:'address',neighborhood:'Quartier test',city:'Ville test',postalCode:'75001',email:'',landmark:'',note:'',reviewConfirmed:true,settingsRevision:1,zone:'ci',payment:'cod',currency:'XOF',total:45000,items:[{id:v.id,qty:1}],...extra});
async function deliverAndPay(t,id){
 for(const status of ['Validée','Préparation','Expédiée','En livraison','Livrée'])assert.equal((await t.call('/api/admin/order','PATCH',{id,status,paid:status==='Livrée'})).status,200,status);
}
async function returnAndRefund(t,id,user='client'){
 const request={reason:'Taille inadaptée',condition:'Non portée, étiquette présente',confirmed:true};
 assert.equal((await t.call('/api/order/'+id+'/return','POST',request,user)).status,200);
 for(const action of ['approve','receive','refund'])assert.equal((await t.call('/api/admin/return','PATCH',{id,action,note:'Recette avant mise en ligne'})).status,200,action);
}
test('Recette 1/4 : France, adresse complète, livraison, paiement, reçu et retour',async()=>{
 const t=await ready(),created=await t.call('/api/orders','POST',order(t.v,{zone:'fr',currency:'EUR',total:7000,phone:'+33612345678',address:'10 rue de la Recette, Paris',postalCode:'75001'}),'client');
 assert.equal(created.status,201);assert.equal(created.data.shipping,500);assert.equal(created.data.total,7000);assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,1);
 await deliverAndPay(t,created.data.id);
 const receipt=await t.call('/api/order/'+created.data.id+'/receipt','POST',{type:'final'},'client');assert.equal(receipt.status,200);assert.equal(receipt.data.document_type,'final');assert.equal(receipt.data.paid,1);
 await returnAndRefund(t,created.data.id);assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,2);
});
test('Recette 2/4 : France, adresse à préciser, confirmation puis annulation',async()=>{
 const t=await whatsappReady(),created=await t.call('/api/orders','POST',order(t.v,{settingsRevision:2,deliveryMode:'whatsapp',whatsappContact:'+33612345678',phone:'+33612345678',zone:'fr',currency:'EUR',total:7000,address:'',postalCode:''}),'client');
 assert.equal(created.status,201);assert.equal(created.data.status,'Adresse à confirmer');
 assert.equal((await t.call('/api/admin/order','PATCH',{id:created.data.id,status:'Nouvelle',address:'12 avenue de la Recette, Paris',postalCode:'75002',paid:false})).status,200);
 const orderReceipt=await t.call('/api/order/'+created.data.id+'/receipt','POST',{},'client');assert.equal(orderReceipt.status,200);assert.equal(orderReceipt.data.document_type,'order');assert.equal(orderReceipt.data.address,'12 avenue de la Recette, Paris');
 assert.equal((await t.call('/api/order/'+created.data.id+'/cancel','POST',{},'client')).status,200);const current=(await t.call('/api/order/'+created.data.id,'GET',null,'client')).data;
 assert.equal(current.status,'Annulée');assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,2);
});
test('Recette 3/4 : Côte d’Ivoire, paiement à la livraison, reçu et retour',async()=>{
 const t=await ready(),created=await t.call('/api/orders','POST',order(t.v,{phone:'+2250102030405',address:'Rue de la Recette, Abidjan',city:'Abidjan',postalCode:''}),'client');
 assert.equal(created.status,201);assert.equal(created.data.payment,'cod');assert.equal(created.data.shipping,2500);assert.equal(created.data.total,45000);
 await deliverAndPay(t,created.data.id);const receipt=await t.call('/api/order/'+created.data.id+'/receipt','POST',{type:'final'},'client');assert.equal(receipt.status,200);assert.equal(receipt.data.status,'Livrée');assert.equal(receipt.data.paid,1);
 await returnAndRefund(t,created.data.id);assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,2);
});
test('Recette 4/4 : commande hors site, traitement, livraison, paiement et reçu',async()=>{
 const t=await ready(),payload={source:'whatsapp',zone:'ci',customer:'Cliente WhatsApp',phone:'+2250500000000',city:'Abidjan',neighborhood:'Cocody',address:'Rue de la Recette, maison 5',shipping:2500,payment:'cod',paid:false,items:[{id:t.v.id,qty:1}],key:crypto.randomUUID()};
 const created=await t.call('/api/admin/social-order','POST',payload);assert.equal(created.status,201);assert.equal(created.data.details.socialOrder,true);assert.equal(created.data.total,45000);assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,1);
 await deliverAndPay(t,created.data.id);const receipt=await t.call('/api/order/'+created.data.id+'/receipt','POST',{type:'final'});assert.equal(receipt.status,200);assert.equal(receipt.data.document_type,'final');assert.equal(receipt.data.status,'Livrée');assert.equal(receipt.data.paid,1);
 const tracking=await t.call('/api/tracking','POST',{phone:created.data.phone,code:created.data.tracking_code},null);assert.equal(tracking.status,200);assert.equal(tracking.data.status,'Livrée');
});
test('Accès administrateur refusé aux anonymes et autres comptes',async()=>{const t=await setup();assert.equal((await t.call('/api/admin/data','GET',null,null)).status,403);assert.equal((await t.call('/api/admin/product','POST',product,'client')).status,403);assert.equal((await t.call('/api/admin/data')).status,200)});
test('Origine externe refusée pour toute modification',async()=>{const t=await setup();assert.equal((await t.call('/api/admin/product','POST',product,'owner','https://evil.test')).status,403)});
test('Catalogue sauvegardé, variantes et prix EUR/XOF exacts',async()=>{const t=await ready();assert.equal(t.p.eur,6500);assert.equal(t.p.xof,42500);assert.equal(t.v.stock,2);assert.equal((await t.call('/api/bootstrap')).data.products.length,1)});
test('Commande enregistrée, stock décrémenté et idempotence',async()=>{const t=await ready(),b=order(t.v);const created=await t.call('/api/orders','POST',b,'client');assert.equal(created.status,201);assert.equal(created.data.total,45000);assert.equal(created.data.lines.length,1);const duplicate=await t.call('/api/orders','POST',b,'client');assert.equal(duplicate.data.id,created.data.id);assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,1);assert.equal(t.sqlite.prepare('SELECT count(*) AS n FROM orders').get().n,1)});
test('Une cliente ne peut pas lire une autre commande',async()=>{const t=await ready();const created=await t.call('/api/orders','POST',order(t.v),'client');assert.equal((await t.call('/api/order/'+created.data.id,'GET',null,'other')).status,404);assert.equal((await t.call('/api/orders','GET',null,'other')).data.orders.length,0)});
test('Prix falsifié, devise incohérente et zone inconnue refusés',async()=>{const t=await ready();for(const extra of [{total:1},{currency:'EUR'},{zone:'unknown'},{payment:'mobile'}])assert.ok((await t.call('/api/orders','POST',order(t.v,extra),'client')).status>=400);assert.equal(t.sqlite.prepare('SELECT count(*) AS n FROM orders').get().n,0)});
test('Commande EUR conserve les centimes',async()=>{const t=await ready();const result=await t.call('/api/orders','POST',order(t.v,{zone:'fr',currency:'EUR',total:7000}),'client');assert.equal(result.status,201);assert.equal(result.data.total,7000)});
test('Livraison uniquement : prestataires non connectés refusés même avec anciens réglages',async()=>{
 assert.deepEqual(paymentMethods('FR',{}, {cod:true}).map(x=>x.id),['cod']);
 assert.deepEqual(paymentMethods('CI',{wave:true,testMode:true}, {cod:true}).map(x=>x.id),['cod']);
 assert.deepEqual(paymentMethods('FR',{franceCard:true,paypal:true},{cod:false}),[]);
 const t=await ready(),before=t.sqlite.prepare('SELECT stock FROM variants').get().stock;
 const wave=await t.call('/api/orders','POST',order(t.v,{payment:'wave'}),'client');
 assert.equal(wave.status,400);
 assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,before);
 assert.equal((await t.call('/api/admin/report')).data.orders.length,0);
 const paypal=await t.call('/api/orders','POST',order(t.v,{zone:'fr',currency:'EUR',total:7000,payment:'paypal'}),'client');
 assert.equal(paypal.status,400);
});
test('Quantité nulle, négative, excessive et variantes répétées refusées',async()=>{const t=await ready();for(const qty of [0,-1,3,1.5])assert.ok((await t.call('/api/orders','POST',order(t.v,{items:[{id:t.v.id,qty}]}),'client')).status>=400);assert.ok((await t.call('/api/orders','POST',order(t.v,{items:[{id:t.v.id,qty:1},{id:t.v.id,qty:1}]}),'client')).status>=400)});
test('Annulation restitue le stock une seule fois',async()=>{const t=await ready();const o=(await t.call('/api/orders','POST',order(t.v),'client')).data;assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Annulée',paid:false})).status,200);assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,2);assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Annulée',paid:false})).status,200);assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,2)});
test('Statuts respectent préparation → expédition → livraison',async()=>{const t=await ready();const o=(await t.call('/api/orders','POST',order(t.v),'client')).data;assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status:'Livrée',paid:false})).status,400);for(const status of ['Validée','Préparation','Expédiée','En livraison','Livrée'])assert.equal((await t.call('/api/admin/order','PATCH',{id:o.id,status,paid:status==='Livrée'})).status,200)});
test('Édition de produit périmée refusée après réservation de stock',async()=>{const t=await ready();await t.call('/api/orders','POST',order(t.v),'client');const edit=await t.call('/api/admin/product','POST',{...product,id:t.p.id,revision:t.p.revision});assert.equal(edit.status,409)});
test('Modification produit existant et masquage fonctionnels',async()=>{const t=await ready();assert.equal((await t.call('/api/admin/product','POST',{...product,id:t.p.id,revision:t.p.revision,active:false})).status,200);assert.equal((await t.call('/api/bootstrap')).data.products.length,0);assert.equal((await t.call('/api/admin/data')).data.products.length,1)});
test('Concurrence sur stock : au plus deux unités vendues',async()=>{const t=await ready();const results=await Promise.all([1,2,3].map(()=>t.call('/api/orders','POST',order(t.v),'client')));const ok=results.filter(x=>x.status===201).length;assert.ok(ok>=1&&ok<=2);assert.equal(t.sqlite.prepare('SELECT stock FROM variants').get().stock,2-ok);assert.equal(t.sqlite.prepare('SELECT count(*) AS n FROM orders').get().n,ok)});
test('Favoris persistants et séparés entre comptes',async()=>{const t=await ready();assert.equal((await t.call('/api/favorites','POST',{id:t.p.id,selected:true},'client')).status,200);assert.deepEqual((await t.call('/api/bootstrap','GET',null,'client')).data.favorites,[t.p.id]);assert.deepEqual((await t.call('/api/bootstrap')).data.favorites,[])});
test('Zones désactivées et paiement non activé bloquent la commande',async()=>{const t=await ready();await t.call('/api/admin/settings','PUT',{...settings,revision:1,zones:settings.zones.map(z=>({...z,cod:false}))});assert.equal((await t.call('/api/orders','POST',order(t.v),'client')).status,400)});
test('Réglages périmés et liens sociaux dangereux refusés',async()=>{const t=await ready();assert.equal((await t.call('/api/admin/settings','PUT',settings)).status,409);assert.equal((await t.call('/api/admin/settings','PUT',{...settings,revision:1,social:{instagram:'javascript:alert(1)'}})).status,400)});
test('Coordonnées du vendeur validées et publiées dans les conditions',async()=>{const t=await ready(),merchant={legalName:'MacouraShop',address:'10 rue Exemple, Paris',email:'contact@macourashop.fr',phone:'+33 6 00 00 00 00',registration:'SIREN 123 456 789',returnAddress:'10 rue Exemple, 75000 Paris'};assert.equal((await t.call('/api/admin/settings','PUT',{...settings,revision:1,merchant})).status,200);assert.deepEqual((await t.call('/api/bootstrap')).data.settings.merchant,merchant);assert.equal((await t.call('/api/admin/settings','PUT',{...settings,revision:2,merchant:{...merchant,email:'adresse-invalide'}})).status,400)});
test('Articles de démonstration masqués et non vendables aux clientes',async()=>{const t=await setup();await t.call('/api/admin/settings','PUT',settings);await t.call('/api/admin/demo','POST',{});assert.equal((await t.call('/api/bootstrap')).data.products.length,0);const p=(await t.call('/api/admin/data')).data.products[0];assert.equal((await t.call('/api/orders','POST',order(p.variants[0]),'client')).status,400);const o=await t.call('/api/orders','POST',order(p.variants[0]));assert.equal(o.status,201);assert.equal(o.data.demo,1)});
test('Toutes les tailles correspond exactement à XS, S, M, L, XL, XXL',()=>{assert.deepEqual(STANDARD_SIZES,['XS','S','M','L','XL','XXL']);assert.ok(!STANDARD_SIZES.includes('Unique'))});
test('Les combinaisons existantes et leurs stocks sont conservés sans produit cartésien',()=>{const vs=[{size:'M',color:'Bleu',stock:4},{size:'XS',color:'Rouge',stock:3},{size:'L',color:'Vert',stock:2},{size:'XL',color:'Noir',stock:2}];const draft=stockDraft(vs),rows=selectedVariants(['M','XS','L','XL'],['Bleu','Rouge','Vert','Noir'],draft);assert.deepEqual(rows,vs);assert.equal(rows.reduce((s,v)=>s+v.stock,0),11);assert.equal(rows.length,4)});
test('Décocher et recocher une taille conserve la saisie du brouillon',()=>{const draft=stockDraft([{size:'M',color:'Bleu',stock:4}]);assert.deepEqual(selectedVariants([],['Bleu'],draft),[]);assert.equal(selectedVariants(['M'],['Bleu'],draft)[0].stock,4);draft.get(variantKey('M','Bleu')).enabled=false;assert.deepEqual(selectedVariants(['M'],['Bleu'],draft),[])});
test('Les sélections cliente refusent les couples absents ou épuisés',()=>{const vs=[{id:'m',size:'M',color:'Bleu',stock:4},{id:'xs',size:'XS',color:'Rouge',stock:0}];assert.equal(availableVariant(vs,'M','Rouge'),null);assert.equal(availableVariant(vs,'XS','Rouge'),null);assert.equal(availableVariant(vs,'M','Bleu').id,'m')});
test('Une couleur personnalisée existante reste sélectionnable',()=>{const palette=paletteFor(DEFAULT_COLORS,[{color:'Turquoise ancien'},{color:'Turquoise ancien'}]);assert.equal(palette.filter(c=>c.name==='Turquoise ancien').length,1);assert.ok(palette.every(c=>/^#[0-9a-f]{6}$/i.test(c.hex)))});
test('Palette par défaut disponible sans modifier les réglages existants',async()=>{const t=await ready();const cfg=(await t.call('/api/bootstrap')).data.settings;assert.equal(cfg.colors.length,DEFAULT_COLORS.length);assert.equal(cfg.zones[0].fee,2500)});
test('Palette sauvegardée et préservée par une mise à jour des autres réglages',async()=>{const t=await ready();const colors=[{name:'Terracotta',hex:'#bc6543'}];assert.equal((await t.call('/api/admin/settings','PUT',{...settings,revision:1,colors})).status,200);assert.equal((await t.call('/api/admin/settings','PUT',{...settings,revision:2})).status,200);const cfg=(await t.call('/api/bootstrap')).data.settings;assert.deepEqual(cfg.colors,[{name:'Terracotta',hex:'#BC6543'}]);assert.equal(cfg.zones.length,2)});
test('Couleurs doublonnées et codes invalides refusés',async()=>{const t=await ready();for(const colors of [[],[{name:'Bleu',hex:'#123456'},{name:' bleu ',hex:'#987654'}],[{name:'Test',hex:'red;bad'}]])assert.equal((await t.call('/api/admin/settings','PUT',{...settings,revision:1,colors})).status,400)});
test('Réenregistrement du produit préserve les IDs et les stocks des variantes',async()=>{const t=await ready();const result=await t.call('/api/admin/product','POST',{...product,id:t.p.id,revision:t.p.revision,variants:selectedVariants(['M'],['Prune'],stockDraft(t.p.variants))});assert.equal(result.status,200);const p=(await t.call('/api/bootstrap')).data.products[0];assert.equal(p.variants[0].id,t.v.id);assert.equal(p.variants[0].stock,2)});

test('Comptes clients : service absent explicite et aucune inscription simulée',async()=>{
 const t=await setup();const s=await t.call('/api/auth/session','GET',null,null);assert.equal(s.data.configured,false);assert.equal(s.data.customer,null);
 assert.equal((await t.call('/api/auth/signup','POST',{email:'client@example.test',password:'password-long-123',name:'Cliente'},null)).status,503);
});
test('Comptes clients : cookie sécurisé, identité vérifiée, commandes isolées et aucun droit gérant',async()=>{
 const t=await ready(),original=globalThis.fetch;t.env.CUSTOMER_AUTH_URL='https://test.supabase.co';t.env.CUSTOMER_AUTH_PUBLIC_KEY='public-test';t.env.ADMIN_EMAIL='admin@example.test';
 const user=id=>({id,email:'owner@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{name:'Cliente'}});
 globalThis.fetch=async(url,options)=>{if(String(url).includes('/token?'))return Response.json({access_token:'client-one',expires_in:3600,user:user('one')});if(String(url).endsWith('/user')){const token=options.headers.authorization;return token==='Bearer client-one'?Response.json(user('one')):token==='Bearer client-two'?Response.json(user('two')):Response.json({}, {status:401})}return new Response('{}',{status:200})};
 const call=async(path,method='GET',body,token='client-one',origin=ORIGIN)=>{const res=await worker.fetch(new Request(ORIGIN+path,{method,headers:{origin,cookie:'__Host-macoura-client='+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),t.env);return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')}};
 try{
 assert.equal((await call('/api/auth/login','POST',{email:'owner@example.test',password:'1234567'},'')).status,400);
 assert.equal((await call('/api/auth/login','POST',{email:'owner@example.test',password:'123456789012345678901'},'')).status,400);
 const login=await call('/api/auth/login','POST',{email:'owner@example.test',password:'password-long-123'},'');assert.equal(login.status,200);assert.match(login.cookie,/HttpOnly; Secure; SameSite=Lax/);
 assert.equal((await call('/api/admin/data')).status,403);
 const boot=await call('/api/bootstrap');assert.equal(boot.data.admin,false);assert.equal(boot.data.customer.id,'customer:one');
 const created=await call('/api/orders','POST',order(t.v));assert.equal(created.status,201);assert.equal(created.data.user_id,'customer:one');
 assert.equal((await call('/api/order/'+created.data.id,'GET',null,'client-two')).status,404);
 assert.equal((await call('/api/orders','GET',null,'client-two')).data.orders.length,0);
 assert.equal((await call('/api/orders','GET',null,'invalid')).status,401);
 assert.equal((await call('/api/auth/login','POST',{email:'owner@example.test',password:'password-long-123'},'','https://evil.test')).status,403);
 t.env.ADMIN_EMAIL=' owner@example.test ';delete t.env.VERCEL;
 assert.equal((await call('/api/bootstrap')).data.admin,true);assert.equal((await call('/api/admin/data')).status,200);
 assert.match((await call('/api/auth/logout','POST',{})).cookie,/Max-Age=0/);
 }finally{globalThis.fetch=original}
});

test('Catalogue : filtres combinés sur une même variante, promotions et devises',()=>{
 const products=[{id:'a',name:'Robe',category:'Robes',eur:10000,xof:60000,created:'2026-09-01',merchandising:{promoEUR:5000},variants:[{size:'M',color:'Bleu',stock:0},{size:'L',color:'Rouge',stock:3}]},{id:'b',name:'Robe B',category:'Robes',eur:7000,xof:45000,created:'2026-09-02',variants:[{size:'M',color:'Bleu',stock:2}]}];
 assert.deepEqual(filterCatalogue(products,{size:'M',color:'Rouge'},'EUR'),[]);
 assert.deepEqual(filterCatalogue(products,{size:'M',stock:'available'},'EUR').map(p=>p.id),['b']);
 assert.deepEqual(filterCatalogue(products,{max:'55'},'EUR').map(p=>p.id),['a']);
 assert.deepEqual(filterCatalogue(products,{max:'50000'},'XOF').map(p=>p.id),['b']);
 assert.deepEqual(filterCatalogue(products,{sort:'asc'},'EUR').map(p=>p.id),['a','b']);
 assert.deepEqual(filterCatalogue(products,{favorites:['b']},'EUR').map(p=>p.id),['b']);
});
test('Ajout rapide : aucune variante implicite, stock et limite cumulée',()=>{
 assert.ok(cartAdditionError(null,[]));assert.ok(cartAdditionError({id:'a',stock:0},[]));assert.ok(cartAdditionError({id:'a',stock:2},[{id:'a',qty:2}]));assert.equal(cartAdditionError({id:'a',stock:2},[{id:'a',qty:1}]),'');assert.ok(cartAdditionError({id:'a',stock:30},[{id:'a',qty:20}]));
});
test('Badges : disponibilité normale discrète et rupture prioritaire',()=>{
 const p={eur:100,xof:1000,variants:[{stock:0}],merchandising:{isNew:true,featured:true,promoEUR:80}};
 assert.deepEqual(visibleBadges(p,'EUR'),['Stock épuisé','Nouveau']);assert.deepEqual(visibleBadges(p,'XOF'),['Stock épuisé','Nouveau']);
});
test('Informations produit : enregistrées, conservées, effaçables et validées côté serveur',async()=>{
 const t=await setup();let r=await t.call('/api/admin/product','POST',{...product,merchandising:{information:{composition:'100 % coton',sizing:'M : tour de poitrine 92 cm'}}});assert.equal(r.status,201);
 let p=(await t.call('/api/bootstrap')).data.products[0];assert.equal(p.merchandising.information.composition,'100 % coton');
 r=await t.call('/api/admin/product','POST',{...product,id:p.id,revision:p.revision});assert.equal(r.status,200);p=(await t.call('/api/bootstrap')).data.products[0];assert.equal(p.merchandising.information.sizing,'M : tour de poitrine 92 cm');
 r=await t.call('/api/admin/product','POST',{...product,id:p.id,revision:p.revision,merchandising:{information:{care:'x'.repeat(2001)}}});assert.equal(r.status,400);
 r=await t.call('/api/admin/product','POST',{...product,id:p.id,revision:p.revision,merchandising:{information:{}}});assert.equal(r.status,200);p=(await t.call('/api/bootstrap')).data.products[0];assert.equal(p.merchandising.information,undefined);
});
test('Ajout rapide : choix couleur puis taille, une seule unité et refus du dépassement',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split("$('#cartBtn').onclick=openCart;")[0];
 const button=dataset=>({dataset,disabled:false,focus(){},setAttribute(){}});const plus=button({}),close=button({}),change=button({}),err={};let html='';
 const panel={hidden:true,colors:[],sizes:[],set innerHTML(value){html=value;this.colors=[...value.matchAll(/data-quick-color="(\d+)"/g)].map(m=>button({quickColor:m[1]}));this.sizes=[...value.matchAll(/data-quick-size="(\d+)"/g)].map(m=>button({quickSize:m[1]}))},get innerHTML(){return html},querySelector(s){return s==='.quick-close'?close:s==='[data-change-color]'?(html.includes('data-change-color')?change:null):s==='.quick-error'?err:this.colors[0]||this.sizes[0]},querySelectorAll(s){return s==='[data-quick-color]'?this.colors:this.sizes}};
 const card={querySelector:s=>s==='.quick-panel'?panel:plus},stub={addEventListener(){}};
 const context={document:{querySelector:()=>stub,querySelectorAll:s=>s==='.quick-panel'?[panel]:s==='.quick-plus'?[plus]:[]},localStorage:{getItem(){}},Intl,setTimeout(){},cartAdditionError,location:{hash:''},p:{name:'Robe',variants:[{id:'blue',color:'Bleu',size:'M',stock:1},{id:'red',color:'Rouge',size:'L',stock:2}]},card};
 runInNewContext(source+"\nswatch=()=>'';persistCart=()=>{};confirmBagAddition=(p,v,q)=>{this.added=v.id};openQuickChoice(card,p);",context);
 assert.equal(panel.sizes.length,0);assert.equal(context.added,undefined);panel.colors[0].onclick();assert.equal(panel.sizes.length,1);assert.equal(context.added,undefined);panel.sizes[0].onclick();assert.equal(context.added,'blue');assert.equal(panel.hidden,true);
 runInNewContext('openQuickChoice(card,p)',context);panel.colors[0].onclick();assert.match(panel.innerHTML,/dans le panier/);panel.sizes[0].onclick();assert.match(err.textContent,/déjà/);runInNewContext('this.quantity=cart[0].qty',context);assert.equal(context.quantity,1);
});
test('Marge produit : prix normal ou promotion réellement activée et formule exacte',()=>{
 const normal=productMarginPreview({base:3000,promotion:1400,promotionEnabled:false,purchase:1500,transport:200});
 assert.deepEqual(normal,{sale:3000,priceType:'normal',complete:true,margin:1300});
 const promotion=productMarginPreview({base:3000,promotion:1400,promotionEnabled:true,purchase:1500,transport:200});
 assert.deepEqual(promotion,{sale:1400,priceType:'promotion',complete:true,margin:-300});
 const invalidPromotion=productMarginPreview({base:3000,promotion:3500,promotionEnabled:true,purchase:1500,transport:200});
 assert.deepEqual(invalidPromotion,{sale:3000,priceType:'normal',complete:true,margin:1300});
 const incomplete=productMarginPreview({base:3000,promotion:null,promotionEnabled:false,purchase:null,transport:200});
 assert.equal(incomplete.complete,false);assert.equal(incomplete.margin,null);
});
test('Réseaux sociaux : icônes accessibles et uniquement pour les liens configurés',async()=>{
 const source=(await readFile('app.js','utf8')).replace(/^import .*\n/gm,'').split('function renderProducts')[0],top={hidden:true,innerHTML:''},footer={hidden:true,innerHTML:''},stub={value:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){}},nodes={'#socialLinksTop':top,'#socialLinksFooter':footer},context={document:{querySelector:s=>nodes[s]||stub,querySelectorAll:()=>[]},localStorage:{getItem(){}},Intl,setTimeout(){}};
 runInNewContext(source+"\nstate.settings.social={instagram:'https://instagram.com/macoura',facebook:'',whatsapp:'https://wa.me/225000000000'};renderSocial();this.html=document.querySelector('#socialLinksTop').innerHTML;this.footer=document.querySelector('#socialLinksFooter').innerHTML",context);
 assert.equal(top.hidden,false);assert.equal(footer.hidden,false);assert.equal(context.footer,context.html);assert.match(context.html,/social-instagram/);assert.match(context.html,/aria-label="Macourashop sur Instagram"/);assert.match(context.html,/social-whatsapp/);assert.match(context.html,/Contacter Macourashop directement sur WhatsApp/);assert.doesNotMatch(context.html,/social-facebook/);assert.equal((context.html.match(/<svg/g)||[]).length,2);
});
test('Macourashop Gestion : application installable et accès direct privé',async()=>{
 const manifest=JSON.parse(await readFile('manifest.webmanifest','utf8')),html=await readFile('index.html','utf8'),sw=await readFile('service-worker.js','utf8'),source=await readFile('app.js','utf8');
 assert.equal(manifest.name,'Macourashop Gestion');assert.equal(manifest.start_url,'/admin');assert.equal(manifest.display,'standalone');assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'&&icon.purpose.includes('maskable')));
 assert.match(html,/rel="manifest" href="\/manifest\.webmanifest"/);assert.match(html,/apple-touch-icon/);assert.match(html,/id="installManagement"/);assert.match(sw,/url\.pathname\.startsWith\('\/api\/'\)/);assert.doesNotMatch(sw,/cache\.addAll|caches\.open/);
 assert.doesNotMatch(source,/signin-with-chatgpt/);assert.match(source,/function renderAdminLogin/);assert.match(source,/Les comptes clients ne donnent aucun droit de gestion/);assert.match(html,/admin-entry/);
});

test('Recette mobile : iPhone, Android et très petit écran sont protégés',async()=>{
 const html=await readFile('index.html','utf8'),css=await readFile('interface.css','utf8'),source=await readFile('app.js','utf8');
 assert.match(html,/name="viewport" content="width=device-width,initial-scale=1"/);
 assert.match(css,/@media\(max-width:420px\)/);
 assert.match(css,/@media\(max-width:340px\)/);
 assert.match(css,/input,select,textarea\{font-size:16px\}/);
 assert.match(css,/env\(safe-area-inset-bottom\)/);
 assert.match(css,/button,\.primary,\.secondary,\.text-link\{min-height:44px\}/);
 assert.match(source,/ÉTAPE 7 · RECETTE MOBILE/);
 for(const label of ['Navigation et recherche','Galerie et variantes','Panier et livraison','Formulaire et paiement','Suivi et QR code','Annulation et retour','Espace gérant'])assert.ok(source.includes(label),label);
});

test('Préparation Vercel : routes, sortie statique et secrets documentés',async()=>{
 const config=JSON.parse(await readFile('vercel.json','utf8')),pkg=JSON.parse(await readFile('package.json','utf8')),api=await readFile('api/route.mjs','utf8'),env=await readFile('.env.vercel.example','utf8');
 assert.equal(config.outputDirectory,'public');
 assert.equal(pkg.scripts['vercel-build'],'node build.mjs');
 assert.match(api,/async fetch\(request\)/);
 assert.match(api,/supabaseDatabase/);assert.match(api,/supabaseBucket/);
 for(const key of ['SITE_ORIGIN','ADMIN_EMAIL','CUSTOMER_AUTH_URL','CUSTOMER_AUTH_PUBLIC_KEY','SUPABASE_DB_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_STORAGE_BUCKET'])assert.match(env,new RegExp('^'+key+'=','m'),key);
});
test('Centre retiré : anciennes routes compatibles, fonctions réunies dans Commandes',async()=>{
 const html=await readFile('index.html','utf8'),source=await readFile('app.js','utf8');assert.doesNotMatch(html,/data-admin="channels"/);assert.match(source,/if\(section==='channels'\)\{section='orders';return renderAdmin\(\)\}/);assert.match(source,/id="orderOrigin"/);assert.match(source,/Accès aux réseaux sociaux/);assert.match(source,/newOrderFromList.*onclick=openSocialOrder/);
});
test('Gestion du stock : structure fidèle à la maquette validée',async()=>{
 const html=await readFile('index.html','utf8'),source=await readFile('app.js','utf8'),css=await readFile('interface.css','utf8');
 for(const icon of ['i-dashboard','i-channels','i-bag','i-stock','i-catalogue','i-wallet','i-settings'])assert.match(html,new RegExp('id="'+icon+'"'));
 for(const label of ['Stock physique','Réservé','Disponible à la vente','Alertes','État du stock','Mouvements','Inventaire','Approvisionnement','Toutes les collections','Exporter Excel','Détails'])assert.ok(source.includes(label),label);
 for(const selector of ['.stock-product','.stock-state','.stock-table-panel','.stock-mobile-note'])assert.ok(css.includes(selector),selector);
 assert.match(css,/\.admin-mode \.store-header,[^}]*\.admin-mode \.mobile-nav\{display:none!important\}/);
});
test('Centre multicanal : commande sociale intégrée au stock avec origine',async()=>{
 const t=await ready(),payload={source:'tiktok',zone:'ci',customer:'Cliente sociale',phone:'+225 01 02 03 04 05',city:'Abidjan',neighborhood:'Cocody',note:'Commande reçue en message',items:[{id:t.v.id,qty:1}],key:crypto.randomUUID()};
 assert.equal((await t.call('/api/admin/social-order','POST',payload,'other')).status,403);
 const created=await t.call('/api/admin/social-order','POST',payload);assert.equal(created.status,201);assert.equal(created.data.details.source,'tiktok');assert.equal(created.data.details.socialOrder,true);assert.equal(created.data.subtotal,42500);assert.equal(created.data.total,45000);
 assert.equal(t.sqlite.prepare('SELECT stock FROM variants WHERE id=?').get(t.v.id).stock,1);const list=await t.call('/api/admin/orders');assert.equal(list.data.orders[0].source,'tiktok');
 const duplicate=await t.call('/api/admin/social-order','POST',payload);assert.equal(duplicate.data.id,created.data.id);assert.equal(t.sqlite.prepare('SELECT stock FROM variants WHERE id=?').get(t.v.id).stock,1);
});
test('Commande hors site complète : prix convenu, adresse, paiement et réservation cohérents',async()=>{
 const t=await ready(),payload={source:'phone',zone:'ci',firstName:'Awa',lastName:'Koné',customer:'Awa Koné',phone:'+225 01 02 03 04 05',city:'Abidjan',neighborhood:'Cocody',address:'Rue des jardins, maison 12',shipping:1500,payment:'wave',paid:true,items:[{id:t.v.id,qty:1,price:40000}],key:crypto.randomUUID()};
 const created=await t.call('/api/admin/social-order','POST',payload);assert.equal(created.status,201);const o=created.data;assert.equal(o.customer,'Awa Koné');assert.equal(o.address,payload.address);assert.equal(o.payment,'wave');assert.ok(o.paid);assert.equal(o.total,41500);assert.equal(o.status,'Nouvelle');assert.equal(o.details.firstName,'Awa');assert.equal(o.details.priceOverrides[0].catalogPrice,42500);assert.equal(o.lines[0].price,40000);
 const stock=(await t.call('/api/admin/stock')).data.rows[0];assert.equal(stock.available,1);assert.equal(stock.reserved,1);assert.equal(stock.physical,2);
 const duplicate=await t.call('/api/admin/social-order','POST',payload);assert.equal(duplicate.data.id,o.id);assert.equal(t.sqlite.prepare('SELECT stock FROM variants WHERE id=?').get(t.v.id).stock,1);
 const finance=financeSummary([o],o.lines.map(l=>({...l,order_id:o.id})),[],'XOF');assert.equal(finance.ordered,41500);assert.equal(finance.received,41500);assert.equal(finance.outstanding,0);
 assert.equal((await t.call('/api/admin/social-order','POST',{...payload,key:crypto.randomUUID(),items:[{id:t.v.id,qty:1,price:-1}]})).status,400);
});
test('Stock : quantités disponibles, réservées et physiques restent cohérentes',async()=>{
 const t=await ready();let stock=await t.call('/api/admin/stock');assert.equal(stock.status,200);assert.equal(stock.data.rows[0].available,2);assert.equal(stock.data.rows[0].reserved,0);assert.equal(stock.data.rows[0].physical,2);
 const o=(await t.call('/api/orders','POST',order(t.v),'client')).data;stock=await t.call('/api/admin/stock');assert.equal(stock.data.rows[0].available,1);assert.equal(stock.data.rows[0].reserved,1);assert.equal(stock.data.rows[0].physical,2);
 await t.call('/api/admin/order','PATCH',{id:o.id,status:'Rejetée',paid:false,note:'Test de restitution'});stock=await t.call('/api/admin/stock');assert.equal(stock.data.rows[0].available,2);assert.equal(stock.data.rows[0].reserved,0);assert.equal(stock.data.rows[0].physical,2);
 assert.equal((await t.call('/api/admin/stock','GET',null,'client')).status,403);
});
test('Stock : mouvements tracés, mise à l’écart, restauration et inventaire',async()=>{
 const t=await ready(),path='/api/admin/stock/movement',base={variantId:t.v.id,note:'Contrôle documenté'};
 assert.equal((await t.call(path,'POST',{...base,type:'entry',quantity:3,supplier:'Atelier test',currency:'XOF',unitCost:1000})).status,201);
 let stock=(await t.call('/api/admin/stock')).data;assert.equal(stock.rows[0].available,5);assert.equal(stock.rows[0].physical,5);assert.equal(stock.movements[0].type,'entry');
 assert.equal((await t.call(path,'POST',{...base,type:'unusable',quantity:2})).status,201);stock=(await t.call('/api/admin/stock')).data;assert.equal(stock.rows[0].available,3);assert.equal(stock.rows[0].unusable,2);assert.equal(stock.rows[0].physical,5);
 assert.equal((await t.call(path,'POST',{...base,type:'restore',quantity:1})).status,201);stock=(await t.call('/api/admin/stock')).data;assert.equal(stock.rows[0].available,4);assert.equal(stock.rows[0].unusable,1);
 assert.equal((await t.call(path,'POST',{...base,type:'inventory',countedPhysical:3})).status,201);stock=(await t.call('/api/admin/stock')).data;assert.equal(stock.rows[0].physical,3);assert.equal(stock.rows[0].available,2);assert.equal(stock.movements[0].expected_physical,5);assert.equal(stock.movements[0].counted_physical,3);
 assert.equal((await t.call(path,'POST',{...base,type:'discard',quantity:2})).status,409);
 assert.equal((await t.call(path,'POST',{...base,type:'entry',quantity:1},'client')).status,403);
});
test('Notifications : seules les nouvelles commandes du site apparaissent sur le menu',async()=>{
 const t=await ready();await t.call('/api/orders','POST',order(t.v),'client');assert.equal((await t.call('/api/admin/notifications')).data.count,1);
 const payload={source:'tiktok',zone:'ci',customer:'Cliente TikTok',phone:'+225 01 02 03 04 05',city:'Abidjan',neighborhood:'Cocody',note:'Commande sociale',items:[{id:t.v.id,qty:1}],key:crypto.randomUUID()};await t.call('/api/admin/social-order','POST',payload);
 assert.equal((await t.call('/api/admin/notifications')).data.count,1);
});
test('Preuve de commande : image privée, vérifiée et remplaçable',async()=>{
 const t=await ready(),created=await t.call('/api/admin/social-order','POST',{source:'whatsapp',zone:'ci',customer:'Cliente preuve',phone:'+225 05 00 00 00 00',city:'Abidjan',neighborhood:'Marcory',note:'',items:[{id:t.v.id,qty:1}],key:crypto.randomUUID()}),path='/api/admin/order/'+encodeURIComponent(created.data.id)+'/proof',png=Uint8Array.from([137,80,78,71,13,10,26,10]);
 let res=await t.raw(path,'POST',png,{'content-type':'image/png','x-file-name':encodeURIComponent('capture commande.png')});assert.equal(res.status,201);assert.equal((await res.json()).proof.name,'capture commande.png');
 res=await t.raw(path,'GET',undefined,{},'other');assert.equal(res.status,403);res=await t.raw(path,'GET');assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'image/png');assert.deepEqual([...new Uint8Array(await res.arrayBuffer())],[...png]);
 const detail=(await t.call('/api/order/'+created.data.id,'GET')).data;assert.equal(detail.details.proof.name,'capture commande.png');assert.equal(detail.details.proof.key.startsWith('order-proofs/'+created.data.id+'/'),true);
 res=await t.raw(path,'POST',Uint8Array.from([1,2,3]),{'content-type':'image/png'});assert.equal(res.status,400);
});
