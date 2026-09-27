(()=>{
 const STYLE_ID='macoura-payment-security-style';
 const NOTICE_CLASS='payment-security-notice';
 const targets=['bagContent','trackingContent','customerOrders','dialogContent','accountContent'];
 const style=`
 .${NOTICE_CLASS}{margin:18px 0;padding:18px 20px;border:1px solid #c9a96e;border-left:4px solid #681f3d;background:#fffaf1;color:#2b2225;border-radius:5px;box-shadow:0 8px 24px #32121d0b}
 .${NOTICE_CLASS}__head{display:flex;align-items:center;gap:10px;margin-bottom:9px;color:#431326;font-weight:800;font-size:14px;letter-spacing:.02em}
 .${NOTICE_CLASS}__icon{display:grid;place-items:center;width:28px;height:28px;flex:0 0 28px;border-radius:50%;background:#681f3d;color:white;font-size:14px}
 .${NOTICE_CLASS} p{margin:6px 0;font-size:12px;line-height:1.65;color:#55494c}
 .${NOTICE_CLASS} strong{color:#431326}
 .${NOTICE_CLASS}__stop{font-weight:800;color:#8a1f38!important}
 @media(max-width:560px){.${NOTICE_CLASS}{padding:15px 16px;margin:14px 0}.${NOTICE_CLASS}__head{font-size:13px}.${NOTICE_CLASS} p{font-size:11px}}
 `;
 function ensureStyle(){if(document.getElementById(STYLE_ID))return;const s=document.createElement('style');s.id=STYLE_ID;s.textContent=style;document.head.appendChild(s)}
 function notice(mode='general'){
  const cod=mode==='cod';
  const el=document.createElement('aside');el.className=NOTICE_CLASS;el.setAttribute('role','note');el.setAttribute('aria-label','Sécurité de votre paiement');
  el.innerHTML=`<div class="${NOTICE_CLASS}__head"><span class="${NOTICE_CLASS}__icon" aria-hidden="true">🔒</span><span>Sécurité de votre paiement</span></div>${cod?'<p><strong>Paiement à la livraison :</strong> aucun paiement anticipé n’est nécessaire pour cette commande.</p>':''}<p>Payez uniquement selon les instructions affichées sur votre commande MacouraShop. N’envoyez jamais d’argent vers un numéro, compte ou lien différent communiqué par un tiers.</p><p>MacouraShop ne vous demandera jamais votre mot de passe, un code de vérification ou votre code confidentiel de suivi.</p><p class="${NOTICE_CLASS}__stop">En cas de doute, ne payez pas. Vérifiez d’abord votre commande sur le site ou contactez MacouraShop par le canal officiel.</p>`;
  return el;
 }
 function modeFor(root){const t=(root.textContent||'').toLowerCase();return /paiement à la livraison|à régler à la livraison|cash on delivery/.test(t)?'cod':'general'}
 function install(root){if(!root||root.querySelector('.'+NOTICE_CLASS))return;const text=(root.textContent||'').trim();if(!text)return;const paymentContext=/paiement|commande|total|livraison|reçu|suivi|confirmer|checkout|régler|encaiss/.test(text.toLowerCase());if(!paymentContext)return;const n=notice(modeFor(root));const action=root.querySelector('button.primary,[type="submit"],.order-success,.bag-summary,.checkout-card');if(action&&action.parentNode)action.parentNode.insertBefore(n,action);else root.appendChild(n)}
 function scan(){if(location.pathname==='/admin')return;for(const id of targets)install(document.getElementById(id))}
 ensureStyle();
 document.addEventListener('DOMContentLoaded',()=>{scan();const observer=new MutationObserver(()=>scan());observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('hashchange',()=>setTimeout(scan,0))});
})();
