import { readFile, writeFile } from 'node:fs/promises';

const file = 'app.js';
let source = await readFile(file, 'utf8');

const domainRow = /(\['Adresse actuelle',')[^']+(',\s*'Adresse technique utilisable pendant la préparation\.',\s*'ok'\])/;
if (!domainRow.test(source)) {
  throw new Error('Adresse actuelle row not found in app.js; refusing an unsafe domain patch.');
}

source = source.replace(domainRow, "$1macourashop.vercel.app$2");

await writeFile(file, source);
console.log('Production domain normalized to macourashop.vercel.app');
