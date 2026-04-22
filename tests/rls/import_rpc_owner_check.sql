-- Direct PostgREST RPC calls by non-owner must fail with 42501.
begin;
do $$
declare uid uuid; got boolean := false;
begin
  select id into uid from profiles where role is not null and role <> 'owner' limit 1;
  if uid is null then raise notice 'skipped: no non-owner user'; return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform rollback_import(gen_random_uuid());
  exception when insufficient_privilege then got := true;
  end;
  reset role;

  if not got then raise exception 'non-owner could call rollback_import'; end if;
  raise notice 'import_rpc_owner_check: PASSED';
end $$;
rollback;
