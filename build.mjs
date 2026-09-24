import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
const browserModules=['app.js','variants.mjs','commerce.mjs','operations.mjs','storefront.mjs','product-lifecycle.mjs'];
for (const file of ['index.html','styles.css','interface.css','manifest.webmanifest','service-worker.js']) await cp(file, `dist/${file}`);
for(const file of ['hero.png','macourashop-logo.png','gestion-icon-180.png','gestion-icon-192.png','gestion-icon-512.png','receipt-sans.ttf','receipt-sans-bold.ttf'])await cp('assets/'+file,'dist/assets/'+file);

// Contrôle de session visible dans l'espace gérant.
{
 let html=await readFile('dist/index.html','utf8');
 const anchor='<a href="/#boutique" class="text-link">Voir la boutique ↗</a>';
 if(!html.includes('id="managerLogout"')){
  if(!html.includes(anchor))throw new Error('Admin header anchor not found: logout control cannot be injected safely.');
  html=html.replace(anchor,anchor+'<button class="secondary" id="managerLogout" type="button">Se déconnecter</button>');
  const script=`<script>document.addEventListener('DOMContentLoaded',()=>{const b=document.getElementById('managerLogout');if(!b)return;b.addEventListener('click',async()=>{if(b.disabled)return;b.disabled=true;const old=b.textContent;b.textContent='Déconnexion…';try{const r=await fetch('/api/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}',credentials:'same-origin'});if(!r.ok)throw new Error('logout');location.replace('/admin')}catch{b.disabled=false;b.textContent=old;const t=document.getElementById('toast');if(t){t.textContent='Déconnexion impossible. Réessayez.';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),4500)}}})})</script>`;
  if(!html.includes('</body>'))throw new Error('Closing body tag not found.');
  html=html.replace('</body>',script+'</body>');
  await writeFile('dist/index.html',html);
 }
}

// Corrige la transition de connexion AVANT minification. Chercher une chaîne exacte
// dans le JS déjà minifié est fragile car esbuild peut changer les guillemets/espaces.
let appSource=await readFile('app.js','utf8');
const loginRedirect="location.replace('/admin#overview')";
const loginTransition="await load();if(!state.admin)throw new Error('La session gérant n’a pas pu être confirmée. Réessayez.');history.replaceState(null,'','/admin#overview');await route()";
if(!appSource.includes(loginRedirect))throw new Error('Admin login redirect not found in app.js source.');
appSource=appSource.replace(loginRedirect,loginTransition);
await writeFile('dist/app.js',appSource);

// Minifie chaque module séparément tout en conservant exactement son extension source.
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
