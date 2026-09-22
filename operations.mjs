export const ORDER_TRANSITIONS={
 'Adresse à confirmer':['Nouvelle','Validée','Rejetée','Annulée'],
 'Nouvelle':['Validée','Rejetée','Annulée'],
 'Validée':['Préparation','Rejetée','Annulée'],
 'Préparation':['Expédiée','Rejetée','Annulée'],
 'Expédiée':['En livraison','Livrée'],
 'En livraison':['Livrée'],
 'Livrée':[], 'Rejetée':[], 'Annulée':[]
};
export const cancelledOrder=o=>['Annulée','Rejetée'].includes(o.status);
export function refundedOrder(o){
 const details=parseCosts(o?.details),request=details.returnRequest||o?.returnPolicy?.request;
 return o?.returnStatus==='Remboursé'||request?.status==='Remboursé';
}
export function cancellationWindow(o,now=Date.now()){
 const deadline=Date.parse(o.created)+86400000;
 const eligible=Number.isFinite(deadline)&&now<deadline&&!o.paid&&['Nouvelle','Adresse à confirmer','Validée','Préparation'].includes(o.status);
 const reason=cancelledOrder(o)?'Cette commande est déjà clôturée.':o.paid?'Commande payée : contactez le gérant pour une demande d’annulation.':!['Nouvelle','Adresse à confirmer','Validée','Préparation'].includes(o.status)?'L’expédition a commencé : contactez le gérant.':now>=deadline?'Le délai d’annulation de 24 heures est écoulé.':'';
 return {eligible,deadline:Number.isFinite(deadline)?new Date(deadline).toISOString():null,reason};
}
function addWorkingDays(date,count){
 const value=new Date(date);let added=0;
 while(added<count){value.setUTCDate(value.getUTCDate()+1);const day=value.getUTCDay();if(day!==0&&day!==6)added++}
 return value;
}
export function returnWindow(o,now=Date.now()){
 const request=o.details?.returnRequest||null,deliveredEvent=[...(o.events||[])].reverse().find(e=>e.status==='Livrée');
 const deliveredAt=o.details?.deliveredAt||deliveredEvent?.created||null;
 const base=deliveredAt&&new Date(deliveredAt),deadline=base&&!Number.isNaN(base.valueOf())?(o.country==='CI'?addWorkingDays(base,10):new Date(base.valueOf()+14*86400000)):null;
 const supported=['FR','CI'].includes(o.country),eligible=o.status==='Livrée'&&supported&&!request&&deadline&&now<=deadline.valueOf();
 const reason=request?'Une demande de retour est déjà enregistrée.':o.status!=='Livrée'?'Le retour devient disponible après confirmation de la livraison.':!supported?'Contactez MacouraShop pour connaître les conditions applicables à votre destination.':!deadline?'La date de livraison doit être confirmée.':now>deadline.valueOf()?'Le délai de retour est écoulé.':'';
 return {eligible,deadline:deadline?.toISOString()||null,days:o.country==='CI'?'10 jours ouvrables':'14 jours calendaires',request,reason};
}
export function managementRisks(orders,products=[],now=Date.now()){
 const real=orders.filter(o=>!o.demo),active=o=>!['Livrée','Annulée','Rejetée'].includes(o.status);
 const days=o=>Math.max(0,Math.floor((now-Date.parse(o.statusChangedAt||o.details?.statusChangedAt||o.created))/86400000));
 const stalled=real.filter(o=>active(o)&&days(o)>=3).map(o=>({...o,stalledDays:days(o)}));
 const awaiting=real.filter(o=>['Nouvelle','Adresse à confirmer'].includes(o.status));
 const payment=real.filter(o=>o.status==='Livrée'&&!o.paid&&!refundedOrder(o)),deliveryCost=real.filter(o=>o.status==='Livrée'&&o.delivery_cost==null&&!refundedOrder(o));
 const published=products.filter(p=>p.active&&!p.demo),stock=p=>p.variants.reduce((n,v)=>n+v.stock,0);
 const outOfStock=published.filter(p=>stock(p)===0),lowStock=published.filter(p=>stock(p)>0&&stock(p)<=3);
 return {awaiting,stalled,payment,deliveryCost,outOfStock,lowStock,total:awaiting.length+stalled.filter(o=>!awaiting.some(a=>a.id===o.id)).length+payment.length};
}
export function normalizePhone(value){return String(value||'').replace(/\D/g,'').replace(/^00/,'')}
export function parseCosts(value){if(typeof value==='string'){try{return JSON.parse(value)}catch{return {}}}return value||{}}
export function orderFigures(order,lines){
 const total=key=>lines.length&&lines.every(l=>parseCosts(l.costs)[key]!=null)?lines.reduce((sum,l)=>sum+parseCosts(l.costs)[key]*l.quantity,0):null;
 const purchase=total('purchase'),transport=total('transport'),delivery=order.delivery_cost??null;
 const merchandiseMargin=purchase==null||transport==null?null:order.subtotal-purchase-transport;
 return {purchase,transport,delivery,merchandiseMargin,margin:cancelledOrder(order)||refundedOrder(order)||merchandiseMargin==null||delivery==null?null:merchandiseMargin+order.shipping-delivery};
}
export function activityReport(orders,filters={},generatedAt=new Date().toISOString()){
 const rows=orders.filter(o=>!o.demo),currencies=filters.currency?[filters.currency]:['EUR','XOF'];
 const summaries=Object.fromEntries(currencies.map(currency=>{
  const selected=rows.filter(o=>o.currency===currency),active=selected.filter(o=>!cancelledOrder(o)&&!refundedOrder(o));
  const sum=list=>list.reduce((s,o)=>s+o.total,0);
  return [currency,{count:selected.length,total:sum(selected),activeCount:active.length,activeTotal:sum(active),received:sum(active.filter(o=>o.paid)),outstanding:sum(active.filter(o=>!o.paid)),statuses:Object.keys(ORDER_TRANSITIONS).map(status=>{const list=selected.filter(o=>o.status===status);return {status,count:list.length,total:sum(list)}})}];
 }));
 return {generatedAt,filters,orders:rows,summaries};
}
export function financeSummary(orders,lines,expenses,currency){
 const relevant=orders.filter(o=>o.currency===currency&&!o.demo),active=relevant.filter(o=>!cancelledOrder(o)&&!refundedOrder(o)),delivered=active.filter(o=>o.status==='Livrée');
 let knownMargin=0,incomplete=0;
 for(const o of delivered){const items=lines.filter(l=>l.order_id===o.id);let costs=0,missing=o.delivery_cost===null||o.delivery_cost===undefined||!items.length;
 for(const l of items){const c=parseCosts(l.costs);if(c.purchase==null||c.transport==null)missing=true;else costs+=(c.purchase+c.transport)*l.quantity}
 if(missing)incomplete++;else knownMargin+=o.total-costs-o.delivery_cost;
 }
 const overhead=expenses.filter(e=>e.currency===currency&&!e.voided).reduce((s,e)=>s+e.amount,0);
 const figures=delivered.map(o=>orderFigures(o,lines.filter(l=>l.order_id===o.id)));
 const purchase=figures.some(f=>f.purchase==null)?null:figures.reduce((n,f)=>n+f.purchase,0);
 const transport=figures.some(f=>f.transport==null||f.delivery==null)?null:figures.reduce((n,f)=>n+f.transport+f.delivery,0);
 return {purchase,transport,orders:active.length,ordered:active.reduce((s,o)=>s+o.total,0),received:active.filter(o=>o.paid).reduce((s,o)=>s+o.total,0),outstanding:active.filter(o=>!o.paid).reduce((s,o)=>s+o.total,0),deliveredSales:delivered.reduce((s,o)=>s+o.total,0),knownMargin,incomplete,overhead,estimatedResult:incomplete?null:knownMargin-overhead};
}
