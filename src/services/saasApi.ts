import { ReelScriptResult, ScriptParams } from "./geminiService";

export interface WorkspaceSummary {
  id: string;
  name: string;
  instagramConnected: boolean;
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
  status: "draft" | "processing" | "completed" | "failed";
  currentScriptId?: string | null;
  currentVideoId?: string | null;
  createdAt: string;
  updatedAt: string;
  video?: VideoRecord | null;
}

export interface VideoRecord {
  id: string;
  projectId: string;
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  previewUrl?: string | null;
  progress: number;
  errorMessage?: string | null;
}

export interface GalleryItem {
  project: ProjectRecord;
  video: VideoRecord & { previewUrl: string };
}

export interface JobRecord {
  id: string;
  projectId: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  outputUrl?: string | null;
  errorMessage?: string | null;
}

export interface UsageSummary {
  plan: "free" | "pro";
  reelsUsed: number;
  monthlyReelLimit: number;
  actions: Record<string, number>;
}

async function request<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const data = await response
      .clone()
      .json()
      .catch(async () => ({ error: await response.text().catch(() => "") }));
    throw new Error(data.error || `Request failed with status ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

export async function loadDashboard() {
  return request<{ workspace: WorkspaceSummary; projects: ProjectRecord[]; gallery: GalleryItem[]; usage: UsageSummary }>(
    "/api/projects",
  );
}

export async function createProject(input: ScriptParams & { title: string }) {
  const response = await request<{ project: ProjectRecord }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      topic: input.topic,
      style: input.style,
      tone: input.tone,
      language: input.language,
      targetDuration: input.duration,
    }),
  });
  return response.project;
}

export async function uploadAssets(files: File[]) {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch("/api/upload-assets", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "Upload failed." }));
    throw new Error(data.error || "Upload failed.");
  }

  return response.json() as Promise<{
    files: Array<{ absolutePath: string; publicUrl: string; originalName: string }>;
  }>;
}

export async function generateVideo(input: {
  projectId?: string;
  title: string;
  topic: string;
  style: string;
  tone: string;
  language: string;
  targetDuration: number;
  script: ReelScriptResult;
  captionStyle: string;
  useStockMedia: boolean;
  enableVoiceover: boolean;
  uploadedAssetPaths: string[];
}) {
  return request<{ project: ProjectRecord; video: VideoRecord; job: JobRecord }>("/api/generate-video", {
    method: "POST",
    body: JSON.stringify({
      projectId: input.projectId,
      title: input.title,
      topic: input.topic,
      style: input.style,
      tone: input.tone,
      language: input.language,
      targetDuration: input.targetDuration,
      scriptTitle: input.script.title,
      scriptContent: input.script.script,
      scriptScenes: input.script.scenes,
      pexelsKeywords: input.script.pexelsKeywords,
      captionStyle: input.captionStyle,
      useStockMedia: input.useStockMedia,
      enableVoiceover: input.enableVoiceover,
      uploadedAssetPaths: input.uploadedAssetPaths,
    }),
  });
}

export async function getJob(jobId: string) {
  const response = await request<{ job: JobRecord }>(`/api/jobs/${jobId}`);
  return response.job;
}

export async function getInstagramConnectUrl() {
  const response = await request<{ url: string }>("/api/instagram/connect-url");
  return response.url;
}

export async function publishInstagramProject(projectId: string, caption: string) {
  return request<{ result: { containerId: string; containerStatus?: string; mediaId: string } }>("/api/instagram/publish", {
    method: "POST",
    body: JSON.stringify({ projectId, caption }),
  });
}

export async function deleteProject(projectId: string) {
  return request<{ success: boolean }>(`/api/projects/${projectId}`, {
    method: "DELETE",
  });
}
