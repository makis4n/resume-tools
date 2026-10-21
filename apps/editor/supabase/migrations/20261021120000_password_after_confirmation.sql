-- A password set before the address is confirmed is dropped when it is confirmed (milestone 4
-- item 5, decision 0099). Auth lets anyone sign up with any address and a password of their choice,
-- and keeps that password when the address is later confirmed, whether by the confirmation link or
-- by an email link to sign in, and it does not replace it when the same address signs up again
-- before confirming. Without this, whoever signed up first with someone else's address could sign
-- in to that person's account once they confirmed it. Nobody but the address's owner can confirm
-- it, so a password is kept only once it was set after that: the editor asks for one then.
--
-- Auth writes the confirmation as an update of `email_confirmed_at` from null; the password is set
-- to the empty string, which Auth reads as no password, so that none matches it. An account made by
-- an email link holds a random one Auth chose, which goes the same way. An account confirmed when
-- it is made (by an administrator) is not touched.
create function public.drop_password_set_before_confirmation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.encrypted_password := '';
  return new;
end;
$$;

revoke all on function public.drop_password_set_before_confirmation() from public, anon, authenticated;

create trigger drop_password_set_before_confirmation
before update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.drop_password_set_before_confirmation();
