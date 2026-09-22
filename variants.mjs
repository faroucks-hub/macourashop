export const STANDARD_SIZES=['XS','S','M','L','XL','XXL'];
export const DEFAULT_COLORS=[
 {name:'Noir',hex:'#222222'},{name:'Blanc',hex:'#FFFFFF'},{name:'Ivoire',hex:'#F4EBDC'},
 {name:'Beige',hex:'#CDB69B'},{name:'Marron',hex:'#77513D'},{name:'Gris',hex:'#909090'},
 {name:'Bleu',hex:'#3467AD'},{name:'Bleu marine',hex:'#243753'},{name:'Rouge',hex:'#BE343F'},
 {name:'Bordeaux',hex:'#681F3D'},{name:'Rose',hex:'#DA9DB0'},{name:'Violet',hex:'#80518F'},
 {name:'Vert',hex:'#487B57'},{name:'Kaki',hex:'#798256'},{name:'Jaune',hex:'#E3BF44'},
 {name:'Orange',hex:'#D98442'},{name:'Doré',hex:'#BB9751'},{name:'Argenté',hex:'#B8BDC3'}
];
export const colorKey=name=>String(name).trim().toLocaleLowerCase('fr');
export const variantKey=(size,color)=>JSON.stringify([size,color]);
export function paletteFor(colors,variants=[]){const palette=(colors||DEFAULT_COLORS).map(c=>({...c}));for(const v of variants){if(!palette.some(c=>c.name===v.color)){const known=palette.find(c=>colorKey(c.name)===colorKey(v.color))||DEFAULT_COLORS.find(c=>colorKey(c.name)===colorKey(v.color));palette.push({name:v.color,hex:known?.hex||'#B6AAA1',legacy:true})}}return palette}
export function stockDraft(variants=[]){return new Map(variants.map(v=>[variantKey(v.size,v.color),{stock:v.stock,enabled:true}]))}
export function selectedVariants(sizes,colors,draft){const result=[];for(const size of sizes)for(const color of colors){const entry=draft.get(variantKey(size,color));if(entry?.enabled)result.push({size,color,stock:entry.stock})}return result}
export function availableVariant(variants,size,color){return variants.find(v=>v.size===size&&v.color===color&&v.stock>0)||null}
