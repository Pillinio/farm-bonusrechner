-- Storage Bucket für hochgeladene PDFs (LPO, Meatco, Bank, etc.)
-- Die Datei bleibt nach dem Verarbeiten liegen (Audit-Trail). Name im Bucket:
--   <source_type>/<yyyy-mm-dd>-<original-filename>.pdf
-- Zugriff: authentifizierte User upload + read eigener Dateien; Owner reads all.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'incoming-pdfs',
  'incoming-pdfs',
  false,
  30 * 1024 * 1024,  -- 30 MB pro Datei
  array['application/pdf']::text[]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS ist auf storage.objects Default aktiv. Explizite Policies:

drop policy if exists "incoming_pdfs_auth_upload" on storage.objects;
create policy "incoming_pdfs_auth_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'incoming-pdfs'
    and owner = auth.uid()
  );

drop policy if exists "incoming_pdfs_own_read" on storage.objects;
create policy "incoming_pdfs_own_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'incoming-pdfs'
    and (
      owner = auth.uid()
      or (select role from profiles where id = auth.uid()) = 'owner'
    )
  );

drop policy if exists "incoming_pdfs_owner_delete" on storage.objects;
create policy "incoming_pdfs_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'incoming-pdfs'
    and (select role from profiles where id = auth.uid()) = 'owner'
  );
