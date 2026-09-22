import {jsPDF} from 'jspdf';
import ExcelJS from 'exceljs';
import {receiptFonts} from './receipt.mjs';

const clean=value=>String(value??'').replace(/[\u2010-\u2015]/g,'-').replace(/[\u202f\u00a0]/g,' ').replace(/[\u2018\u2019]/g,"'");
const amount=(n,c)=>n==null?'À renseigner':new Intl.NumberFormat('fr-FR',{minimumFractionDigits:c==='EUR'?2:0,maximumFractionDigits:c==='EUR'?2:0}).format(n/(c==='EUR'?100:1))+' '+c;
export function filterDescription(f){
 return 'Création : '+(f.from||'début')+' au '+(f.to||'présent')+' | Statut : '+(f.status||'tous')+' | Paiement : '+(f.paid==='paid'?'encaissé':f.paid==='unpaid'?'non encaissé':'tous')+(f.search?' | Recherche : '+f.search:'');
}
export function activityPDF(report,fonts){
 const doc=new jsPDF({unit:'mm',format:'a4'});
 doc.addFileToVFS('Report.ttf',fonts.regular);doc.addFont('Report.ttf','Report','normal');doc.addFileToVFS('ReportBold.ttf',fonts.bold);doc.addFont('ReportBold.ttf','Report','bold');
 let page=0;
 for(const [currency,s] of Object.entries(report.summaries)){
  if(page++)doc.addPage();let y=24;
  const text=(value,size=10,bold=false)=>{doc.setFont('Report',bold?'bold':'normal');doc.setFontSize(size);const lines=doc.splitTextToSize(clean(value),170);doc.text(lines,20,y);y+=lines.length*size*.45+4};
  doc.setTextColor(104,31,61);text('MACOURASHOP',21,true);doc.setTextColor(35,30,32);text('Rapport des commandes - '+currency,15,true);
  text('Édité le '+new Date(report.generatedAt).toLocaleString('fr-FR',{timeZone:'UTC'})+' UTC',9);
  text(filterDescription(report.filters),9);
  text('Commandes de test exclues. Statuts actuels des commandes créées sur la période (UTC).',9);
  text(s.count+' commande(s) sélectionnée(s)',12,true);
  for(const [label,value] of [['Ventes actives (hors annulations / rejets)',s.activeTotal],['Encaissé sur ces commandes',s.received],['Reste à encaisser',s.outstanding]])text(label+' : '+amount(value,currency),10);
  y+=3;doc.setFillColor(104,31,61);doc.rect(20,y-5,170,10,'F');doc.setTextColor(255);doc.setFont('Report','bold');doc.setFontSize(10);doc.text('Statut',24,y+1);doc.text('Nombre',125,y+1,{align:'right'});doc.text('Montant',186,y+1,{align:'right'});y+=12;doc.setTextColor(35,30,32);doc.setFont('Report','normal');
  s.statuses.forEach((row,i)=>{if(i%2===0){doc.setFillColor(246,243,239);doc.rect(20,y-5,170,10,'F')}doc.text(clean(row.status),24,y+1);doc.text(String(row.count),125,y+1,{align:'right'});doc.text(clean(amount(row.total,currency)),186,y+1,{align:'right'});y+=10});
  y+=9;text('Une commande livrée n’est pas nécessairement payée. Les montants annulés et rejetés ne sont pas inclus dans les ventes actives ni dans les sommes restant à encaisser.',9);
  text('Synthèse de gestion, pas une facture ni un bilan comptable. Le détail chiffré des commandes est disponible dans l’export Excel.',9);
 }
 for(let i=1;i<=doc.getNumberOfPages();i++){doc.setPage(i);doc.setFont('Report','normal');doc.setFontSize(8);doc.setTextColor(110);doc.text('CONFIDENTIEL - GÉRANT | Macourashop | '+i+' / '+doc.getNumberOfPages(),20,288)}
 return doc;
}
export function activityWorkbook(report){
 const book=new ExcelJS.Workbook();book.creator='Macourashop';book.created=new Date(report.generatedAt);book.calcProperties.fullCalcOnLoad=true;
 const style=sheet=>{sheet.pageSetup={orientation:'landscape',paperSize:sheet.name.startsWith('Commandes')?8:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1',margins:{left:0.25,right:0.25,top:0.4,bottom:0.4,header:0.2,footer:0.2}};sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).height=32;sheet.getRow(1).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'},size:11};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF681F3D'}};cell.alignment={vertical:'middle',wrapText:true}});sheet.eachRow((row,n)=>{if(n===1)return;row.height=Math.min(180,Math.max(32,...row.values.filter(v=>typeof v==='string').map(v=>Math.ceil(v.length/45)*14)));row.eachCell(cell=>{cell.font={name:'Calibri',size:11};cell.alignment={vertical:'middle',wrapText:true};if(n%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF6F3EF'}}})})};
 const readme=book.addWorksheet('Lecture');readme.columns=[{width:28},{width:110}];readme.addRows([['MACOURASHOP','Rapport des commandes - confidentiel gérant'],['Édité le (UTC)',report.generatedAt],['Filtres',filterDescription(report.filters)],['Devise',report.filters.currency||'EUR et XOF, sans conversion ni addition'],['Périmètre','Commandes créées sur la période, selon leur statut au moment de l’export. Tests exclus.'],['Montants','EUR en euros et centimes ; XOF en francs CFA entiers. Annulations et rejets exclus des ventes actives.'],['Coûts','Achat et approvisionnement : coûts par produit figés lors de la commande, multipliés par les quantités. Livraison réelle : coût pour toute la commande.'],['Marge','Vente totale - achat - approvisionnement - livraison réelle, avant frais généraux et taxes. Inconnu reste vide / À renseigner. Annulé ou rejeté : Sans objet.'],['Encaissements','État déclaré par le gérant, pas un relevé bancaire. Une commande livrée peut rester non encaissée.'],['Limite','Rapport de gestion, pas une facture ni une comptabilité complète. Modifier ce fichier ne modifie pas le site.']]);style(readme);readme.getRow(7).height=48;readme.getRow(8).height=48;
 for(const [currency,summary] of Object.entries(report.summaries)){
  const sheet=book.addWorksheet('Commandes '+currency),factor=currency==='EUR'?100:1,fmt=currency==='EUR'?'#,##0.00':'#,##0';
  const headers=['Référence','Créée le (UTC)','Cliente','Pays','Zone','Statut','Paiement','Vente articles','Livraison facturée','Vente totale','Achat','Transport appro.','Livraison réelle','Marge estimée','Encaissé actif','Reste à encaisser actif'];
  sheet.columns=headers.map((header,i)=>({header,width:[44,23,26,10,24,22,21,19,20,19,18,20,20,22,21,24][i]}));
  const rows=report.orders.filter(o=>o.currency===currency);
  rows.forEach((o,i)=>{const r=i+2,f=o.figures||{},active=!['Annulée','Rejetée'].includes(o.status),num=n=>n==null?null:n/factor;
   sheet.addRow([o.id,new Date(o.created),o.customer,o.country,o.zone,o.status,o.paid?'Encaissé':active?'À encaisser':'Sans encaissement',num(o.subtotal),num(o.shipping),{formula:'H'+r+'+I'+r,result:num(o.total)},num(f.purchase),num(f.transport),num(f.delivery),{formula:'IF(OR(F'+r+'="Annulée",F'+r+'="Rejetée"),"Sans objet",IF(COUNT(K'+r+':M'+r+')<3,"À renseigner",J'+r+'-SUM(K'+r+':M'+r+')))',result:!active?'Sans objet':f.margin==null?'À renseigner':num(f.margin)},{formula:'IF(AND(F'+r+'<>"Annulée",F'+r+'<>"Rejetée",G'+r+'="Encaissé"),J'+r+',0)',result:active&&o.paid?num(o.total):0},{formula:'IF(AND(F'+r+'<>"Annulée",F'+r+'<>"Rejetée",G'+r+'="À encaisser"),J'+r+',0)',result:active&&!o.paid?num(o.total):0}]);
  });
  sheet.getColumn(2).numFmt='yyyy-mm-dd hh:mm';for(let c=8;c<=16;c++)sheet.getColumn(c).numFmt=fmt;sheet.autoFilter={from:'A1',to:'P'+Math.max(1,sheet.rowCount)};style(sheet);
  const synth=book.addWorksheet('Synthèse '+currency);synth.columns=[{width:48},{width:18},{width:25}];synth.addRow(['Statut / indicateur','Nombre','Montant '+currency]);
  const end=Math.max(2,sheet.rowCount),ref="'Commandes "+currency+"'!",range=col=>ref+col+'2:'+col+end;
  summary.statuses.forEach((s,i)=>{const r=i+2;synth.addRow([s.status,{formula:'COUNTIF('+range('F')+',A'+r+')',result:s.count},{formula:'SUMIF('+range('F')+',A'+r+','+range('J')+')',result:s.total/factor}])});
  synth.addRow(['Ventes actives (hors annulations / rejets)',summary.activeCount,{formula:'SUM('+range('O')+')+SUM('+range('P')+')',result:summary.activeTotal/factor}]);
  synth.addRow(['Encaissé sur ces commandes',null,{formula:'SUM('+range('O')+')',result:summary.received/factor}]);
  synth.addRow(['Reste à encaisser',null,{formula:'SUM('+range('P')+')',result:summary.outstanding/factor}]);
  synth.getColumn(3).numFmt=fmt;style(synth);synth.getRow(11).height=42;
 }
 return book;
}
export async function downloadActivity(report,type){
 const filename='Macourashop-rapport-'+report.generatedAt.slice(0,10);
 if(type==='pdf'){activityPDF(report,await receiptFonts()).save(filename+'.pdf');return}
 const buffer=await activityWorkbook(report).xlsx.writeBuffer(),blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename+'.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
