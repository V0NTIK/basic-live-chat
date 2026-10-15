create extension if not exists pgcrypto;

-- Supabase's optional automatic-RLS helper is trigger-only; do not expose it as RPC.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room text not null check (room ~ '^[A-Za-z0-9_-]{1,64}$'),
  display_name text not null check (char_length(display_name) between 1 and 32),
  body text not null check (char_length(body) between 1 and 1000),
  client_id text,
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_at_idx
  on public.messages (room, created_at desc);

alter table public.messages enable row level security;

revoke all on table public.messages from anon, authenticated;
grant usage on schema public to anon;
grant select, insert on table public.messages to anon;

create policy "Public rooms are readable"
  on public.messages for select
  to anon
  using (true);

create policy "Valid public messages are insertable"
  on public.messages for insert
  to anon
  with check (
    room ~ '^[A-Za-z0-9_-]{1,64}$'
    and char_length(display_name) between 1 and 32
    and char_length(body) between 1 and 1000
    and (client_id is null or char_length(client_id) <= 64)
  );

comment on table public.messages is
  'Unauthenticated demo chat messages. RLS permits only SELECT and validated INSERT for anon.';
