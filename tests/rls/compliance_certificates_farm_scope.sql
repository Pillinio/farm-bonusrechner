-- Farm-scoped SELECT on compliance_certificates:
-- positive: user sees own farm's certs; negative: can't see another farm's.

begin;
do $$
declare
  uid uuid; fid uuid; other_fid uuid;
  rc_own int; rc_other int; own_id uuid; other_id uuid;
begin
  select p.id, p.farm_id into uid, fid from profiles p where p.farm_id is not null limit 1;
  if fid is null then raise notice 'skipped: no user with farm_id'; return; end if;

  -- create a synthetic second farm + cert for negative test
  insert into farms (id, name) values (gen_random_uuid(), 'rls-test-other-farm')
  returning id into other_fid;
  insert into compliance_certificates (farm_id, cert_type, issued_date, expiry_date, status)
  values (other_fid, 'fmd', current_date - 1, current_date + 30, 'valid')
  returning id into other_id;

  insert into compliance_certificates (farm_id, cert_type, issued_date, expiry_date, status)
  values (fid, 'fmd', current_date - 1, current_date + 30, 'valid')
  returning id into own_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into rc_own   from compliance_certificates where id = own_id;
  select count(*) into rc_other from compliance_certificates where id = other_id;

  reset role;

  if rc_own <> 1   then raise exception 'POSITIVE failed rc_own=%', rc_own; end if;
  if rc_other <> 0 then raise exception 'NEGATIVE failed rc_other=% (cross-farm leak)', rc_other; end if;
  raise notice 'compliance_certificates: PASSED';
end $$;
rollback;
