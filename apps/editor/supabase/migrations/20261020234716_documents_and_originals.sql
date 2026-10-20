-- What an account keeps: one row for each saved document (decision 0091), and the originals of
-- imported .tex documents as files in the private `originals` bucket (decision 0090). Only the owner
-- reaches either: the browser holds a key that is public by design, so row-level security and the
-- storage policies below are what keep one person's resumes from another (decision 0093).

-- The documents table -----------------------------------------------------------------------------

-- The id is the browser's own UUID for the document, so it has no default. The owner defaults to
-- the caller and goes with the user, so deleting an account deletes its rows (decision 0095).
-- revision and both times are the trigger's below: whatever the client sends for them is replaced.
create table public.documents (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  template_id text not null,
  title text not null,
  document jsonb not null,
  revision integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  -- The editor's three kinds of document (decision 0091).
  constraint documents_kind_check check (kind in ('template', 'tex', 'pdf')),
  -- 2 MB as JSON is far above any resume; the bound stops the table being used as free storage.
  constraint documents_document_size_check check (octet_length(document::text) <= 2097152)
);

-- The policies and the list both filter on the owner.
create index documents_owner_id_idx on public.documents (owner_id);

-- New tables are not granted to the API's roles on hosted Supabase, and the local stack still
-- grants them by default, so say exactly what is meant on both: the four operations to
-- `authenticated` and nothing to anyone else. `anon` gets no grant, so it is refused outright.
revoke all on public.documents from anon, authenticated, public;
grant select, insert, update, delete on public.documents to authenticated;

-- One policy for each operation, each for the owner only. `(select auth.uid())` is evaluated once
-- for the statement rather than once for each row.
alter table public.documents enable row level security;

create policy "documents: owner reads own rows"
on public.documents for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "documents: owner inserts own rows"
on public.documents for insert to authenticated
with check ((select auth.uid()) = owner_id);

-- Checked before and after, so a row can neither be reached nor handed to someone else.
create policy "documents: owner updates own rows"
on public.documents for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "documents: owner deletes own rows"
on public.documents for delete to authenticated
using ((select auth.uid()) = owner_id);

-- The server keeps the books (decision 0093). On insert the revision is 1 and both times are now; on
-- update the revision counts up by one, the change time is now and the creation time stays. The
-- client's save is `update ... where id = $1 and revision = $2` (decision 0092): a stale revision
-- matches no row, so nothing is updated and the trigger never runs. The trigger only counts.
-- An id or an owner never changes: a document moves to nobody else, and its id is the browser's.
create function public.documents_keep_books()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := pg_catalog.now();
    new.updated_at := new.created_at;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'a document''s id cannot change' using errcode = '42501';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'a document''s owner cannot change' using errcode = '42501';
  end if;

  new.revision := old.revision + 1;
  new.created_at := old.created_at;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Only ever called as a trigger, so nobody needs to call it directly.
revoke all on function public.documents_keep_books() from public, anon, authenticated;

create trigger documents_keep_books
before insert or update on public.documents
for each row execute function public.documents_keep_books();

-- The originals bucket -----------------------------------------------------------------------------

-- The bucket itself, private with a 50 MiB limit for each file, comes from config.toml. Its files
-- sit under a folder named after the owner's user id: `<user id>/<document id>/original.zip` and
-- `.../import.bin` (decision 0090). Each policy is for `authenticated` only and requires the first
-- folder of the name to be the caller's id. `anon` has no policy, and with row-level security on
-- storage.objects that means it sees and writes nothing in the bucket. Uploading with upsert needs
-- select and update as well as insert, which the four together give.

create policy "originals: owner reads own folder"
on storage.objects for select to authenticated
using (
  bucket_id = 'originals'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "originals: owner writes into own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'originals'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- Checked before and after, so a file can neither be overwritten in nor moved into another folder.
create policy "originals: owner overwrites in own folder"
on storage.objects for update to authenticated
using (
  bucket_id = 'originals'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'originals'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "originals: owner deletes from own folder"
on storage.objects for delete to authenticated
using (
  bucket_id = 'originals'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
