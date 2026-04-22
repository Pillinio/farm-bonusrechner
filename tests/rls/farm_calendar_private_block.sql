-- Requester can update AND delete own private_block regardless of status.
-- Negative: different user cannot delete someone else's private_block.

begin;
do $$
declare
  user_a uuid; user_b uuid; farm_id_val uuid; test_id uuid;
  rc int;
begin
  select p.id, p.farm_id into user_a, farm_id_val
  from profiles p where p.role <> 'owner' and p.farm_id is not null limit 1;
  if user_a is null then raise exception 'no non-owner user for test'; end if;

  -- positive: requester edits + deletes own private_block (status='approved')
  insert into farm_calendar (farm_id, entry_type, person_name, start_date, end_date, status, requested_by)
  values (farm_id_val, 'private_block', 'RLS+', current_date, current_date, 'approved', user_a)
  returning id into test_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  update farm_calendar set notes = 'edited' where id = test_id;
  get diagnostics rc = row_count;
  if rc <> 1 then raise exception 'positive UPDATE failed rc=%', rc; end if;

  delete from farm_calendar where id = test_id;
  get diagnostics rc = row_count;
  if rc <> 1 then raise exception 'positive DELETE failed rc=%', rc; end if;

  reset role;

  -- negative: user_b cannot delete user_a entry
  select p.id into user_b from profiles p
    where p.role <> 'owner' and p.farm_id = farm_id_val and p.id <> user_a limit 1;
  if user_b is null then
    raise notice 'negative test skipped (only one non-owner user)';
  else
    insert into farm_calendar (farm_id, entry_type, person_name, start_date, end_date, status, requested_by)
    values (farm_id_val, 'private_block', 'RLS-', current_date, current_date, 'approved', user_a)
    returning id into test_id;

    perform set_config('request.jwt.claims',
      json_build_object('sub', user_b::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    delete from farm_calendar where id = test_id;
    get diagnostics rc = row_count;
    reset role;
    if rc <> 0 then raise exception 'negative DELETE succeeded unexpectedly rc=%', rc; end if;
  end if;

  raise notice 'farm_calendar_private_block: PASSED';
end $$;
rollback;
