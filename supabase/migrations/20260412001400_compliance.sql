-- Compliance certificates and EU export tracking
create table compliance_certificates (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  cert_type text not null check (cert_type in ('fmd', 'brucellosis', 'eu_approval', 'transport')),
  cert_number text,
  issued_date date not null,
  expiry_date date,
  issuing_authority text,
  audit_rating text,  -- for EU approval: 'passed', 'conditional', 'failed'
  status text not null check (status in ('valid', 'expiring', 'expired', 'pending')) default 'valid',
  notes text,
  document_ref text,  -- link to stored document
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table compliance_certificates enable row level security;
create policy "authenticated_read" on compliance_certificates for select to authenticated using (true);
create policy "owner_write" on compliance_certificates for insert to authenticated
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'owner'));
create policy "owner_update" on compliance_certificates for update to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'owner'));

-- Auto-update status based on expiry
create or replace function update_cert_status() returns trigger as $$
begin
  if NEW.expiry_date is not null then
    if NEW.expiry_date < current_date then
      NEW.status := 'expired';
    elsif NEW.expiry_date < current_date + interval '90 days' then
      NEW.status := 'expiring';
    else
      NEW.status := 'valid';
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_cert_status before insert or update on compliance_certificates
  for each row execute function update_cert_status();

-- Seed with typical Namibian cattle farm certificates
INSERT INTO compliance_certificates (cert_type, cert_number, issued_date, expiry_date, issuing_authority, status, notes) VALUES
  ('fmd', 'FMD-2025-ERF-001', '2025-06-15', '2026-06-15', 'DVS Namibia', 'valid', 'Maul- und Klauenseuche Freiheitszertifikat'),
  ('brucellosis', 'BRUC-2025-ERF-042', '2025-03-01', '2027-03-01', 'DVS Namibia', 'valid', 'Brucellose-Freiheit, letzte Testung März 2025, 100% Abdeckung'),
  ('eu_approval', 'EU-NAM-ERF-2024', '2024-09-01', '2026-09-01', 'European Commission / DVS', 'valid', 'EU-Exportzulassung, letztes Audit September 2024');
