-- SciDA production schema. No demo users, comments, or approval decisions are seeded.
begin;

create schema if not exists scida_private;
revoke all on schema scida_private from public, anon, authenticated;
grant usage on schema scida_private to anon, authenticated;

create function scida_private.valid_topics(value text[]) returns boolean
language sql immutable set search_path = '' as $$
  select value is not null and array_position(value, null) is null
    and value <@ array['bandit-theory','machine-learning','scientific-ai',
      'time-domain-astronomy','exoplanets','galaxy-evolution']::text[]
    and cardinality(value) = (select count(distinct t) from unnest(value) t);
$$;

create function scida_private.profile_topics_match(fields text[], topics text[]) returns boolean
language sql immutable set search_path = '' as $$
  select fields is not null and array_position(fields, null) is null
    and fields <@ array['Astronomy','Artificial Intelligence']::text[]
    and scida_private.valid_topics(topics)
    and not exists (select from unnest(topics) t where
      (t in ('bandit-theory','machine-learning','scientific-ai') and not 'Artificial Intelligence' = any(fields))
      or (t in ('time-domain-astronomy','exoplanets','galaxy-evolution') and not 'Astronomy' = any(fields)));
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 150),
  affiliation text not null default '' check (length(affiliation) <= 300),
  research_role text not null default '' check (length(research_role) <= 150),
  scholar_url text not null default '' check (length(scholar_url) <= 1000),
  website text not null default '' check (length(website) <= 1000),
  fields text[] not null default '{}',
  expertise_topics text[] not null default '{}',
  expertise_statement text not null default '' check (length(expertise_statement) <= 4000),
  evidence text not null default '' check (length(evidence) <= 12000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scida_private.profile_topics_match(fields, expertise_topics))
);

create table public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'Reader' check (role in ('Reader','Reviewer','Approver','Admin'))
);
-- Exactly one initial admin. No API function grants this role.
create unique index scida_single_admin on public.user_roles(role) where role = 'Admin';

create table public.reviewer_topics (
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic_id text not null check (scida_private.valid_topics(array[topic_id])),
  primary key (user_id, topic_id)
);
create table public.approver_topics (
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic_id text not null check (scida_private.valid_topics(array[topic_id])),
  primary key (user_id, topic_id)
);

create table public.discoveries (
  id text primary key check (id ~ '^[A-Z0-9][A-Za-z0-9_-]{1,79}$'),
  title text not null check (length(title) between 3 and 300),
  field text not null check (field in ('Astronomy','Artificial Intelligence')),
  topic text not null check (scida_private.valid_topics(array[topic])),
  status text not null check (status in ('Awaiting Validation','Validated','Published')),
  summary text not null check (length(summary) between 3 and 6000),
  updated_at timestamptz not null default now(),
  version text not null check (length(version) between 1 and 100),
  review_note text not null default '' check (length(review_note) <= 6000),
  sections jsonb not null default '[]' check (jsonb_typeof(sections) = 'array'),
  materials jsonb not null default '{}' check (jsonb_typeof(materials) = 'object'),
  illustrative boolean not null default false,
  check (scida_private.profile_topics_match(array[field], array[topic]))
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  discovery_id text not null references public.discoveries(id),
  author_id uuid not null default auth.uid() references public.profiles(id),
  parent_id uuid references public.comments(id),
  version text not null check (length(version) between 1 and 100),
  reference text not null default '' check (length(reference) <= 250),
  body text not null check (length(btrim(body)) between 3 and 12000),
  created_at timestamptz not null default now(),
  check (id is distinct from parent_id)
);
create index comments_discovery_created on public.comments(discovery_id, created_at);
create index comments_author on public.comments(author_id);
create index comments_parent on public.comments(parent_id);

create table public.code_requests (
  id uuid primary key default gen_random_uuid(),
  discovery_id text not null references public.discoveries(id),
  user_id uuid not null default auth.uid() references public.profiles(id),
  explanation text not null check (length(btrim(explanation)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index code_requests_user on public.code_requests(user_id);

create table public.reviewer_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id),
  topics text[] not null check (scida_private.valid_topics(topics) and cardinality(topics) > 0),
  evidence text not null check (length(btrim(evidence)) between 10 and 12000),
  status text not null default 'Pending' check (status in ('Pending','Approved','Declined')),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decision_note text,
  decided_at timestamptz,
  check ((status = 'Pending' and decided_by is null and decided_at is null and decision_note is null)
    or (status <> 'Pending' and decided_by is not null and decided_at is not null))
);
create index reviewer_applications_user on public.reviewer_applications(user_id);
create unique index one_pending_application on public.reviewer_applications(user_id) where status = 'Pending';

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  created_by uuid not null references public.profiles(id),
  topics text[] not null check (scida_private.valid_topics(topics) and cardinality(topics) > 0),
  intended_email text not null check (length(intended_email) between 3 and 320),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  check ((used_by is null and used_at is null) or (used_by is not null and used_at is not null))
);
create index invitations_creator on public.invitations(created_by);

create table public.access_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  target_id uuid references public.profiles(id),
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create function scida_private.is_verified() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where u.id = auth.uid()
    and u.email is not null and u.email_confirmed_at is not null);
$$;
create function scida_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select scida_private.is_verified() and exists
    (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'Admin');
$$;
create function scida_private.can_approve(requested text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select scida_private.is_verified() and scida_private.valid_topics(requested)
    and cardinality(requested) > 0 and (scida_private.is_admin() or (
      exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'Approver')
      and not exists (select from unnest(requested) t where not exists
        (select from public.approver_topics a where a.user_id = auth.uid() and a.topic_id = t))));
$$;
create function scida_private.can_read_profile(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select target = auth.uid() or scida_private.is_admin() or (
    target <> auth.uid() and exists (select from public.reviewer_applications a
      where a.user_id = target and scida_private.can_approve(a.topics)));
$$;
create function scida_private.can_discuss(discovery text) returns boolean
language sql stable security definer set search_path = '' as $$
  select scida_private.is_verified() and exists (
    select from public.discoveries d join public.reviewer_topics r on r.topic_id = d.topic
    where d.id = discovery and r.user_id = auth.uid());
$$;

create function scida_private.create_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name)
    values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name',''),150));
  insert into public.user_roles(user_id, role) values (new.id, 'Reader');
  return new;
end;
$$;
create trigger scida_auth_account after insert on auth.users
  for each row execute function scida_private.create_account();
-- Existing Auth identities also start as Readers; never import client demo data.
insert into public.profiles(id, full_name)
  select id, left(coalesce(raw_user_meta_data->>'full_name',''),150) from auth.users
  on conflict (id) do nothing;
insert into public.user_roles(user_id) select id from public.profiles on conflict (user_id) do nothing;

create function scida_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger profiles_updated before update on public.profiles
  for each row execute function scida_private.touch_updated_at();
create trigger discoveries_updated before update on public.discoveries
  for each row execute function scida_private.touch_updated_at();

create function scida_private.validate_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare current_version text; parent public.comments%rowtype;
begin
  select d.version into current_version from public.discoveries d where d.id = new.discovery_id for share;
  if new.parent_id is not null then
    select * into parent from public.comments c where c.id = new.parent_id;
    if not found or parent.discovery_id <> new.discovery_id or parent.version <> new.version then
      raise exception 'Reply must belong to the same discovery and manuscript version.' using errcode = '23514';
    end if;
  elsif new.version is distinct from current_version then
    raise exception 'New discussion must reference the current manuscript version.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger comments_integrity before insert on public.comments
  for each row execute function scida_private.validate_comment();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.reviewer_topics enable row level security;
alter table public.approver_topics enable row level security;
alter table public.discoveries enable row level security;
alter table public.comments enable row level security;
alter table public.code_requests enable row level security;
alter table public.reviewer_applications enable row level security;
alter table public.invitations enable row level security;
alter table public.access_audit enable row level security;

-- Explicitly remove Supabase's legacy default grants before granting least privilege.
revoke all on public.profiles, public.user_roles, public.reviewer_topics, public.approver_topics,
  public.discoveries, public.comments, public.code_requests, public.reviewer_applications,
  public.invitations, public.access_audit from public, anon, authenticated;
grant select on public.discoveries, public.comments to anon, authenticated;
grant select on public.profiles, public.user_roles, public.reviewer_topics, public.approver_topics,
  public.code_requests, public.reviewer_applications, public.access_audit to authenticated;
grant select (id, created_by, topics, intended_email, expires_at, used_by, created_at, used_at)
  on public.invitations to authenticated;
grant update (full_name, affiliation, research_role, scholar_url, website, fields,
  expertise_topics, expertise_statement, evidence) on public.profiles to authenticated;
grant insert, delete on public.discoveries to authenticated;
grant update (title,field,topic,status,summary,updated_at,version,review_note,sections,materials,illustrative)
  on public.discoveries to authenticated;
grant insert (discovery_id,author_id,parent_id,version,reference,body) on public.comments to authenticated;
grant insert (discovery_id,user_id,explanation) on public.code_requests to authenticated;
grant insert (user_id,topics,evidence) on public.reviewer_applications to authenticated;

create policy profiles_read on public.profiles for select to authenticated
  using (scida_private.can_read_profile(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() and scida_private.is_verified())
  with check (id = auth.uid() and scida_private.is_verified());
create policy roles_read on public.user_roles for select to authenticated
  using (scida_private.can_read_profile(user_id));
create policy reviewer_topics_read on public.reviewer_topics for select to authenticated
  using (scida_private.can_read_profile(user_id));
create policy approver_topics_read on public.approver_topics for select to authenticated
  using (scida_private.can_read_profile(user_id));
create policy discoveries_read on public.discoveries for select to anon, authenticated using (true);
create policy discoveries_insert on public.discoveries for insert to authenticated with check (scida_private.is_admin());
create policy discoveries_update on public.discoveries for update to authenticated
  using (scida_private.is_admin()) with check (scida_private.is_admin());
create policy discoveries_delete on public.discoveries for delete to authenticated using (scida_private.is_admin());
create policy comments_read on public.comments for select to anon, authenticated using (true);
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = auth.uid() and scida_private.can_discuss(discovery_id));
create policy requests_read on public.code_requests for select to authenticated
  using (user_id = auth.uid() or scida_private.is_admin());
create policy requests_insert on public.code_requests for insert to authenticated
  with check (user_id = auth.uid() and scida_private.is_verified());
create policy applications_read on public.reviewer_applications for select to authenticated
  using (user_id = auth.uid() or scida_private.can_approve(topics));
create policy applications_insert on public.reviewer_applications for insert to authenticated
  with check (user_id = auth.uid() and scida_private.is_verified());
create policy invitations_read on public.invitations for select to authenticated
  using (created_by = auth.uid() or scida_private.is_admin());
create policy audit_read on public.access_audit for select to authenticated using (scida_private.is_admin());

create function public.review_application(p_application_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare application public.reviewer_applications%rowtype;
begin
  -- Serialize authority checks with admin scope revocation.
  perform 1 from public.user_roles where user_id = auth.uid() for share;
  select * into application from public.reviewer_applications where id = p_application_id for update;
  if not found or not scida_private.can_approve(application.topics) or application.user_id = auth.uid() then
    raise exception 'You cannot decide this application.' using errcode = '42501';
  end if;
  if application.status <> 'Pending' then raise exception 'Application already decided.' using errcode = '23514'; end if;
  if p_approve is null or p_note is null or length(p_note) > 4000 then
    raise exception 'Invalid decision.' using errcode = '23514';
  end if;
  perform 1 from public.user_roles where user_id = application.user_id for update;
  update public.reviewer_applications set status = case when p_approve then 'Approved' else 'Declined' end,
    decided_by = auth.uid(), decision_note = p_note, decided_at = now() where id = p_application_id;
  if p_approve then
    insert into public.reviewer_topics(user_id,topic_id)
      select application.user_id, unnest(application.topics) on conflict do nothing;
    update public.user_roles set role = 'Reviewer' where user_id = application.user_id and role = 'Reader';
  end if;
  insert into public.access_audit(actor_id,target_id,action,details)
    values (auth.uid(),application.user_id,'review_application',jsonb_build_object('application_id',p_application_id,'approved',p_approve,'topics',application.topics));
end;
$$;

create function public.create_invitation(p_topics text[], p_intended_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare token text; invitation public.invitations%rowtype; actor_email text;
begin
  perform 1 from public.user_roles where user_id = auth.uid() for share;
  if not scida_private.can_approve(p_topics) then
    raise exception 'You cannot invite reviewers in these topics.' using errcode = '42501';
  end if;
  select lower(email) into actor_email from auth.users where id = auth.uid();
  if p_intended_email is null or length(p_intended_email) > 320 or btrim(p_intended_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or lower(btrim(p_intended_email)) = actor_email then
    raise exception 'Enter another researcher''s valid email address.' using errcode = '23514';
  end if;
  token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into public.invitations(code_hash,created_by,topics,intended_email)
    values (encode(sha256(convert_to(token,'UTF8')),'hex'),auth.uid(),p_topics,lower(btrim(p_intended_email)))
    returning * into invitation;
  return jsonb_build_object('id',invitation.id,'code',token,'topics',invitation.topics,
    'intended_email',invitation.intended_email,'expires_at',invitation.expires_at);
end;
$$;

create function public.preview_invitation(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations%rowtype; account_email text;
begin
  if not scida_private.is_verified() then raise exception 'Verify your email before redeeming an invitation.' using errcode = '42501'; end if;
  if p_code is null or length(p_code) > 256 then raise exception 'Invitation unavailable.' using errcode = '23514'; end if;
  select lower(email) into account_email from auth.users where id = auth.uid();
  select * into invitation from public.invitations
    where code_hash = encode(sha256(convert_to(btrim(p_code),'UTF8')),'hex')
      and intended_email = account_email and used_by is null and expires_at > now();
  if not found or not exists (select from public.user_roles r where r.user_id = invitation.created_by and (
    r.role = 'Admin' or (r.role = 'Approver' and not exists (select from unnest(invitation.topics) t
      where not exists (select from public.approver_topics a where a.user_id = invitation.created_by and a.topic_id = t))))) then
    raise exception 'Invitation unavailable for this verified account.' using errcode = '42501';
  end if;
  return jsonb_build_object('id',invitation.id,'topics',invitation.topics,
    'intended_email',invitation.intended_email,'expires_at',invitation.expires_at);
end;
$$;

create function public.accept_invitation(p_code text, p_confirmed_topics text[])
returns void language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations%rowtype; preview jsonb;
begin
  preview := public.preview_invitation(p_code);
  select * into invitation from public.invitations where id = (preview->>'id')::uuid for update;
  if invitation.used_by is not null or invitation.expires_at <= now() or invitation.created_by = auth.uid() then
    raise exception 'Invitation unavailable.' using errcode = '42501';
  end if;
  -- Hold the creator's authority stable until the grant commits, and recheck
  -- after obtaining the lock in case access was revoked while previewing.
  perform 1 from public.user_roles where user_id = invitation.created_by for share;
  preview := public.preview_invitation(p_code);
  perform 1 from public.user_roles where user_id = auth.uid() for update;
  if not scida_private.valid_topics(p_confirmed_topics) or p_confirmed_topics is null
    or not (p_confirmed_topics @> invitation.topics and p_confirmed_topics <@ invitation.topics) then
    raise exception 'Confirm exactly the topics offered by this invitation.' using errcode = '23514';
  end if;
  insert into public.reviewer_topics(user_id,topic_id) select auth.uid(),unnest(invitation.topics) on conflict do nothing;
  update public.user_roles set role = 'Reviewer' where user_id = auth.uid() and role = 'Reader';
  update public.invitations set used_by = auth.uid(),used_at = now() where id = invitation.id;
  insert into public.access_audit(actor_id,target_id,action,details)
    values(auth.uid(),auth.uid(),'accept_invitation',jsonb_build_object('invitation_id',invitation.id,'topics',invitation.topics));
end;
$$;

create function public.set_account_access(p_user_id uuid, p_role text, p_approved_topics text[], p_assigned_topics text[])
returns void language plpgsql security definer set search_path = '' as $$
declare existing_role text;
begin
  if not scida_private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  select role into existing_role from public.user_roles where user_id = p_user_id for update;
  if not found or existing_role = 'Admin' or p_role is null or p_role not in ('Reader','Reviewer','Approver') then
    raise exception 'The initial administrator cannot be appointed or modified through the website.' using errcode = '42501';
  end if;
  if not exists (select from auth.users where id = p_user_id and email is not null and email_confirmed_at is not null) then
    raise exception 'The account must have a verified email.' using errcode = '42501';
  end if;
  if not scida_private.valid_topics(p_approved_topics) or not scida_private.valid_topics(p_assigned_topics)
    or (p_role = 'Reader' and cardinality(p_approved_topics) + cardinality(p_assigned_topics) <> 0)
    or (p_role = 'Reviewer' and (cardinality(p_approved_topics) = 0 or cardinality(p_assigned_topics) <> 0))
    or (p_role = 'Approver' and cardinality(p_assigned_topics) = 0) then
    raise exception 'Invalid role or topic scope.' using errcode = '23514';
  end if;
  update public.user_roles set role = p_role where user_id = p_user_id;
  delete from public.reviewer_topics where user_id = p_user_id;
  insert into public.reviewer_topics(user_id,topic_id) select p_user_id,unnest(p_approved_topics);
  delete from public.approver_topics where user_id = p_user_id;
  insert into public.approver_topics(user_id,topic_id) select p_user_id,unnest(p_assigned_topics);
  insert into public.access_audit(actor_id,target_id,action,details)
    values(auth.uid(),p_user_id,'set_account_access',jsonb_build_object('role',p_role,'approved_topics',p_approved_topics,'assigned_topics',p_assigned_topics));
end;
$$;

-- The only public profile fields are names attributed to public research comments.
create function public.get_public_authors()
returns table(id uuid, full_name text) language sql stable security definer set search_path = '' as $$
  select p.id,p.full_name from public.profiles p where exists (select from public.comments c where c.author_id = p.id);
$$;

revoke all on all functions in schema scida_private from public, anon, authenticated;
grant execute on function scida_private.valid_topics(text[]), scida_private.profile_topics_match(text[],text[]),
  scida_private.is_verified(), scida_private.is_admin(), scida_private.can_approve(text[]),
  scida_private.can_read_profile(uuid), scida_private.can_discuss(text) to authenticated;
revoke all on function public.review_application(uuid,boolean,text), public.create_invitation(text[],text),
  public.preview_invitation(text), public.accept_invitation(text,text[]),
  public.set_account_access(uuid,text,text[],text[]), public.get_public_authors() from public, anon, authenticated;
grant execute on function public.review_application(uuid,boolean,text), public.create_invitation(text[],text),
  public.preview_invitation(text), public.accept_invitation(text,text[]),
  public.set_account_access(uuid,text,text[],text[]) to authenticated;
grant execute on function public.get_public_authors() to anon, authenticated;

commit;
