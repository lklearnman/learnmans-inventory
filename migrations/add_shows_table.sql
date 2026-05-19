-- 矿珍库:展会主表 + show_items.show_id 外键
-- 2026-05-19 C 组 mock 落地:展会从字符串(show_items.show_name)升级为可关联实体
-- 兼容旧数据:show_items.show_id 可空,旧数据仍能通过 show_name 文本显示
--
-- 用法:在 Supabase Dashboard → SQL Editor 粘贴本文件后 Run。RLS + allow_all policy 已包含,不要关 RLS。

-- ============== 1. shows 主表 ==============
create table if not exists public.shows (
  id text primary key,
  name text not null,
  start_date date,
  end_date date,
  status text not null default 'active',  -- active / ended / archived
  live boolean not null default true,     -- 是否正在进行 (UI 红点)
  ts timestamptz not null default now()
);

-- RLS + allow_all (匿名 key 需要,千万不要关)
alter table public.shows enable row level security;

drop policy if exists "allow_all" on public.shows;
create policy "allow_all" on public.shows
  for all
  using (true)
  with check (true);

-- 索引:按 live / status / 开始日期排序
create index if not exists shows_live_idx on public.shows(live);
create index if not exists shows_start_date_idx on public.shows(start_date);

-- ============== 2. show_items 加 show_id 外键(可空,兼容旧数据) ==============
alter table public.show_items
  add column if not exists show_id text references public.shows(id) on delete set null;

create index if not exists show_items_show_id_idx on public.show_items(show_id);

-- ============== 3. (可选)给旧数据兜底:把 show_name 唯一值迁成 shows 行 ==============
-- 用户可视情况手动跑下面这段;不跑也行,旧 show_items 行 show_id 留空,UI 用 show_name 文本 fallback。
-- insert into public.shows (id, name, status, live, ts)
-- select distinct
--   'legacy_' || md5(show_name) as id,
--   show_name as name,
--   'archived' as status,
--   false as live,
--   min(ts) as ts
-- from public.show_items
-- where show_name is not null and show_name <> ''
-- group by show_name
-- on conflict (id) do nothing;
--
-- update public.show_items si
--   set show_id = 'legacy_' || md5(si.show_name)
-- where si.show_id is null and si.show_name is not null and si.show_name <> '';
