import {jsPDF} from 'jspdf';
import qrcode from 'qrcode-generator';

export function receiptPDF(order,fonts){
 if(order.document_type==='final'&&(order.status!=='Livrée'||!order.paid))throw new Error('Reçu final indisponible avant livraison et paiement.');
 if(!order.tracking_code)throw new Error('Code de suivi absent.');
 if(!fonts)throw new Error('Polices du reçu indisponibles.');
 const doc=new jsPDF({unit:'mm',format:'a4'});
 doc.addFileToVFS('Receipt.ttf',fonts.regular);doc.addFont('Receipt.ttf','Receipt','normal');
 doc.addFileToVFS('ReceiptBold.ttf',fonts.bold);doc.addFont('ReceiptBold.ttf','Receipt','bold');
 doc.setProperties({title:'MacouraShop — '+order.id,author:'MacouraShop',subject:'Document de commande'});
 const code=order.tracking_code,link='https://macourashop.faroucks.chatgpt.site/#suivi?code='+encodeURIComponent(code);
 const clean=value=>String(value??'').replace(/[\u2010-\u2015]/g,'-').replace(/[\u202f\u00a0]/g,' ').replace(/[\u2018\u2019]/g,"'");
 const money=n=>clean(new Intl.NumberFormat('fr-FR',{minimumFractionDigits:order.currency==='EUR'?2:0,maximumFractionDigits:order.currency==='EUR'?2:0}).format(order.currency==='EUR'?n/100:n)+' '+order.currency);
 const date=v=>new Date(v).toLocaleString('fr-FR',{timeZone:'UTC'})+' UTC';
 const title=order.document_type==='final'?'Reçu final':order.document_type==='order'?'Bon de commande':'Reçu de commande';
 let y;
 const style=(size=10,bold=false)=>{doc.setFont('Receipt',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(35,30,32)};
 const page=()=>{
  if(y!==undefined)doc.addPage();
  if(fonts.logo){
   // Preserve the original artwork; clip only its surrounding white canvas.
   const scale=66/1440;
   doc.saveGraphicsState();doc.rect(20,13,66,488*scale);doc.clip();doc.discardPath();
   doc.addImage(fonts.logo,'PNG',20-64*scale,13-232*scale,1536*scale,1024*scale,'brand','FAST');doc.restoreGraphicsState();
  }else{style(20,true);doc.text('MACOURASHOP',20,29)}
  style(9);doc.text('DOCUMENT DE COMMANDE',190,23,{align:'right'});
  doc.setDrawColor(185,143,54);doc.setLineWidth(.4);doc.line(20,39,190,39);
  y=49;style(18,true);doc.text(title,20,y);y+=7;
  style(9);doc.text(clean('Référence : '+order.id),20,y);y+=7;
 };
 const ensure=h=>{if(y+h>274)page()};
 const paragraph=(text,size=10,bold=false)=>{
  style(size,bold);const rows=doc.splitTextToSize(clean(text),170);
  for(const line of rows){ensure(size*.46);style(size,bold);doc.text(line,20,y);y+=size*.46}y+=2;
 };
 page();
 paragraph('Créée le '+date(order.created),9);y+=2;
 paragraph(order.customer,11,true);paragraph('Téléphone : '+order.phone,9);
 if(order.details?.whatsappContact)paragraph('WhatsApp : '+order.details.whatsappContact,9);
 paragraph([order.details?.city,order.details?.neighborhood,order.zone,order.country].filter(Boolean).join(' / '),9);
 if(order.address)paragraph('Adresse : '+order.address+' '+(order.details?.postalCode||''),9);
 y+=2;paragraph('Statut : '+order.status,10,true);
 paragraph(order.paid?'Paiement : encaissé (déclaré par le gérant)':'Paiement : non encaissé — à régler à la livraison',9);
 if(order.document_type==='final'){
  const delivery=order.events?.find(e=>e.status==='Livrée');
  if(delivery)paragraph('Livrée le '+date(delivery.created),9);
  paragraph('Montant encaissé : '+money(order.total),9,true);
 }
 y+=5;
 const tableHeader=()=>{
  doc.setFillColor(246,243,238);doc.rect(20,y-5,170,10,'F');style(9,true);
  doc.text('Article / variante',23,y+1);doc.text('Qté',114,y+1,{align:'right'});doc.text('Prix unitaire',152,y+1,{align:'right'});doc.text('Total',187,y+1,{align:'right'});y+=12;
 };
 ensure(28);tableHeader();
 for(const l of order.lines){
  style(10);const name=doc.splitTextToSize(clean(l.name),80);
  style(9);const variant=doc.splitTextToSize(clean([l.size,l.color].filter(Boolean).join(' / ')),80);
  const rows=[...name.map(text=>({text,size:10})),...variant.map(text=>({text,size:9}))];
  let first=true;
  while(rows.length){
   const needed=Math.min(rows.length*5+7,190);
   if(y+needed>268){page();y+=4;tableHeader()}
   const count=Math.max(1,Math.floor((268-y-7)/5)),chunk=rows.splice(0,count),top=y;
   for(const row of chunk){style(row.size);doc.text(row.text,23,y);y+=5}
   if(first){style(9);doc.text(String(l.quantity),114,top,{align:'right'});doc.text(money(l.price),152,top,{align:'right'});doc.text(money(l.price*l.quantity),187,top,{align:'right'});first=false}
   y+=3;doc.setDrawColor(230,226,222);doc.setLineWidth(.2);doc.line(20,y,190,y);y+=4;
  }
 }
 ensure(33);y+=3;
 const total=(label,value,bold=false)=>{style(bold?12:10,bold);doc.text(label,105,y);doc.text(money(value),187,y,{align:'right'});y+=bold?9:7};
 const pricing=order.details?.pricing||{};
 if(pricing.productDiscount){total('Articles avant offres',pricing.regularSubtotal);total('Réductions',-pricing.productDiscount)}
 total('Sous-total articles',order.subtotal);
 if(pricing.shippingDiscount){total('Livraison avant offre',pricing.shippingBase);total('Offre livraison',-pricing.shippingDiscount)}
 total('Livraison',order.shipping);total('Total',order.total,true);
 ensure(order.demo?76:69);y+=5;
 style(11,true);doc.text('Suivre votre commande',70,y+5);
 style(8);doc.text('Code reçu : '+code,70,y+12);
 doc.text(doc.splitTextToSize('Scannez le QR code et renseignez le téléphone de la commande. Conservez votre code reçu confidentiel.',115),70,y+19);
 const qr=qrcode(0,'M');qr.addData(link);qr.make();const count=qr.getModuleCount(),cell=38/(count+8);
 doc.setFillColor(255,255,255);doc.rect(20,y,38,38,'F');doc.setFillColor(0,0,0);
 for(let row=0;row<count;row++)for(let col=0;col<count;col++)if(qr.isDark(row,col))doc.rect(20+(col+4)*cell,y+(row+4)*cell,cell,cell,'F');
 doc.link(20,y,38,38,{url:link});y+=44;
 paragraph('Document de commande, distinct d’une facture fiscale. Seule la mention « paiement encaissé » confirme un encaissement déclaré par le gérant.',8);
 if(order.demo)paragraph('DÉMONSTRATION — AUCUNE VENTE RÉELLE',10,true);
 for(let i=1;i<=doc.getNumberOfPages();i++){
  doc.setPage(i);style(8);doc.setTextColor(110);doc.text('MacouraShop',20,288);doc.text(i+' / '+doc.getNumberOfPages(),190,288,{align:'right'});
 }
 return doc;
}
let fontsPromise;
export async function receiptFonts(){
 fontsPromise||=Promise.all(['/assets/receipt-sans.ttf','/assets/receipt-sans-bold.ttf','/assets/macourashop-logo.png'].map(async url=>{
  const r=await fetch(url);if(!r.ok)throw new Error('Éléments du reçu indisponibles. Réessayez.');
  const data=new Uint8Array(await r.arrayBuffer());let raw='';for(let i=0;i<data.length;i+=8192)raw+=String.fromCharCode(...data.subarray(i,i+8192));return btoa(raw);
 })).then(([regular,bold,logo])=>({regular,bold,logo:'data:image/png;base64,'+logo})).catch(e=>{fontsPromise=null;throw e});
 return fontsPromise;
}
export async function downloadReceipt(order){receiptPDF(order,await receiptFonts()).save('Macourashop-'+order.id+'.pdf')}
