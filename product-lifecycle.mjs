import {merchandisingOf} from './commerce.mjs';

export const PRODUCT_STATES={DRAFT:'draft',LIVE:'live',OUT_OF_STOCK:'out_of_stock',DISCONTINUED:'discontinued',ARCHIVED:'archived'};

export function productLifecycle(product){
 const m=merchandisingOf(product),hasStock=(product.variants||[]).some(v=>Number(v.stock)>0);
 let state=m.lifecycle;
 if(!Object.values(PRODUCT_STATES).includes(state))state=product.active===0?PRODUCT_STATES.ARCHIVED:(hasStock?PRODUCT_STATES.LIVE:PRODUCT_STATES.OUT_OF_STOCK);
 return {state,hasStock,sellable:product.active!==0&&!['draft','discontinued','archived'].includes(state),visible:product.active!==0&&!['draft','archived'].includes(state)};
}

export function lowStockThreshold(product){const n=Number(merchandisingOf(product).lowStockThreshold);return Number.isInteger(n)&&n>=0&&n<=100?n:3}
export function lowStockVariants(product){const threshold=lowStockThreshold(product);return (product.variants||[]).filter(v=>v.stock>0&&v.stock<=threshold)}
export function canDeleteProduct(product,orderLines=[]){return !orderLines.some(line=>line.product_id===product.id||(product.variants||[]).some(v=>v.id===line.variant_id))}
