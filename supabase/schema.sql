begin;

create table if not exists public.products (
 id text primary key,
 name text not null,
 category text not null,
 description text not null,
 eur integer not null check (eur >= 0),
 xof integer not null check (xof >= 0),
 image text not null,
 images text not null default '[]',
 merchandising text not null default '{}',
 costs text not null default '{}',
 active integer not null default 1,
 demo integer not null default 0,
 revision integer not null default 1,
 created text not null
);

create table if not exists public.variants (
 id text primary key,
 product_id text not null references public.products(id),
 size text not null,
 color text not null,
 stock integer not null check (stock >= 0),
 unique(product_id,size,color)
);

create table if not exists public.settings (
 id integer primary key,
 data text not null,
 revision integer not null default 1
);

create table if not exists public.orders (
 id text primary key,
 user_id text not null,
 request_key text not null,
 customer text not null,
 phone text not null,
 address text not null,
 country text not null,
 zone text not null,
 currency text not null,
 subtotal integer not null,
 shipping integer not null,
 total integer not null,
 tracking_code text unique,
 revision integer not null default 1,
 delivery_cost integer,
 details text not null default '{}',
 status text not null default 'Nouvelle',
 payment text not null default 'cod',
 paid integer not null default 0,
 demo integer not null default 0,
 created text not null,
 unique(user_id,request_key)
);

create index if not exists orders_user on public.orders(user_id,created);

create table if not exists public.order_lines (
 id text primary key,
 order_id text not null references public.orders(id),
 variant_id text not null references public.variants(id),
 name text not null,
 size text not null,
 color text not null,
 quantity integer not null,
 costs text not null default '{}',
 price integer not null
);

create index if not exists lines_order on public.order_lines(order_id);

create table if not exists public.favorites (
 id text primary key,
 user_id text not null,
 product_id text not null references public.products(id),
 unique(user_id,product_id)
);

create table if not exists public.order_events (
 id text primary key,
 order_id text not null references public.orders(id),
 status text not null,
 note text not null default '',
 created text not null
);

create index if not exists events_order on public.order_events(order_id,created);

create table if not exists public.tracking_limits (
 id text primary key,
 "window" integer not null,
 attempts integer not null
);

create table if not exists public.expenses (
 id text primary key,
 request_key text not null unique,
 currency text not null,
 amount integer not null,
 category text not null,
 description text not null,
 spent_on text not null,
 created text not null,
 voided integer not null default 0
);

create index if not exists expenses_date on public.expenses(spent_on);

create table if not exists public.inventory_movements (
 id text primary key,
 variant_id text not null references public.variants(id),
 type text not null,
 quantity integer not null,
 available_delta integer not null,
 unusable_delta integer not null default 0,
 expected_physical integer,
 counted_physical integer,
 supplier text not null default '',
 note text not null,
 currency text,
 unit_cost integer,
 created text not null
);

create index if not exists inventory_movements_variant_created on public.inventory_movements(variant_id,created);
create index if not exists inventory_movements_created on public.inventory_movements(created);

alter table public.products enable row level security;
alter table public.variants enable row level security;
alter table public.settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.favorites enable row level security;
alter table public.order_events enable row level security;
alter table public.tracking_limits enable row level security;
alter table public.expenses enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on all tables in schema public from anon, authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('macourashop-private','macourashop-private',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

commit;
