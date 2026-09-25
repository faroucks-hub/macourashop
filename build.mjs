import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import { cp, mkdir, rm, readFile, writeFile, appendFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
const browserModules=['app.js','variants.mjs','commerce.mjs','operations.mjs','storefront.mjs','product-lifecycle.mjs'];
for (const file of ['index.html','styles.css','interface.css','manifest.webmanifest','service-worker.js']) await cp(file, `dist/${file}`);
for(const file of ['hero.png','macourashop-logo.png','gestion-icon-180.png','gestion-icon-192.png','gestion-icon-512.png','receipt-sans.ttf','receipt-sans-bold.ttf'])await cp('assets/'+file,'dist/assets/'+file);

// Production visual layer. The storefront hero is intentionally isolated from all legacy .hero rules.
await appendFile('dist/interface.css',`\n/* Brand artwork */\n.store-header .brand-logo{display:flex;align-items:center;height:72px;overflow:visible}\n.store-header .brand-image{position:relative;width:220px;height:64px;overflow:visible;display:flex;align-items:center;mix-blend-mode:multiply}\n.store-header .brand-image img{position:static!important;display:block!important;width:100%!important;height:100%!important;max-width:100%!important;object-fit:contain!important;object-position:left center!important}\nfooter .brand-image{position:relative;width:230px;height:72px;overflow:visible;display:flex;align-items:center;mix-blend-mode:multiply}\nfooter .brand-image img{position:static!important;display:block!important;width:100%!important;height:100%!important;max-width:100%!important;object-fit:contain!important;object-position:left center!important}\n@media(max-width:1150px){.store-header .brand-logo{height:64px}.store-header .brand-image{width:190px;height:58px}}\n@media(max-width:700px){.store-header .brand-logo{height:48px}.store-header .brand-image{width:130px;height:44px}footer .brand-image{width:200px;height:64px}}\n@media(max-width:370px){.store-header .brand-image{width:110px;height:40px}}\n@media(max-width:340px){.store-header .brand-image{width:96px;height:36px}}\n\n/* Macoura hero v2: independent component, no pseudo-elements, no inherited legacy hero layout. */\n.macoura-hero-v2{position:relative;width:100%;height:min(680px,calc(100vh - 104px));min-height:560px;overflow:hidden;background:#dfcbb4;isolation:isolate}\n.macoura-hero-v2__media{position:absolute;inset:0;z-index:0;width:100%;height:100%;overflow:hidden}\n.macoura-hero-v2__media img{display:block;width:100%;height:100%;max-width:none;object-fit:cover;object-position:center center}\n.macoura-hero-v2__copy{position:absolute;z-index:2;left:7vw;top:50%;transform:translateY(-50%);width:min(510px,44vw);background:transparent}\n.macoura-hero-v2__copy .eyebrow{font-size:10px;font-weight:800;letter-spacing:.22em;color:var(--plum);margin:0 0 18px}\n.macoura-hero-v2__copy h1{font:500 clamp(54px,7vw,105px)/.88 Georgia,serif;margin:0;letter-spacing:-.055em;color:var(--ink)}\n.macoura-hero-v2__copy h1 em{color:var(--plum);font-weight:400}\n.macoura-hero-v2__copy>p:not(.eyebrow){font:18px/1.6 Georgia,serif;max-width:430px;color:#4f4142;margin:27px 0}\n.macoura-hero-v2__note{position:absolute;z-index:2;right:4vw;bottom:28px;background:#fff;padding:17px 22px;display:flex;flex-direction:column;box-shadow:var(--shadow);font-size:11px}\n.macoura-hero-v2__note span{margin-top:5px;color:var(--muted)}\n@media(max-width:900px){.macoura-hero-v2{height:650px}.macoura-hero-v2__media img{object-position:62% center}.macoura-hero-v2__copy{left:6vw;right:6vw;top:auto;bottom:45px;transform:none;width:auto}.macoura-hero-v2__copy h1{font-size:58px}.macoura-hero-v2__copy>p:not(.eyebrow){font-size:15px;margin:18px 0}.macoura-hero-v2__note{display:none}}\n@media(max-width:560px){.macoura-hero-v2{min-height:590px}.macoura-hero-v2__media img{object-position:62% center}.macoura-hero-v2__copy{bottom:30px}.macoura-hero-v2__copy h1{font-size:49px}}\n`);

// Build final HTML once. Replace the legacy hero markup entirely with the isolated v2 component.
{
 let html=await readFile('dist/index.html','utf8');
 if(!html.includes('href="/interface.css"')){
  const css='<link rel="stylesheet" href="/styles.css">';
  if(!html.includes(css))throw new Error('styles.css link not found');
  html=html.replace(css,css+'<link rel="stylesheet" href="/interface.css">');
 }
 const heroStart='<section class="hero">';
 const heroEnd='</section>\n <section class="benefits">';
 const start=html.indexOf(heroStart);
 const end=html.indexOf(heroEnd,start);
 if(start<0||end<0)throw new Error('Legacy hero block not found; refusing unsafe replacement.');
 const heroV2=`<section class="macoura-hero-v2" aria-label="Collection MacouraShop"><div class="macoura-hero-v2__media"><img src="/assets/hero.png?v=2" alt="Visuel éditorial Macourashop : robes, ensemble ivoire et tenue noire" width="1672" height="941" fetchpriority="high"></div><div class="macoura-hero-v2__copy"><p class="eyebrow">VOTRE ALLURE. VOTRE SIGNATURE.</p><h1>L’élégance,<br><em>simplement.</em></h1><p>Des pièces féminines choisies pour celles qui veulent être remarquées sans jamais en faire trop.</p><a class="primary" href="/#catalogue">Découvrir la collection <span>→</span></a></div><div class="macoura-hero-v2__note"><b>L’ESPRIT MACOURA</b><span>Des coupes fluides. Des détails précieux.</span></div></section>\n <section class="benefits">`;
 html=html.slice(0,start)+heroV2+html.slice(end+heroEnd.length);
 const anchor='<a href="/#boutique" class="text-link">Voir la boutique ↗</a>';
 if(!html.includes('id="managerLogout"')){
  if(!html.includes(anchor))throw new Error('Admin header anchor not found: logout control cannot be injected safely.');
  html=html.replace(anchor,anchor+'<button class="secondary" id="managerLogout" type="button">Se déconnecter</button>');
  const script=`<script>document.addEventListener('DOMContentLoaded',()=>{const b=document.getElementById('managerLogout');if(!b)return;b.addEventListener('click',async()=>{if(b.disabled)return;b.disabled=true;const old=b.textContent;b.textContent='Déconnexion…';try{const r=await fetch('/api/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}',credentials:'same-origin'});if(!r.ok)throw new Error('logout');location.replace('/admin')}catch{b.disabled=false;b.textContent=old;const t=document.getElementById('toast');if(t){t.textContent='Déconnexion impossible. Réessayez.';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),4500)}}})})</script>`;
  if(!html.includes('</body>'))throw new Error('Closing body tag not found.');
  html=html.replace('</body>',script+'</body>');
 }
 await writeFile('dist/index.html',html);
}

let appSource=await readFile('app.js','utf8');
const loginRedirect="location.replace('/admin#overview')";
const loginTransition="await load();if(!state.admin)throw new Error('La session gérant n’a pas pu être confirmée. Réessayez.');history.replaceState(null,'','/admin#overview');await route()";
if(!appSource.includes(loginRedirect))throw new Error('Admin login redirect not found in app.js source.');
appSource=appSource.replace(loginRedirect,loginTransition);
await writeFile('dist/app.js',appSource);

await Promise.all(browserModules.map(async file=>{
  const ext=file.endsWith('.mjs')?'.mjs':'.js';
  const options={outfile:'dist/'+file,bundle:false,format:'esm',platform:'browser',minify:true,target:['es2020'],outExtension:{'.js':ext}};
  if(file==='app.js') await build({...options,stdin:{contents:appSource,sourcefile:'app.js',loader:'js',resolveDir:process.cwd()}});
  else await build({...options,entryPoints:[file]});
}));
await build({entryPoints:['reports.mjs'],bundle:true,format:'esm',platform:'browser',outfile:'dist/reports.js',minify:true,target:['es2020']});
await build({entryPoints:['receipt.mjs'],bundle:true,format:'esm',platform:'browser',outfile:'dist/receipt.js',minify:true,target:['es2020']});
const assets={};
for(const [file,type] of [['index.html','text/html; charset=utf-8'],['styles.css','text/css; charset=utf-8'],['interface.css','text/css; charset=utf-8'],['app.js','text/javascript; charset=utf-8'],['variants.mjs','text/javascript; charset=utf-8'],['commerce.mjs','text/javascript; charset=utf-8'],['operations.mjs','text/javascript; charset=utf-8'],['storefront.mjs','text/javascript; charset=utf-8'],['product-lifecycle.mjs','text/javascript; charset=utf-8'],['manifest.webmanifest','application/manifest+json'],['service-worker.js','text/javascript; charset=utf-8'],['assets/hero.png','image/png'],['assets/macourashop-logo.png','image/png'],['assets/gestion-icon-180.png','image/png'],['assets/gestion-icon-192.png','image/png'],['assets/gestion-icon-512.png','image/png'],['assets/receipt-sans.ttf','font/ttf'],['assets/receipt-sans-bold.ttf','font/ttf']]) assets['/'+file]={type,data:(await readFile('dist/'+file)).toString('base64')};
assets['/reports.js']={type:'text/javascript; charset=utf-8',data:(await readFile('dist/reports.js')).toString('base64')};
assets['/receipt.js']={type:'text/javascript; charset=utf-8',data:(await readFile('dist/receipt.js')).toString('base64')};
await mkdir('dist/server',{recursive:true});
const shared=(await readFile('variants.mjs','utf8')).replace(/^export /gm,'');
const commerce=(await readFile('commerce.mjs','utf8')).replace(/^export /gm,'');
const operations=(await readFile('operations.mjs','utf8')).replace(/^export /gm,'');
const auth=(await readFile('customer-auth.mjs','utf8')).replace(/^export /gm,'');
const worker=(await readFile('worker.mjs','utf8')).replace(/^import \{[^\n]+\} from '\.\/customer-auth\.mjs';\s*$/gm,'').replace(/^import \{[^\n]+\} from '\.\/(?:variants|commerce|operations)\.mjs';\s*$/gm,'');
const output=`const STATIC_ASSETS=${JSON.stringify(assets)};\n`+shared+'\n'+commerce+'\n'+operations+'\n'+auth+'\n'+worker;
execFileSync(process.execPath,['--input-type=module','--check'],{input:output});
await writeFile('dist/server/index.js',output);
await rm('public',{recursive:true,force:true});
await mkdir('public/assets',{recursive:true});
for(const file of ['index.html','styles.css','interface.css','app.js','variants.mjs','commerce.mjs','operations.mjs','storefront.mjs','product-lifecycle.mjs','manifest.webmanifest','service-worker.js'])await cp('dist/'+file,'public/'+file);
for(const file of ['hero.png','macourashop-logo.png','gestion-icon-180.png','gestion-icon-192.png','gestion-icon-512.png','receipt-sans.ttf','receipt-sans-bold.ttf'])await cp('assets/'+file,'public/assets/'+file);
await cp('dist/reports.js','public/reports.js');
await cp('dist/receipt.js','public/receipt.js');