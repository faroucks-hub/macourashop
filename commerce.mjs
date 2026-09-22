export const CHECKOUT_DEFAULTS={enabled:true,addressEnabled:true,whatsappContactEnabled:true,emailRequired:false,minimumEUR:0,minimumXOF:0,confirmationMessage:''};
export const PAYMENT_DEFAULTS={cod:true,testMode:false,franceCard:false,paypal:false,ciCard:false,wave:false,orangeMoney:false};
export const PAYMENT_LABELS={cod:'Paiement à la livraison',card:'Carte bancaire',paypal:'PayPal',wave:'Wave',orange_money:'Orange Money',cash:'Espèces',transfer:'Virement bancaire',manual:'Autre paiement manuel'};
export function paymentMethods(country,settings={},zone={}){
 // Release policy: saved legacy flags must never enable an unconnected provider.
 return ['FR','CI'].includes(country)&&settings.cod!==false&&zone.cod===true
  ?[{id:'cod',label:PAYMENT_LABELS.cod,detail:'Réglez lors de la réception',online:false,test:false}]:[];
}
export function checkoutRules(settings){return {...CHECKOUT_DEFAULTS,...settings.checkout}}
export function contactDetails(b,country,rules){
 const value=(key,min,max)=>{const v=typeof b[key]==='string'?b[key].trim():'';if(v.length<min||v.length>max)throw new Error('Vérifiez le champ '+({city:'ville',postalCode:'code postal',email:'e-mail',landmark:'repère',note:'instructions de livraison'}[key]||key)+'.');return v};
 const deliveryMode=b.deliveryMode||'address';
 if(!['address','whatsapp'].includes(deliveryMode))throw new Error('Choisissez comment préciser votre adresse.');
 if(deliveryMode==='address'&&rules.addressEnabled===false)throw new Error('La saisie d’adresse est désactivée.');
 if(deliveryMode==='whatsapp'&&rules.whatsappContactEnabled===false)throw new Error('Le contact WhatsApp pour préciser l’adresse est désactivé.');
 const neighborhood=rules.zoneNeighborhood||value('neighborhood',2,100);
 if(deliveryMode==='whatsapp'){
 if(!whatsappDigits(b.whatsappContact))throw new Error('Indiquez votre numéro WhatsApp avec indicatif international.');
 return {deliveryMode,neighborhood,city:value('city',2,100),postalCode:'',email:'',landmark:'',note:'',whatsappContact:whatsappDigits(b.whatsappContact)};
 }
 const city=value('city',2,100),postalCode=value('postalCode',country==='FR'?5:0,20),email=value('email',rules.emailRequired?3:0,254),landmark=value('landmark',0,200),note=value('note',0,500);
 if(country==='FR'&&!/^\d{5}$/.test(postalCode))throw new Error('Le code postal français doit contenir 5 chiffres.');
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Adresse e-mail invalide.');
 return {deliveryMode,neighborhood,city,postalCode,email,landmark,note};
}
export function cartSummary(rows){return {subtotal:rows.reduce((sum,r)=>sum+(r.missing?0:r.price*r.qty),0),invalid:!rows.length||rows.some(r=>r.missing||!Number.isInteger(r.qty)||r.qty<1||r.qty>20||r.qty>r.v.stock)}}

function campaignApplies(c,row,currency,now){
 if(!c?.active||!['fixed_price','product_percent','quantity_percent','buy_get','shipping'].includes(c.type))return false;
 if(c.currency&&c.currency!=='ALL'&&c.currency!==currency)return false;
 if(c.start&&Date.parse(c.start)>now||c.end&&Date.parse(c.end+'T23:59:59.999Z')<now)return false;
 if(c.target==='category'&&c.category!==row.category)return false;
 if(c.target==='products'&&!c.productIds?.includes(row.product_id||row.p?.id||row.id))return false;
 return true;
}
export function activePromotions(settings={},currency='EUR',now=Date.now()){return (settings.promotions||[]).filter(c=>campaignApplies(c,{category:c.category,product_id:c.productIds?.[0]},currency,now))}
export function promotionQuote(rows,settings={},currency='EUR',shippingBase=0,country='',now=Date.now()){
 const campaigns=settings.promotions||[],lines=[];let regularSubtotal=0,productDiscount=0,totalQty=0;
 for(const row of rows){
  if(row.missing){lines.push({...row,regularTotal:0,discount:0,netTotal:0});continue}
  const qty=row.qty,unit=row.price,regularTotal=unit*qty;regularSubtotal+=regularTotal;totalQty+=qty;
  let best=null;
  for(const c of campaigns){if(c.type==='shipping'||!campaignApplies(c,{category:row.p?.category||row.category,product_id:row.p?.id||row.product_id},currency,now))continue;let discount=0;
   if(c.type==='fixed_price'){const fixed=currency==='EUR'?c.priceEUR:c.priceXOF;if(Number.isSafeInteger(fixed)&&fixed>=0&&fixed<unit)discount=(unit-fixed)*qty}
   if(c.type==='product_percent')discount=Math.round(regularTotal*c.percent/100);
   if(c.type==='quantity_percent'&&qty>=c.minQty)discount=Math.round(regularTotal*c.percent/100);
   if(c.type==='buy_get'){const group=c.buyQty+c.freeQty,free=Math.floor(qty/group)*c.freeQty;discount=free*unit}
   discount=Math.min(regularTotal,Math.max(0,discount));if(discount&&(!best||discount>best.discount))best={id:c.id,title:c.title,discount};
  }
  const discount=best?.discount||0;productDiscount+=discount;lines.push({...row,regularTotal,discount,netTotal:regularTotal-discount,offer:best});
 }
 const subtotal=regularSubtotal-productDiscount;let shippingDiscount=0,shippingOffer=null;
 for(const c of campaigns){if(c.type!=='shipping'||!campaignApplies(c,{category:'',product_id:''},currency,now)||c.countries?.length&&!c.countries.includes(country)||subtotal<(c.minSubtotal||0)||totalQty<(c.minQty||0))continue;const discount=c.freeShipping?shippingBase:Math.round(shippingBase*c.percent/100);if(discount>shippingDiscount){shippingDiscount=Math.min(shippingBase,discount);shippingOffer={id:c.id,title:c.title,discount:shippingDiscount}}}
 const shipping=shippingBase-shippingDiscount;return {lines,regularSubtotal,productDiscount,subtotal,shippingBase,shippingDiscount,shipping,total:subtotal+shipping,savings:productDiscount+shippingDiscount,applied:[...lines.map(x=>x.offer).filter(Boolean),...(shippingOffer?[shippingOffer]:[])]};
}
export function productOffer(p,settings={},currency='EUR',now=Date.now()){
 const row={p,product_id:p.id,category:p.category,qty:1,price:effectivePrice(p,currency)};let best=null;
 for(const c of settings.promotions||[]){if(c.type==='shipping'||!campaignApplies(c,row,currency,now))continue;if(c.type==='fixed_price'){const fixed=currency==='EUR'?c.priceEUR:c.priceXOF;if(!Number.isSafeInteger(fixed)||fixed<0||fixed>=row.price)continue}const label=c.type==='fixed_price'?'Prix spécial':c.type==='buy_get'?`${c.buyQty} achetés + ${c.freeQty} offert${c.freeQty>1?'s':''}`:c.type==='quantity_percent'?`-${c.percent}% dès ${c.minQty} articles`:`-${c.percent}%`;const priority=c.type==='fixed_price'?4:c.type==='product_percent'?3:c.type==='buy_get'?2:1;if(!best||priority>best.priority)best={...c,label,priority}}
 return best;
}

export function whatsappDigits(value){const s=String(value||'').replace(/[\s().-]/g,'').replace(/^\+/,'');return /^[1-9]\d{7,14}$/.test(s)?s:''}
export function orderWhatsappLink(order,recipient){const number=whatsappDigits(recipient);return number?'https://wa.me/'+number+'?text='+encodeURIComponent('Bonjour, concernant la commande '+order.id+', organisons la livraison.'):''}
export function merchandisingOf(p){if(typeof p.merchandising==='string'){try{return JSON.parse(p.merchandising)}catch{return {}}}return p.merchandising||{}}
export function effectivePrice(p,currency){const base=currency==='EUR'?p.eur:p.xof,m=merchandisingOf(p),sale=currency==='EUR'?m.promoEUR:m.promoXOF;return Number.isSafeInteger(sale)&&sale>=0&&sale<base?sale:base}
export function productMarginPreview({base,promotion,promotionEnabled,purchase,transport}){
 const usePromotion=promotionEnabled&&Number.isFinite(promotion)&&promotion>=0&&promotion<base;
 const sale=usePromotion?promotion:base;
 const complete=Number.isFinite(purchase)&&Number.isFinite(transport);
 return {sale,priceType:usePromotion?'promotion':'normal',complete,margin:complete?Math.round(sale)-purchase-transport:null};
}
export function productBadges(p,currency){
 const m=merchandisingOf(p),stock=p.variants.some(v=>v.stock>0);
 const labels=stock?[]:[m.restocking?'Réapprovisionnement':'Stock épuisé'];
 if(m.isNew)labels.push('Nouveau');
 if(m.featured)labels.push('Coup de cœur');
 return labels;
}
