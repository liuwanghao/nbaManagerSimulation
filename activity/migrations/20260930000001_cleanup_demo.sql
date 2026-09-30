-- Remove the empty demo table recreated by the platform during environment activation.
do $$ begin
  if exists (select 1 from public.demo_items limit 1) then
    raise exception 'demo_items is not empty; preserve its data';
  end if;
end $$;

drop table public.demo_items;
