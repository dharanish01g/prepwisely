-- Replaces the generic `manager` role with `content_manager` (see ROLES.md): decides what content is
-- needed (topics, quantity, quality bar) and directs the content team. Test scheduling is not assigned
-- to any role yet.
insert into public.roles (id, label, description, sort_order)
values (
  'content_manager',
  'Content manager',
  'Decides what content is needed (topics, quantity, quality bar), directs content creators and reviewers, manages the content team',
  2
);

-- user_roles.role_id has no ON UPDATE CASCADE, so move existing assignments before removing the old role.
update public.user_roles set role_id = 'content_manager' where role_id = 'manager';

delete from public.roles where id = 'manager';
