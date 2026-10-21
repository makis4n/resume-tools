-- A password set before the address is confirmed is dropped when it is confirmed, and one set after
-- stays (decision 0099). Auth writes these columns as below; invented users, all rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email, encrypted_password, email_confirmed_at) values
  ('33333333-3333-4333-8333-333333333333', 'early.password@example.test', 'invented-hash-1', null),
  ('44444444-4444-4444-8444-444444444444', 'confirmed.first@example.test', 'invented-hash-2', now());

select is(
  (select encrypted_password from auth.users where email = 'early.password@example.test'),
  'invented-hash-1',
  'a password set before confirming is kept while the address is unconfirmed'
);

-- Another update that leaves the address unconfirmed changes nothing.
update auth.users set confirmation_sent_at = now() where email = 'early.password@example.test';
select is(
  (select encrypted_password from auth.users where email = 'early.password@example.test'),
  'invented-hash-1',
  'sending another confirmation keeps it'
);

-- Confirming the address drops it.
update auth.users set email_confirmed_at = now() where email = 'early.password@example.test';
select is(
  (select encrypted_password from auth.users where email = 'early.password@example.test'),
  '',
  'confirming the address drops a password set before it'
);

-- A password set once the address is confirmed stays.
update auth.users set encrypted_password = 'invented-hash-3'
where email = 'early.password@example.test';
select is(
  (select encrypted_password from auth.users where email = 'early.password@example.test'),
  'invented-hash-3',
  'a password set after confirming stays'
);

-- An account confirmed when it was made keeps its password through later updates.
update auth.users set email_confirmed_at = now(), last_sign_in_at = now()
where email = 'confirmed.first@example.test';
select is(
  (select encrypted_password from auth.users where email = 'confirmed.first@example.test'),
  'invented-hash-2',
  'an account confirmed already keeps its password'
);

select * from finish();

rollback;
