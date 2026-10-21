-- The originals bucket reaches only the owner of each folder (decisions 0090 and 0093). The
-- Storage API reads and writes storage.objects with the caller's role and claims, so the same rows
-- written here directly meet the same policies. Two invented users, A and B, act in turn by setting
-- the role and the claims that auth.uid() reads. Everything is rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

-- Storage refuses a plain DELETE on its tables unless this is set, which its API does for each
-- delete it makes. Set it here too, so that the deletes below meet the policies and not that guard.
set local storage.allow_delete_query = 'true';

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
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata) values
       ('originals',
        '11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/original.zip',
        '11111111-1111-4111-8111-111111111111', '{"size":1}'),
       ('originals',
        '11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/import.bin',
        '11111111-1111-4111-8111-111111111111', '{"size":1}') $$,
  'A can write files into its own folder'
);

select results_eq(
  $$ select name from storage.objects where bucket_id = 'originals' order by name $$,
  $$ values
       ('11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/import.bin'),
       ('11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/original.zip') $$,
  'A can read its own files'
);

select results_eq(
  $$ select name from storage.search(
       '11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/', 'originals')
     order by name $$,
  $$ values ('import.bin'), ('original.zip') $$,
  'A can list its own folder'
);

select is(
  pg_temp.touched($$ update storage.objects set metadata = '{"size":2}'
     where bucket_id = 'originals'
       and name = '11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/original.zip' $$),
  1,
  'A can overwrite its own file'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values
       ('originals', 'loose.zip', '11111111-1111-4111-8111-111111111111') $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'A cannot write a file outside any folder'
);

-- B ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values
       ('originals',
        '22222222-2222-4222-8222-222222222222/bbbbbbbb-0000-4000-8000-00000000000a/original.zip',
        '22222222-2222-4222-8222-222222222222') $$,
  'B can write a file into its own folder'
);

select is_empty(
  $$ select name from storage.objects
     where name = '11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/original.zip' $$,
  'B cannot read A''s file'
);

select results_eq(
  $$ select name from storage.objects where bucket_id = 'originals' $$,
  $$ values
       ('22222222-2222-4222-8222-222222222222/bbbbbbbb-0000-4000-8000-00000000000a/original.zip') $$,
  'B sees only its own file in the bucket'
);

select is_empty(
  $$ select name from storage.search(
       '11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/', 'originals') $$,
  'B cannot list A''s folder'
);

select is_empty(
  $$ select name from storage.search_v2('11111111-1111-4111-8111-111111111111/', 'originals') $$,
  'B cannot list A''s folder through search_v2 either'
);

select is(
  pg_temp.touched($$ update storage.objects set metadata = '{"size":666}'
     where bucket_id = 'originals'
       and name = '11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/original.zip' $$),
  0,
  'B''s overwrite of A''s file updates nothing'
);

select is(
  pg_temp.touched($$ delete from storage.objects
     where bucket_id = 'originals'
       and name like '11111111-1111-4111-8111-111111111111/%' $$),
  0,
  'B''s delete of A''s files deletes nothing'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values
       ('originals',
        '11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/planted.zip',
        '22222222-2222-4222-8222-222222222222') $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'B cannot write a file under A''s folder'
);

select throws_ok(
  $$ update storage.objects
     set name = '11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/moved.zip'
     where bucket_id = 'originals'
       and name = '22222222-2222-4222-8222-222222222222/bbbbbbbb-0000-4000-8000-00000000000a/original.zip' $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'B cannot move its own file into A''s folder'
);

-- anon ------------------------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select is_empty(
  $$ select name from storage.objects where bucket_id = 'originals' $$,
  'anon sees nothing of the originals bucket'
);

select is_empty(
  $$ select name from storage.search('11111111-1111-4111-8111-111111111111/', 'originals') $$,
  'anon cannot list A''s folder'
);

select is(
  pg_temp.touched($$ update storage.objects set metadata = '{"size":666}'
     where bucket_id = 'originals' $$),
  0,
  'anon''s overwrite in the bucket updates nothing'
);

select is(
  pg_temp.touched($$ delete from storage.objects where bucket_id = 'originals' $$),
  0,
  'anon''s delete in the bucket deletes nothing'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values
       ('originals', '11111111-1111-4111-8111-111111111111/planted-by-anon.zip') $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'anon cannot write a file into the bucket'
);

-- Back as the test's own role, to look at the files without row-level security in the way.
reset role;

select results_eq(
  $$ select name, metadata from storage.objects
     where name like '11111111-1111-4111-8111-111111111111/%' order by name $$,
  $$ values
       ('11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/import.bin',
        '{"size":1}'::jsonb),
       ('11111111-1111-4111-8111-111111111111/aaaaaaaa-0000-4000-8000-00000000000a/original.zip',
        '{"size":2}'::jsonb) $$,
  'A''s files are unchanged after B''s and anon''s attempts'
);

select results_eq(
  $$ select name from storage.objects
     where name like '22222222-2222-4222-8222-222222222222/%' $$,
  $$ values
       ('22222222-2222-4222-8222-222222222222/bbbbbbbb-0000-4000-8000-00000000000a/original.zip') $$,
  'B''s file stayed in B''s folder'
);

-- A again ---------------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(
  pg_temp.touched($$ delete from storage.objects
     where bucket_id = 'originals'
       and name like '11111111-1111-4111-8111-111111111111/%' $$),
  2,
  'A can delete its own files'
);

select is_empty(
  $$ select name from storage.objects where bucket_id = 'originals' $$,
  'A''s folder is empty after deleting'
);

reset role;

select results_eq(
  $$ select count(*)::integer from storage.objects where bucket_id = 'originals' $$,
  $$ values (1) $$,
  'only B''s file is left in the bucket'
);

select * from finish();

rollback;
