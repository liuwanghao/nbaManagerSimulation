-- Adapt the platform's pre-provisioned demo_items only after inspecting the target activity.
-- Preserve existing data: an occupied demo table requires an explicit migration plan.
do $$ begin
  if exists (select 1 from public.demo_items limit 1) then
    raise exception 'demo_items is not empty; inspect its data before converting it';
  end if;
end $$;

alter table public.demo_items rename to leaderboard_entries;
alter table public.leaderboard_entries
  alter column puid set not null,
  add column score integer not null default 0,
  add column display_name text not null default '虎扑经理',
  add column updated_at timestamptz not null default now(),
  add constraint leaderboard_score_range check (score between 0 and 1000000);

create unique index leaderboard_entries_puid_uidx on public.leaderboard_entries (puid);
create index leaderboard_entries_score_idx
  on public.leaderboard_entries (score desc, updated_at asc, id asc);
alter table public.leaderboard_entries disable row level security;

create or replace function public.submit_leaderboard_score(
  p_puid text, p_display_name text, p_score integer
)
returns public.leaderboard_entries
language plpgsql
security definer
set search_path = public
as $$
declare result public.leaderboard_entries;
begin
  insert into public.leaderboard_entries (puid, display_name, score, created_at, updated_at)
  values (p_puid, p_display_name, p_score, now(), now())
  on conflict (puid) do update
    set display_name = excluded.display_name,
        score = excluded.score,
        updated_at = now()
    where public.leaderboard_entries.score < excluded.score
      and public.leaderboard_entries.updated_at <= now() - interval '1 minute'
  returning * into result;

  if result.id is null then
    select * into result from public.leaderboard_entries where puid = p_puid;
  end if;
  return result;
end;
$$;

revoke all on public.leaderboard_entries from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update on public.leaderboard_entries to service_role;
revoke all on function public.submit_leaderboard_score(text, text, integer) from public, anon, authenticated;
grant execute on function public.submit_leaderboard_score(text, text, integer) to service_role;
