create table if not exists users (
  id uuid primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  plan text not null default 'free',
  reels_used integer not null default 0,
  monthly_reel_limit integer not null default 5,
  instagram_account_id text,
  instagram_access_token text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists projects (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  topic text not null,
  style text not null,
  tone text not null,
  language text not null,
  target_duration integer not null,
  status text not null default 'draft',
  current_script_id uuid,
  current_video_id uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists scripts (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  content text not null,
  scenes jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists videos (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  job_id text not null unique,
  status text not null,
  output_path text,
  preview_url text,
  source_assets jsonb not null default '[]'::jsonb,
  caption_style text not null,
  background_music_path text,
  voiceover_path text,
  progress integer not null default 0,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists usage (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  action text not null,
  units integer not null default 1,
  metadata jsonb,
  created_at timestamptz not null
);

create index if not exists idx_projects_user_id on projects(user_id);
create index if not exists idx_scripts_project_id on scripts(project_id);
create index if not exists idx_videos_project_id on videos(project_id);
create index if not exists idx_usage_user_id on usage(user_id);
