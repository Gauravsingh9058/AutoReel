export type PlanType = "free" | "pro";
export type ProjectStatus = "draft" | "processing" | "completed" | "failed";
export type VideoStatus = "queued" | "processing" | "completed" | "failed";
export type MediaKind = "image" | "video" | "audio";
export type UsageAction = "script_generation" | "video_generation" | "instagram_post";

export interface SceneDefinition {
  sceneNumber: number;
  visual: string;
  text: string;
  spokenText: string;
}

export interface ScriptGenerationInput {
  topic: string;
  style: string;
  language: string;
  tone: string;
  duration: number;
}

export interface ScriptResult {
  title: string;
  script: string;
  scenes: SceneDefinition[];
  pexelsKeywords: string[];
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  plan: PlanType;
  reelsUsed: number;
  monthlyReelLimit: number;
  instagramAccountId?: string | null;
  instagramAccessToken?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  userId: string;
  title: string;
  topic: string;
  style: string;
  tone: string;
  language: string;
  targetDuration: number;
  status: ProjectStatus;
  currentScriptId?: string | null;
  currentVideoId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptRecord {
  id: string;
  projectId: string;
  title: string;
  content: string;
  scenes: SceneDefinition[];
  keywords: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MediaAssetRecord {
  id: string;
  projectId: string;
  kind: MediaKind;
  source: "pexels" | "upload" | "local";
  sourceUrl: string;
  localPath: string;
  previewUrl: string;
  durationSeconds?: number | null;
  createdAt: string;
}

export interface VideoRecord {
  id: string;
  projectId: string;
  jobId: string;
  status: VideoStatus;
  outputPath?: string | null;
  previewUrl?: string | null;
  sourceAssets: MediaAssetRecord[];
  captionStyle: string;
  backgroundMusicPath?: string | null;
  voiceoverPath?: string | null;
  progress: number;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageRecord {
  id: string;
  userId: string;
  action: UsageAction;
  units: number;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface JobState {
  id: string;
  videoId: string;
  projectId: string;
  status: VideoStatus;
  progress: number;
  message: string;
  outputUrl?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoGenerationPayload {
  jobId: string;
  userId: string;
  project: ProjectRecord;
  script: ScriptRecord;
  captionStyle: string;
  useStockMedia: boolean;
  enableVoiceover: boolean;
  backgroundMusicPath?: string | null;
  uploadedAssetPaths: string[];
}

export interface LocalDatabaseShape {
  users: UserRecord[];
  projects: ProjectRecord[];
  scripts: ScriptRecord[];
  videos: VideoRecord[];
  usage: UsageRecord[];
}
