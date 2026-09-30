-- Profile describes the latest submitted career; score remains the account's best.
alter table public.leaderboard_entries
  add column if not exists avatar_url text not null default '',
  add column if not exists team_name text not null default '',
  add column if not exists team_logo text not null default '',
  add column if not exists season_id text not null default '',
  add column if not exists title text not null default '新手经理';

-- Replace the old signature rather than leaving a second RPC overload.
drop function if exists public.submit_leaderboard_score(text, text, integer);
create or replace function public.submit_leaderboard_score(
  p_puid text, p_display_name text, p_score integer,
  p_avatar_url text default '', p_team_name text default '',
  p_team_logo text default '', p_season_id text default '',
  p_title text default '新手经理'
)
returns public.leaderboard_entries
language plpgsql
security definer
set search_path = public
as $$
declare result public.leaderboard_entries;
begin
  insert into public.leaderboard_entries as existing (
    puid, display_name, score, avatar_url, team_name, team_logo, season_id, title, created_at, updated_at
  ) values (
    p_puid, p_display_name, p_score, p_avatar_url, p_team_name, p_team_logo, p_season_id, p_title, now(), now()
  )
  on conflict (puid) do update
    set display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        team_name = excluded.team_name,
        team_logo = excluded.team_logo,
        season_id = excluded.season_id,
        title = excluded.title,
        score = case
          when existing.score < excluded.score and existing.updated_at <= now() - interval '1 minute'
          then excluded.score else existing.score end,
        updated_at = case
          when existing.score < excluded.score and existing.updated_at <= now() - interval '1 minute'
          then now() else existing.updated_at end
  returning * into result;
  return result;
end;
$$;

revoke all on function public.submit_leaderboard_score(text, text, integer, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_leaderboard_score(text, text, integer, text, text, text, text, text)
  to service_role;
