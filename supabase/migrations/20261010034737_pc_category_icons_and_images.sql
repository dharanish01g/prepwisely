-- PrepCode Practice (PRACTICE.md §4.1): a category's card shows either any Lucide icon (by name, e.g. "code-xml";
-- both apps draw it with lucide's DynamicIcon) or an uploaded image, never both. Images live in the public
-- `pc-images` Storage bucket and the category keeps the image's https address in logo_url, so PrepCode's Practice
-- data stays small. Only superadmin and content managers upload.

alter table public.pc_categories
  drop constraint pc_categories_icon_check,
  add constraint pc_categories_icon_check
    check (icon is null or (icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(icon) <= 64)),
  drop constraint pc_categories_logo_url_check,
  add constraint pc_categories_logo_url_check
    check (logo_url is null or (logo_url ~ '^https://' and length(logo_url) <= 2000)),
  add constraint pc_categories_icon_or_image check (icon is null or logo_url is null);

-- Same as before, with the icon and image rules above.
create or replace function public.pc_category_check(
  p_category_id uuid,
  p_domain_id uuid,
  p_title text,
  p_description text,
  p_icon text,
  p_logo_url text,
  p_details text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pc_domains where id = p_domain_id) then
    raise exception 'Domain not found';
  end if;
  if exists (select 1 from public.pc_domains where id = p_domain_id and archived_at is not null) then
    raise exception 'That domain is archived. Restore it first.';
  end if;
  if p_title = '' then
    raise exception 'Title is required';
  end if;
  if length(p_title) > 60 then
    raise exception 'Title can be at most 60 characters';
  end if;
  if exists (
    select 1 from public.pc_categories
    where domain_id = p_domain_id and lower(title) = lower(p_title) and id is distinct from p_category_id
  ) then
    raise exception 'This domain already has a category named "%"', p_title;
  end if;
  if p_description = '' then
    raise exception 'Description is required';
  end if;
  if length(p_description) > 200 then
    raise exception 'Description can be at most 200 characters';
  end if;
  if p_icon is not null and p_logo_url is not null then
    raise exception 'Choose an icon or an image, not both';
  end if;
  if p_icon is not null and (p_icon !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_icon) > 64) then
    raise exception '"%" isn''t a Lucide icon name', p_icon;
  end if;
  if p_logo_url is not null and (p_logo_url !~ '^https://' or length(p_logo_url) > 2000) then
    raise exception 'The image must be an uploaded image or an https link';
  end if;
  if p_details is not null and length(p_details) > 20000 then
    raise exception 'Details can be at most 20,000 characters';
  end if;
end;
$$;
revoke all on function public.pc_category_check(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

-- Card images: anyone can view them by address (a public bucket); only Practice managers can upload. Images are never
-- overwritten (each upload gets a new name), so no update or delete rule.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pc-images', 'pc-images', true, 204800, array['image/png', 'image/jpeg', 'image/webp']);

create policy "practice managers upload pc images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'pc-images' and (select public.pc_can_manage()));
