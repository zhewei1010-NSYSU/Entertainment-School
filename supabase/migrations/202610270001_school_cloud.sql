-- Run once in the SAME Supabase project as Finance-Achievement.
-- These objects are separate from finance_books; this script never changes finance data.
begin;
create table public.school_journals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  revision bigint not null check (revision > 0),
  mutation_id uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.school_journals enable row level security;
create policy "Read own school journal" on public.school_journals
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.school_journals from anon, authenticated;
grant select on public.school_journals to authenticated;
create function public.save_school_journal(p_owner uuid, p_document jsonb, p_expected_revision bigint, p_mutation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  current_journal public.school_journals%rowtype;
begin
  if actor is null or actor is distinct from p_owner then
    raise exception 'Authentication or owner mismatch' using errcode = '28000';
  end if;
  if p_mutation_id is null or p_expected_revision is null or p_expected_revision < 0
     or p_document is null or jsonb_typeof(p_document) <> 'object'
     or jsonb_typeof(p_document->'records') is distinct from 'array'
     or jsonb_typeof(p_document->'photos') is distinct from 'array'
     or octet_length(p_document::text) > 5000000 then
    raise exception 'Invalid journal' using errcode = '22023';
  end if;
  if jsonb_array_length(p_document->'records') > 10000 or jsonb_array_length(p_document->'photos') > 40000 then
    raise exception 'Journal limit exceeded' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('school:' || actor::text, 0));
  select * into current_journal from public.school_journals where user_id = actor for update;
  if found then
    if current_journal.mutation_id = p_mutation_id then
      return jsonb_build_object('document',current_journal.document,'revision',current_journal.revision,'mutation_id',current_journal.mutation_id);
    end if;
    if current_journal.revision <> p_expected_revision then
      raise exception 'Journal changed on another device' using errcode = '40001';
    end if;
    update public.school_journals set document=p_document,revision=revision+1,mutation_id=p_mutation_id,updated_at=now()
      where user_id=actor returning * into current_journal;
  else
    if p_expected_revision <> 0 then raise exception 'Journal missing or changed' using errcode='40001'; end if;
    insert into public.school_journals(user_id,document,revision,mutation_id) values(actor,p_document,1,p_mutation_id) returning * into current_journal;
  end if;
  return jsonb_build_object('document',current_journal.document,'revision',current_journal.revision,'mutation_id',current_journal.mutation_id);
end;
$$;
revoke all on function public.save_school_journal(uuid,jsonb,bigint,uuid) from public,anon;
grant execute on function public.save_school_journal(uuid,jsonb,bigint,uuid) to authenticated;
alter publication supabase_realtime add table public.school_journals;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('school-photos','school-photos',false,1200000,array['image/jpeg','image/png','image/webp']);
create policy "Read own school photos" on storage.objects
  for select to authenticated using (
    bucket_id='school-photos' and (storage.foldername(name))[1]=(select auth.uid())::text
  );
create policy "Upload own school photos" on storage.objects
  for insert to authenticated with check (
    bucket_id='school-photos' and (storage.foldername(name))[1]=(select auth.uid())::text
    and array_length(string_to_array(name,'/'),1)=2
    and (storage.filename(name)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
-- Restrictive guards prevent unrelated permissive policies in a shared project
-- from accidentally granting access to this private bucket. Other buckets are unaffected.
create policy "School photo read guard" on storage.objects as restrictive
  for select to public using (bucket_id <> 'school-photos' or (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "School photo insert guard" on storage.objects as restrictive
  for insert to public with check (bucket_id <> 'school-photos' or (
    (storage.foldername(name))[1]=(select auth.uid())::text
    and array_length(string_to_array(name,'/'),1)=2
    and (storage.filename(name)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ));
create policy "School photo immutable guard" on storage.objects as restrictive
  for update to public using (bucket_id <> 'school-photos') with check (bucket_id <> 'school-photos');
create policy "School photo retention guard" on storage.objects as restrictive
  for delete to public using (bucket_id <> 'school-photos');
-- No UPDATE/DELETE policy: objects are immutable for safe retries. Unreferenced objects
-- are private and retained; an administrator can clean them up after verifying references.
commit;
