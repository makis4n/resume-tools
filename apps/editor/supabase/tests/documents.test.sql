-- The documents table reaches only its owner, and the server keeps its books (decision 0093).
-- Two invented users, A and B, act in turn by setting the role and the claims that auth.uid() reads,
-- as PostgREST does for a request; nothing here uses a helper library. Everything is rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

-- How many rows a statement touched, run as whoever is acting. An update or delete that RLS hides
-- rows from does not fail, it touches nothing, so that is what the cases below count.
create function pg_temp.touched(statement text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end;
$$;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'person.a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'person.b@example.test');

-- A ---------------------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ insert into public.documents (id, owner_id, kind, template_id, title, document, revision,
       created_at, updated_at)
     values ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
       'template', 'classic', 'Invented resume A', '{"name":"Ada Example"}', 7,
       '2001-01-01', '2001-01-01') $$,
  'A can insert its own row'
);

select results_eq(
  $$ select revision, created_at = now(), updated_at = now() from public.documents
     where id = 'aaaaaaaa-0000-4000-8000-00000000000a' $$,
  $$ values (1, true, true) $$,
  'on insert a sent revision and sent times are ignored: revision 1, both times now'
);

select lives_ok(
  $$ insert into public.documents (id, kind, template_id, title, document, revision, created_at,
       updated_at)
     values ('aaaaaaaa-0000-4000-8000-00000000000b', 'pdf', 'classic', 'Invented resume A2', '{}',
       0, now(), now()) $$,
  'A can insert a row without naming the owner'
);

select results_eq(
  $$ select owner_id from public.documents where id = 'aaaaaaaa-0000-4000-8000-00000000000b' $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid) $$,
  'the owner defaults to the caller'
);

select results_eq(
  $$ select id from public.documents order by id $$,
  $$ values ('aaaaaaaa-0000-4000-8000-00000000000a'::uuid),
            ('aaaaaaaa-0000-4000-8000-00000000000b'::uuid) $$,
  'A can select its own rows'
);

-- B ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select lives_ok(
  $$ insert into public.documents (id, kind, template_id, title, document, revision, created_at,
       updated_at)
     values ('bbbbbbbb-0000-4000-8000-00000000000a', 'tex', 'imported', 'Invented resume B', '{}',
       1, now(), now()) $$,
  'B can insert its own row'
);

select is_empty(
  $$ select id from public.documents where id = 'aaaaaaaa-0000-4000-8000-00000000000a' $$,
  'B cannot select A''s row'
);

select results_eq(
  $$ select id from public.documents $$,
  $$ values ('bbbbbbbb-0000-4000-8000-00000000000a'::uuid) $$,
  'B sees only its own row'
);

select is(
  pg_temp.touched($$ update public.documents set title = 'Taken by B'
                     where id = 'aaaaaaaa-0000-4000-8000-00000000000a' $$),
  0,
  'B''s update of A''s row updates nothing'
);

select is(
  pg_temp.touched($$ delete from public.documents
                     where id = 'aaaaaaaa-0000-4000-8000-00000000000a' $$),
  0,
  'B''s delete of A''s row deletes nothing'
);

select throws_ok(
  $$ insert into public.documents (id, owner_id, kind, template_id, title, document, revision,
       created_at, updated_at)
     values ('bbbbbbbb-0000-4000-8000-00000000000b', '11111111-1111-4111-8111-111111111111',
       'template', 'classic', 'Planted by B', '{}', 1, now(), now()) $$,
  '42501',
  'new row violates row-level security policy for table "documents"',
  'B cannot insert a row owned by A'
);

select throws_ok(
  $$ update public.documents set owner_id = '11111111-1111-4111-8111-111111111111'
     where id = 'bbbbbbbb-0000-4000-8000-00000000000a' $$,
  '42501',
  'a document''s owner cannot change',
  'B cannot hand its own row to A'
);

-- anon ------------------------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select id from public.documents $$,
  '42501',
  'permission denied for table documents',
  'anon cannot select documents'
);

select throws_ok(
  $$ insert into public.documents (id, owner_id, kind, template_id, title, document, revision,
       created_at, updated_at)
     values ('cccccccc-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
       'template', 'classic', 'Planted by anon', '{}', 1, now(), now()) $$,
  '42501',
  'permission denied for table documents',
  'anon cannot insert documents'
);

-- Back as the test's own role, to look at A's row without row-level security in the way.
reset role;

select results_eq(
  $$ select title, revision, owner_id from public.documents
     where id = 'aaaaaaaa-0000-4000-8000-00000000000a' $$,
  $$ values ('Invented resume A', 1, '11111111-1111-4111-8111-111111111111'::uuid) $$,
  'A''s row is unchanged after B''s attempts'
);

-- Age A's row, with the trigger off for this one statement, so that an update can show the change
-- time moving while the creation time stays.
alter table public.documents disable trigger documents_keep_books;
update public.documents set created_at = '2001-01-01', updated_at = '2001-01-01'
where id = 'aaaaaaaa-0000-4000-8000-00000000000a';
alter table public.documents enable trigger documents_keep_books;

-- A again: updates and the trigger ------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(
  pg_temp.touched($$ update public.documents
                     set title = 'Invented resume A, edited', revision = 99,
                       created_at = '1999-01-01', updated_at = '1999-01-01'
                     where id = 'aaaaaaaa-0000-4000-8000-00000000000a' and revision = 1 $$),
  1,
  'A can update its own row at its current revision'
);

select results_eq(
  $$ select title, revision, created_at = '2001-01-01'::timestamptz, updated_at = now()
     from public.documents where id = 'aaaaaaaa-0000-4000-8000-00000000000a' $$,
  $$ values ('Invented resume A, edited', 2, true, true) $$,
  'on update the revision goes 1 to 2, the change time moves to now, sent values are ignored'
);

select is(
  pg_temp.touched($$ update public.documents set title = 'From a stale copy'
                     where id = 'aaaaaaaa-0000-4000-8000-00000000000a' and revision = 1 $$),
  0,
  'an update naming a stale revision updates nothing'
);

select results_eq(
  $$ select title, revision from public.documents
     where id = 'aaaaaaaa-0000-4000-8000-00000000000a' $$,
  $$ values ('Invented resume A, edited', 2) $$,
  'the stale update left the row as it was'
);

select throws_ok(
  $$ update public.documents set id = 'aaaaaaaa-0000-4000-8000-0000000000ff'
     where id = 'aaaaaaaa-0000-4000-8000-00000000000a' $$,
  '42501',
  'a document''s id cannot change',
  'a document''s id cannot change'
);

select throws_ok(
  $$ update public.documents set owner_id = '22222222-2222-4222-8222-222222222222'
     where id = 'aaaaaaaa-0000-4000-8000-00000000000a' $$,
  '42501',
  'a document''s owner cannot change',
  'A cannot hand its own row to B'
);

select throws_ok(
  $$ insert into public.documents (id, kind, template_id, title, document, revision, created_at,
       updated_at)
     values ('aaaaaaaa-0000-4000-8000-00000000000c', 'template', 'classic', 'Too big',
       jsonb_build_object('padding', repeat('x', 2097152)), 1, now(), now()) $$,
  '23514',
  'new row for relation "documents" violates check constraint "documents_document_size_check"',
  'a document over 2 MB as JSON is refused on insert'
);

select throws_ok(
  $$ update public.documents set document = jsonb_build_object('padding', repeat('x', 2097152))
     where id = 'aaaaaaaa-0000-4000-8000-00000000000a' $$,
  '23514',
  'new row for relation "documents" violates check constraint "documents_document_size_check"',
  'a document over 2 MB as JSON is refused on update'
);

select lives_ok(
  $$ insert into public.documents (id, kind, template_id, title, document, revision, created_at,
       updated_at)
     values ('aaaaaaaa-0000-4000-8000-00000000000d', 'template', 'classic', 'Just under',
       jsonb_build_object('padding', repeat('x', 2097152 - 20)), 1, now(), now()) $$,
  'a document just under 2 MB as JSON is kept'
);

select throws_ok(
  $$ insert into public.documents (id, kind, template_id, title, document, revision, created_at,
       updated_at)
     values ('aaaaaaaa-0000-4000-8000-00000000000e', 'docx', 'classic', 'Wrong kind', '{}', 1,
       now(), now()) $$,
  '23514',
  'new row for relation "documents" violates check constraint "documents_kind_check"',
  'a kind other than template, tex or pdf is refused'
);

select is(
  pg_temp.touched($$ delete from public.documents
                     where id = 'aaaaaaaa-0000-4000-8000-00000000000d' $$),
  1,
  'A can delete its own row'
);

select is_empty(
  $$ select id from public.documents where id = 'aaaaaaaa-0000-4000-8000-00000000000d' $$,
  'A''s deleted row is gone'
);

-- Deleting the account ---------------------------------------------------------------------------

reset role;

select results_eq(
  $$ select count(*)::integer from public.documents
     where owner_id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values (2) $$,
  'A has two rows before its account is deleted'
);

delete from auth.users where id = '11111111-1111-4111-8111-111111111111';

select results_eq(
  $$ select count(*)::integer from public.documents
     where owner_id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values (0) $$,
  'deleting user A deletes A''s rows'
);

select results_eq(
  $$ select id from public.documents $$,
  $$ values ('bbbbbbbb-0000-4000-8000-00000000000a'::uuid) $$,
  'deleting user A leaves B''s row'
);

select * from finish();

rollback;
