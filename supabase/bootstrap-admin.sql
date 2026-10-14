-- Run ONCE in the Supabase SQL Editor as the project database owner.
-- First register normally in SciDA and confirm the email link.
-- Find your confirmed identity in Authentication > Users; copy BOTH values below.
-- This file deliberately contains no working identity or credentials.
-- Do not expose this procedure as an RPC, browser action, or automated signup hook.
begin;
do $$
declare
  admin_user_id uuid := '00000000-0000-0000-0000-000000000000'; -- REPLACE with your verified Auth UUID
  admin_email text := 'REPLACE_WITH_YOUR_VERIFIED_EMAIL'; -- REPLACE; exact case-insensitive match required
  -- Optional explicit reviewer topics for the owner, separate from admin privileges.
  -- Leave empty unless you intend to participate as a reviewer in those topics.
  owner_review_topics text[] := '{}';
begin
  if current_user not in ('postgres','supabase_admin') then
    raise exception 'Run this only as the project database owner.';
  end if;
  lock table public.user_roles in exclusive mode;
  if exists (select from public.user_roles where role = 'Admin') then
    raise exception 'An initial admin is already assigned. This bootstrap cannot replace it.';
  end if;
  if not exists (select from auth.users where id = admin_user_id
      and lower(email) = lower(admin_email) and email_confirmed_at is not null) then
    raise exception 'UUID and email must identify your existing confirmed Auth account.';
  end if;
  if not scida_private.valid_topics(owner_review_topics) then raise exception 'Invalid owner review scope.'; end if;
  update public.user_roles set role = 'Admin' where user_id = admin_user_id;
  if not found then raise exception 'The account profile has not been created.'; end if;
  insert into public.reviewer_topics(user_id,topic_id)
    select admin_user_id,unnest(owner_review_topics) on conflict do nothing;
  insert into public.access_audit(actor_id,target_id,action,details)
    values(admin_user_id,admin_user_id,'bootstrap_admin',jsonb_build_object('approved_topics',owner_review_topics));
end;
$$;
commit;
