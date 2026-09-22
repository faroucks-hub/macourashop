import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, check, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const products=sqliteTable('products',{
 id:text().primaryKey(), name:text().notNull(), category:text().notNull(), description:text().notNull(),
 eur:integer().notNull(), xof:integer().notNull(), image:text().notNull(), images:text().notNull().default('[]'), merchandising:text().notNull().default('{}'), costs:text().notNull().default('{}'), active:integer().notNull().default(1), demo:integer().notNull().default(0), revision:integer().notNull().default(1), created:text().notNull()
}, t=>[check('prices_nonnegative',sql`${t.eur} >= 0 AND ${t.xof} >= 0`)]);
export const variants=sqliteTable('variants',{
 id:text().primaryKey(), product_id:text().notNull().references(()=>products.id), size:text().notNull(), color:text().notNull(), stock:integer().notNull()
},t=>[check('stock_nonnegative',sql`${t.stock} >= 0`),uniqueIndex('variant_unique').on(t.product_id,t.size,t.color)]);
export const settings=sqliteTable('settings',{id:integer().primaryKey(),data:text().notNull(),revision:integer().notNull().default(1)});
export const orders=sqliteTable('orders',{
 id:text().primaryKey(), user_id:text().notNull(), request_key:text().notNull(), customer:text().notNull(), phone:text().notNull(), address:text().notNull(), country:text().notNull(), zone:text().notNull(), currency:text().notNull(), subtotal:integer().notNull(), shipping:integer().notNull(), total:integer().notNull(), tracking_code:text(), revision:integer().notNull().default(1), delivery_cost:integer(), details:text().notNull().default('{}'), status:text().notNull().default('Nouvelle'), payment:text().notNull().default('cod'), paid:integer().notNull().default(0), demo:integer().notNull().default(0), created:text().notNull()
},t=>[uniqueIndex('orders_tracking').on(t.tracking_code),uniqueIndex('orders_request').on(t.user_id,t.request_key),index('orders_user').on(t.user_id,t.created)]);
export const lines=sqliteTable('order_lines',{id:text().primaryKey(),order_id:text().notNull().references(()=>orders.id),variant_id:text().notNull().references(()=>variants.id),name:text().notNull(),size:text().notNull(),color:text().notNull(),quantity:integer().notNull(),costs:text().notNull().default('{}'),price:integer().notNull()},t=>[index('lines_order').on(t.order_id)]);
export const favorites=sqliteTable('favorites',{id:text().primaryKey(),user_id:text().notNull(),product_id:text().notNull().references(()=>products.id)},t=>[uniqueIndex('favorite_unique').on(t.user_id,t.product_id)]);

export const orderEvents=sqliteTable('order_events',{id:text().primaryKey(),order_id:text().notNull().references(()=>orders.id),status:text().notNull(),note:text().notNull().default(''),created:text().notNull()},t=>[index('events_order').on(t.order_id,t.created)]);
export const trackingLimits=sqliteTable('tracking_limits',{id:text().primaryKey(),window:integer().notNull(),attempts:integer().notNull()});
export const expenses=sqliteTable('expenses',{id:text().primaryKey(),request_key:text().notNull().unique(),currency:text().notNull(),amount:integer().notNull(),category:text().notNull(),description:text().notNull(),spent_on:text().notNull(),created:text().notNull(),voided:integer().notNull().default(0)},t=>[index('expenses_date').on(t.spent_on)]);
export const inventoryMovements=sqliteTable('inventory_movements',{
 id:text().primaryKey(),variant_id:text().notNull().references(()=>variants.id),type:text().notNull(),quantity:integer().notNull(),available_delta:integer().notNull(),unusable_delta:integer().notNull().default(0),expected_physical:integer(),counted_physical:integer(),supplier:text().notNull().default(''),note:text().notNull(),currency:text(),unit_cost:integer(),created:text().notNull()
},t=>[index('inventory_movements_variant_created').on(t.variant_id,t.created),index('inventory_movements_created').on(t.created)]);
