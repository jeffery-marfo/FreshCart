-- FreshCart checkout database schema + seed data.
-- Postgres runs any .sql file placed in /docker-entrypoint-initdb.d/ automatically
-- the first time a container starts against an empty data directory — that's the
-- mechanism this file is written for, whether you wire it up by hand, via
-- docker-compose, or via Terraform-provisioned infrastructure.

create table if not exists products (
  id serial primary key,
  name text not null,
  category text not null,
  price_cents integer not null check (price_cents >= 0),
  stock integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id serial primary key,
  customer_name text not null,
  customer_email text not null,
  status text not null default 'placed',
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id serial primary key,
  order_id integer not null references orders(id) on delete cascade,
  product_id integer not null references products(id),
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null
);

create index if not exists order_items_order_id_idx on order_items(order_id);
create index if not exists products_category_idx on products(category);

insert into products (name, category, price_cents, stock) values
  ('Organic Bananas (bunch)', 'produce', 199, 120),
  ('Avocado', 'produce', 149, 80),
  ('Baby Spinach (5oz)', 'produce', 299, 60),
  ('Roma Tomatoes (lb)', 'produce', 179, 90),
  ('Whole Milk (1 gal)', 'dairy', 399, 50),
  ('Free-Range Eggs (dozen)', 'dairy', 449, 70),
  ('Greek Yogurt (32oz)', 'dairy', 549, 40),
  ('Sharp Cheddar Block (8oz)', 'dairy', 399, 35),
  ('Sourdough Bread (loaf)', 'bakery', 499, 30),
  ('Chicken Breast (lb)', 'meat', 599, 45),
  ('Ground Beef (lb)', 'meat', 649, 40),
  ('Extra Virgin Olive Oil (16.9oz)', 'pantry', 899, 25),
  ('Coffee Beans (12oz)', 'pantry', 1099, 30),
  ('Basmati Rice (2lb)', 'pantry', 599, 55),
  ('Sparkling Water (12-pack)', 'beverages', 699, 60)
on conflict do nothing;
