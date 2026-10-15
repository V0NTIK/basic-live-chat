create extension if not exists pgcrypto;

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
grant all on table public.messages to service_role;

comment on table public.messages is
  'Chat messages accessed only by the Render server through the service role.';
