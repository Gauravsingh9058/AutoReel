import crypto from "crypto";
import { env } from "../config/env";
import { getPgPool } from "../db/postgres";
import { readLocalStore, writeLocalStore } from "../db/localStore";
import {
  MediaAssetRecord,
  ProjectRecord,
  ScriptRecord,
  UsageAction,
  UsageRecord,
  UserRecord,
  VideoRecord,
} from "../types";

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function mapProjectRow(row: any): ProjectRecord {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    topic: row.topic,
    style: row.style,
    tone: row.tone,
    language: row.language,
    targetDuration: row.target_duration,
    status: row.status,
    currentScriptId: row.current_script_id,
    currentVideoId: row.current_video_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUserRow(row: any): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    plan: row.plan,
    reelsUsed: row.reels_used,
    monthlyReelLimit: row.monthly_reel_limit,
    instagramAccountId: row.instagram_account_id,
    instagramAccessToken: row.instagram_access_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapScriptRow(row: any): ScriptRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    scenes: Array.isArray(row.scenes) ? row.scenes : JSON.parse(row.scenes || "[]"),
    keywords: Array.isArray(row.keywords) ? row.keywords : JSON.parse(row.keywords || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVideoRow(row: any): VideoRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    jobId: row.job_id,
    status: row.status,
    outputPath: row.output_path,
    previewUrl: row.preview_url,
    sourceAssets: Array.isArray(row.source_assets)
      ? row.source_assets
      : JSON.parse(row.source_assets || "[]"),
    captionStyle: row.caption_style,
    backgroundMusicPath: row.background_music_path,
    voiceoverPath: row.voiceover_path,
    progress: row.progress,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const WORKSPACE_EMAIL = "workspace@vidsnap.local";
const WORKSPACE_NAME = "Local Workspace";

export async function createUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  plan: "free" | "pro";
  monthlyReelLimit: number;
}) {
  const pg = getPgPool();
  const timestamp = now();
  const record: UserRecord = {
    id: id(),
    email: input.email.toLowerCase(),
    name: input.name,
    passwordHash: input.passwordHash,
    plan: input.plan,
    reelsUsed: 0,
    monthlyReelLimit: input.monthlyReelLimit,
    instagramAccountId: null,
    instagramAccessToken: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (pg) {
    const result = await pg.query(
      `insert into users
      (id, email, name, password_hash, plan, reels_used, monthly_reel_limit, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      returning *`,
      [
        record.id,
        record.email,
        record.name,
        record.passwordHash,
        record.plan,
        record.reelsUsed,
        record.monthlyReelLimit,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return mapUserRow(result.rows[0]);
  }

  const store = await readLocalStore();
  store.users.push(record);
  await writeLocalStore(store);
  return record;
}

export async function getOrCreateWorkspaceUser() {
  const pg = getPgPool();

  if (pg) {
    const existing = await pg.query("select * from users where email = $1 limit 1", [WORKSPACE_EMAIL]);
    if (existing.rows[0]) {
      return mapUserRow(existing.rows[0]);
    }

    const created = await createUser({
      email: WORKSPACE_EMAIL,
      name: WORKSPACE_NAME,
      passwordHash: "",
      plan: "free",
      monthlyReelLimit: env.freeReelLimit,
    });
    return created;
  }

  const store = await readLocalStore();
  const existing = store.users.find((item) => item.email === WORKSPACE_EMAIL);
  if (existing) {
    return existing;
  }

  const created: UserRecord = {
    id: id(),
    email: WORKSPACE_EMAIL,
    name: WORKSPACE_NAME,
    passwordHash: "",
    plan: "free",
    reelsUsed: 0,
    monthlyReelLimit: env.freeReelLimit,
    instagramAccountId: null,
    instagramAccessToken: null,
    createdAt: now(),
    updatedAt: now(),
  };
  store.users.push(created);
  await writeLocalStore(store);
  return created;
}

export async function findUserByEmail(email: string) {
  const pg = getPgPool();
  const normalized = email.toLowerCase();

  if (pg) {
    const result = await pg.query("select * from users where email = $1 limit 1", [normalized]);
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  const store = await readLocalStore();
  return store.users.find((item) => item.email === normalized) || null;
}

export async function findUserById(userId: string) {
  const pg = getPgPool();

  if (pg) {
    const result = await pg.query("select * from users where id = $1 limit 1", [userId]);
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  const store = await readLocalStore();
  return store.users.find((item) => item.id === userId) || null;
}

export async function updateUserInstagram(userId: string, input: { accountId: string; accessToken: string }) {
  const pg = getPgPool();
  if (pg) {
    const result = await pg.query(
      `update users
       set instagram_account_id = $2, instagram_access_token = $3, updated_at = $4
       where id = $1
       returning *`,
      [userId, input.accountId, input.accessToken, now()],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  const store = await readLocalStore();
  const user = store.users.find((item) => item.id === userId);
  if (!user) {
    return null;
  }
  user.instagramAccountId = input.accountId;
  user.instagramAccessToken = input.accessToken;
  user.updatedAt = now();
  await writeLocalStore(store);
  return user;
}

export async function updateUserPlan(userId: string, plan: "free" | "pro", monthlyReelLimit: number) {
  const pg = getPgPool();
  if (pg) {
    const result = await pg.query(
      `update users
       set plan = $2, monthly_reel_limit = $3, updated_at = $4
       where id = $1
       returning *`,
      [userId, plan, monthlyReelLimit, now()],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  const store = await readLocalStore();
  const user = store.users.find((item) => item.id === userId);
  if (!user) {
    return null;
  }
  user.plan = plan;
  user.monthlyReelLimit = monthlyReelLimit;
  user.updatedAt = now();
  await writeLocalStore(store);
  return user;
}

export async function incrementUserUsage(userId: string, action: UsageAction, metadata?: Record<string, unknown>) {
  const pg = getPgPool();
  const usageRecord: UsageRecord = {
    id: id(),
    userId,
    action,
    units: 1,
    metadata: metadata || null,
    createdAt: now(),
  };

  if (pg) {
    await pg.query(
      "insert into usage (id, user_id, action, units, metadata, created_at) values ($1,$2,$3,$4,$5,$6)",
      [usageRecord.id, usageRecord.userId, usageRecord.action, usageRecord.units, JSON.stringify(usageRecord.metadata), usageRecord.createdAt],
    );

    if (action === "video_generation") {
      await pg.query(
        "update users set reels_used = reels_used + 1, updated_at = $2 where id = $1",
        [userId, now()],
      );
    }
    return usageRecord;
  }

  const store = await readLocalStore();
  store.usage.push(usageRecord);
  if (action === "video_generation") {
    const user = store.users.find((item) => item.id === userId);
    if (user) {
      user.reelsUsed += 1;
      user.updatedAt = now();
    }
  }
  await writeLocalStore(store);
  return usageRecord;
}

export async function getUsageSummary(userId: string) {
  const pg = getPgPool();

  if (pg) {
    const [userResult, usageResult] = await Promise.all([
      pg.query("select reels_used, monthly_reel_limit, plan from users where id = $1 limit 1", [userId]),
      pg.query(
        "select action, coalesce(sum(units), 0) as total from usage where user_id = $1 group by action",
        [userId],
      ),
    ]);

    const userRow = userResult.rows[0];
    return {
      plan: userRow?.plan || "free",
      reelsUsed: userRow?.reels_used || 0,
      monthlyReelLimit: !env.enforceReelLimits || env.unlimitedReelGeneration ? -1 : userRow?.monthly_reel_limit || 0,
      actions: usageResult.rows.reduce<Record<string, number>>((accumulator, row) => {
        accumulator[row.action] = Number(row.total || 0);
        return accumulator;
      }, {}),
    };
  }

  const store = await readLocalStore();
  const user = store.users.find((item) => item.id === userId);
  const actions = store.usage
    .filter((item) => item.userId === userId)
    .reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.action] = (accumulator[item.action] || 0) + item.units;
      return accumulator;
    }, {});

  return {
    plan: user?.plan || "free",
    reelsUsed: user?.reelsUsed || 0,
    monthlyReelLimit: !env.enforceReelLimits || env.unlimitedReelGeneration ? -1 : user?.monthlyReelLimit || 0,
    actions,
  };
}

export async function deleteProject(projectId: string) {
  const pg = getPgPool();
  if (pg) {
    const result = await pg.query("delete from projects where id = $1 returning *", [projectId]);
    return result.rows[0] ? mapProjectRow(result.rows[0]) : null;
  }

  const store = await readLocalStore();
  const project = store.projects.find((item) => item.id === projectId) || null;
  if (!project) {
    return null;
  }

  store.projects = store.projects.filter((item) => item.id !== projectId);
  store.scripts = store.scripts.filter((item) => item.projectId !== projectId);
  store.videos = store.videos.filter((item) => item.projectId !== projectId);
  await writeLocalStore(store);
  return project;
}

export async function createProject(input: Omit<ProjectRecord, "id" | "createdAt" | "updatedAt" | "currentScriptId" | "currentVideoId">) {
  const pg = getPgPool();
  const record: ProjectRecord = {
    ...input,
    id: id(),
    currentScriptId: null,
    currentVideoId: null,
    createdAt: now(),
    updatedAt: now(),
  };

  if (pg) {
    const result = await pg.query(
      `insert into projects
      (id, user_id, title, topic, style, tone, language, target_duration, status, current_script_id, current_video_id, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      returning *`,
      [
        record.id,
        record.userId,
        record.title,
        record.topic,
        record.style,
        record.tone,
        record.language,
        record.targetDuration,
        record.status,
        record.currentScriptId,
        record.currentVideoId,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return mapProjectRow(result.rows[0]);
  }

  const store = await readLocalStore();
  store.projects.push(record);
  await writeLocalStore(store);
  return record;
}

export async function updateProject(projectId: string, patch: Partial<ProjectRecord>) {
  const pg = getPgPool();
  const timestamp = now();

  if (pg) {
    const current = await pg.query("select * from projects where id = $1 limit 1", [projectId]);
    if (!current.rows[0]) {
      return null;
    }
    const next = { ...mapProjectRow(current.rows[0]), ...patch, updatedAt: timestamp };
    const result = await pg.query(
      `update projects
       set title = $2, topic = $3, style = $4, tone = $5, language = $6, target_duration = $7,
           status = $8, current_script_id = $9, current_video_id = $10, updated_at = $11
       where id = $1
       returning *`,
      [
        projectId,
        next.title,
        next.topic,
        next.style,
        next.tone,
        next.language,
        next.targetDuration,
        next.status,
        next.currentScriptId,
        next.currentVideoId,
        next.updatedAt,
      ],
    );
    return mapProjectRow(result.rows[0]);
  }

  const store = await readLocalStore();
  const project = store.projects.find((item) => item.id === projectId);
  if (!project) {
    return null;
  }
  Object.assign(project, patch, { updatedAt: timestamp });
  await writeLocalStore(store);
  return project;
}

export async function listProjectsByUser(userId: string) {
  const pg = getPgPool();

  if (pg) {
    const result = await pg.query(
      "select * from projects where user_id = $1 order by updated_at desc",
      [userId],
    );
    return result.rows.map(mapProjectRow);
  }

  const store = await readLocalStore();
  return store.projects
    .filter((item) => item.userId === userId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function findProjectById(projectId: string) {
  const pg = getPgPool();
  if (pg) {
    const result = await pg.query("select * from projects where id = $1 limit 1", [projectId]);
    return result.rows[0] ? mapProjectRow(result.rows[0]) : null;
  }

  const store = await readLocalStore();
  return store.projects.find((item) => item.id === projectId) || null;
}

export async function createScript(input: Omit<ScriptRecord, "id" | "createdAt" | "updatedAt">) {
  const pg = getPgPool();
  const record: ScriptRecord = {
    ...input,
    id: id(),
    createdAt: now(),
    updatedAt: now(),
  };

  if (pg) {
    const result = await pg.query(
      `insert into scripts (id, project_id, title, content, scenes, keywords, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning *`,
      [
        record.id,
        record.projectId,
        record.title,
        record.content,
        JSON.stringify(record.scenes),
        JSON.stringify(record.keywords),
        record.createdAt,
        record.updatedAt,
      ],
    );
    return mapScriptRow(result.rows[0]);
  }

  const store = await readLocalStore();
  store.scripts.push(record);
  await writeLocalStore(store);
  return record;
}

export async function findLatestScriptByProject(projectId: string) {
  const pg = getPgPool();
  if (pg) {
    const result = await pg.query(
      "select * from scripts where project_id = $1 order by created_at desc limit 1",
      [projectId],
    );
    return result.rows[0] ? mapScriptRow(result.rows[0]) : null;
  }

  const store = await readLocalStore();
  return (
    store.scripts
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null
  );
}

export async function createVideo(input: Omit<VideoRecord, "id" | "createdAt" | "updatedAt">) {
  const pg = getPgPool();
  const record: VideoRecord = {
    ...input,
    id: id(),
    createdAt: now(),
    updatedAt: now(),
  };

  if (pg) {
    const result = await pg.query(
      `insert into videos
      (id, project_id, job_id, status, output_path, preview_url, source_assets, caption_style, background_music_path, voiceover_path, progress, error_message, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      returning *`,
      [
        record.id,
        record.projectId,
        record.jobId,
        record.status,
        record.outputPath,
        record.previewUrl,
        JSON.stringify(record.sourceAssets),
        record.captionStyle,
        record.backgroundMusicPath,
        record.voiceoverPath,
        record.progress,
        record.errorMessage,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return mapVideoRow(result.rows[0]);
  }

  const store = await readLocalStore();
  store.videos.push(record);
  await writeLocalStore(store);
  return record;
}

export async function updateVideo(videoId: string, patch: Partial<VideoRecord>) {
  const pg = getPgPool();
  const timestamp = now();

  if (pg) {
    const current = await pg.query("select * from videos where id = $1 limit 1", [videoId]);
    if (!current.rows[0]) {
      return null;
    }
    const next = { ...mapVideoRow(current.rows[0]), ...patch, updatedAt: timestamp };
    const result = await pg.query(
      `update videos
       set status = $2, output_path = $3, preview_url = $4, source_assets = $5, caption_style = $6,
           background_music_path = $7, voiceover_path = $8, progress = $9, error_message = $10, updated_at = $11
       where id = $1
       returning *`,
      [
        videoId,
        next.status,
        next.outputPath,
        next.previewUrl,
        JSON.stringify(next.sourceAssets),
        next.captionStyle,
        next.backgroundMusicPath,
        next.voiceoverPath,
        next.progress,
        next.errorMessage,
        next.updatedAt,
      ],
    );
    return mapVideoRow(result.rows[0]);
  }

  const store = await readLocalStore();
  const video = store.videos.find((item) => item.id === videoId);
  if (!video) {
    return null;
  }
  Object.assign(video, patch, { updatedAt: timestamp });
  await writeLocalStore(store);
  return video;
}

export async function findVideoByProject(projectId: string) {
  const pg = getPgPool();
  if (pg) {
    const result = await pg.query(
      "select * from videos where project_id = $1 order by created_at desc limit 1",
      [projectId],
    );
    return result.rows[0] ? mapVideoRow(result.rows[0]) : null;
  }

  const store = await readLocalStore();
  return (
    store.videos
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null
  );
}

export async function findVideoByJobId(jobId: string) {
  const pg = getPgPool();
  if (pg) {
    const result = await pg.query("select * from videos where job_id = $1 limit 1", [jobId]);
    return result.rows[0] ? mapVideoRow(result.rows[0]) : null;
  }

  const store = await readLocalStore();
  return store.videos.find((item) => item.jobId === jobId) || null;
}

export async function getProjectBundle(projectId: string) {
  const [project, script, video] = await Promise.all([
    findProjectById(projectId),
    findLatestScriptByProject(projectId),
    findVideoByProject(projectId),
  ]);

  return { project, script, video };
}

export async function replaceVideoAssets(videoId: string, assets: MediaAssetRecord[]) {
  return updateVideo(videoId, { sourceAssets: assets });
}
