import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
for (const file of ['index.html','styles.css','interface.css','app.js','variants.mjs','commerce.mjs','operations.mjs','storefront.mjs','product-lifecycle.mjs','manifest.webmanifest','service-worker.js']) await cp(file, `dist/${file}`);
for(const file of ['hero.png','macourashop-logo.png','gestion-icon-180.png','gestion-icon-192.png','gestion-icon-512.png','receipt-sans.ttf','receipt-sans-bold.ttf'])await cp('assets/'+file,'dist/assets/'+file);
await build({entryPoints:['reports.mjs'],bundle:true,format:'esm',platform:'browser',outfile:'dist/reports.js',minify:true});
await build({entryPoints:['receipt.mjs'],bundle:true,format:'esm',platform:'browser',outfile:'dist/receipt.js',minify:true});
const assets={};
for(const [file,type] of [['index.html','text/html; charset=utf-8'],['styles.css','text/css; charset=utf-8'],['interface.css','text/css; charset=utf-8'],['app.js','text/javascript; charset=utf-8'],['variants.mjs','text/javascript; charset=utf-8'],['commerce.mjs','text/javascript; charset=utf-8'],['operations.mjs','text/javascript; charset=utf-8'],['storefront.mjs','text/javascript; charset=utf-8'],['product-lifecycle.mjs','text/javascript; charset=utf-8'],['manifest.webmanifest','application/manifest+json'],['service-worker.js','text/javascript; charset=utf-8'],['assets/hero.png','image/png'],['assets/macourashop-logo.png','image/png'],['assets/gestion-icon-180.png','image/png'],['assets/gestion-icon-192.png','image/png'],['assets/gestion-icon-512.png','image/png'],['assets/receipt-sans.ttf','font/ttf'],['assets/receipt-sans-bold.ttf','font/ttf']]) assets['/'+file]={type,data:(await readFile(file)).toString('base64')};
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

// Sortie statique utilisée par Vercel. Les routes /api et /media restent
// servies par la fonction Edge ; le navigateur reçoit ces fichiers depuis public.
await rm('public',{recursive:true,force:true});
await mkdir('public/assets',{recursive:true});
for(const file of ['index.html','styles.css','interface.css','app.js','variants.mjs','commerce.mjs','operations.mjs','storefront.mjs','product-lifecycle.mjs','manifest.webmanifest','service-worker.js'])await cp(file,'public/'+file);
for(const file of ['hero.png','macourashop-logo.png','gestion-icon-180.png','gestion-icon-192.png','gestion-icon-512.png','receipt-sans.ttf','receipt-sans-bold.ttf'])await cp('assets/'+file,'public/assets/'+file);
await cp('dist/reports.js','public/reports.js');
await cp('dist/receipt.js','public/receipt.js');
