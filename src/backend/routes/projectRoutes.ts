import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { asyncHandler } from "../lib/asyncHandler";
import { AppError } from "../lib/errors";
import {
  createProject,
  createScript,
  createVideo,
  deleteProject,
  findLatestScriptByProject,
  findProjectById,
  findVideoByJobId,
  findVideoByProject,
  getOrCreateWorkspaceUser,
  getProjectBundle,
  getUsageSummary,
  listProjectsByUser,
  updateProject,
} from "../repositories/appRepository";
import { enqueueVideoJob, getJobState } from "../queue/videoQueue";
import { assertUsageAvailable } from "../services/usageService";

const projectSchema = z.object({
  title: z.string().min(2),
  topic: z.string().min(2),
  style: z.string().min(2),
  tone: z.string().min(2),
  language: z.string().min(2),
  targetDuration: z.number().int().min(5).max(180),
});

const generateVideoSchema = projectSchema.extend({
  projectId: z.string().optional(),
  scriptTitle: z.string().min(2),
  scriptContent: z.string().min(10),
  scriptScenes: z.array(
    z.object({
      sceneNumber: z.number(),
      visual: z.string(),
      text: z.string(),
      spokenText: z.string(),
    }),
  ),
  pexelsKeywords: z.array(z.string()).default([]),
  captionStyle: z.string().default("bold"),
  useStockMedia: z.boolean().default(true),
  enableVoiceover: z.boolean().default(true),
  uploadedAssetPaths: z.array(z.string()).default([]),
  backgroundMusicPath: z.string().optional(),
});

export const projectRouter = Router();

function isInsideDirectory(targetPath: string, parentDirectory: string) {
  const relative = path.relative(path.resolve(parentDirectory), path.resolve(targetPath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function removeGeneratedProjectFiles(projectId: string, outputPath?: string | null, voiceoverPath?: string | null) {
  const candidates = [
    outputPath || path.join(env.generatedDir, `${projectId}.mp4`),
    voiceoverPath || path.join(env.generatedDir, `${projectId}-voiceover.mp3`),
    path.join(env.generatedDir, projectId),
    path.join(env.generatedDir, `${projectId}-tts`),
  ];

  await Promise.all(
    candidates.map(async (candidate) => {
      if (!candidate || !isInsideDirectory(candidate, env.generatedDir)) {
        return;
      }
      await fs.rm(candidate, { force: true, recursive: true }).catch(() => undefined);
    }),
  );
}

projectRouter.get(
  "/projects",
  asyncHandler(async (req, res) => {
    const workspace = await getOrCreateWorkspaceUser();
    const projects = await listProjectsByUser(workspace.id);
    const projectsWithVideos = await Promise.all(
      projects.map(async (project) => ({
        ...project,
        video: await findVideoByProject(project.id),
      })),
    );
    const gallery = projectsWithVideos.flatMap((project) => {
      const { video, ...projectFields } = project;
      if (!video || video.status !== "completed" || !video.previewUrl) {
        return [];
      }
      return [{ project: projectFields, video }];
    });
    const usage = await getUsageSummary(workspace.id);
    res.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        instagramConnected: Boolean(
          env.metaInstagramAccountId && env.metaAccessToken,
        ),
      },
      projects: projectsWithVideos,
      gallery,
      usage,
    });
  }),
);

projectRouter.delete(
  "/projects/:projectId",
  asyncHandler(async (req, res) => {
    const workspace = await getOrCreateWorkspaceUser();
    const bundle = await getProjectBundle(req.params.projectId);
    if (!bundle.project || bundle.project.userId !== workspace.id) {
      throw new AppError("Project not found.", 404);
    }

    await removeGeneratedProjectFiles(bundle.project.id, bundle.video?.outputPath, bundle.video?.voiceoverPath);
    await deleteProject(bundle.project.id);

    res.json({ success: true });
  }),
);

projectRouter.post(
  "/projects",
  asyncHandler(async (req, res) => {
    const workspace = await getOrCreateWorkspaceUser();
    const body = projectSchema.parse(req.body);
    const project = await createProject({
      userId: workspace.id,
      title: body.title,
      topic: body.topic,
      style: body.style,
      tone: body.tone,
      language: body.language,
      targetDuration: body.targetDuration,
      status: "draft",
    });
    res.status(201).json({ project });
  }),
);

projectRouter.get(
  "/projects/:projectId",
  asyncHandler(async (req, res) => {
    const workspace = await getOrCreateWorkspaceUser();
    const bundle = await getProjectBundle(req.params.projectId);
    if (!bundle.project || bundle.project.userId !== workspace.id) {
      throw new AppError("Project not found.", 404);
    }
    res.json(bundle);
  }),
);

projectRouter.post(
  "/generate-video",
  asyncHandler(async (req, res) => {
    const workspace = await getOrCreateWorkspaceUser();
    const body = generateVideoSchema.parse(req.body);
    await assertUsageAvailable(workspace);

    let project = body.projectId ? await findProjectById(body.projectId) : null;
    if (project && project.userId !== workspace.id) {
      throw new AppError("Project not found.", 404);
    }

    if (!project) {
      project = await createProject({
        userId: workspace.id,
        title: body.title,
        topic: body.topic,
        style: body.style,
        tone: body.tone,
        language: body.language,
        targetDuration: body.targetDuration,
        status: "draft",
      });
    }

    const script = await createScript({
      projectId: project.id,
      title: body.scriptTitle,
      content: body.scriptContent,
      scenes: body.scriptScenes.map((scene) => ({
        sceneNumber: scene.sceneNumber,
        visual: scene.visual,
        text: scene.text,
        spokenText: scene.spokenText,
      })),
      keywords: [...body.pexelsKeywords],
    });

    const jobId = crypto.randomUUID();
    const video = await createVideo({
      projectId: project.id,
      jobId,
      status: "queued",
      outputPath: null,
      previewUrl: null,
      sourceAssets: [],
      captionStyle: body.captionStyle,
      backgroundMusicPath: body.backgroundMusicPath || null,
      voiceoverPath: null,
      progress: 0,
      errorMessage: null,
    });

    project = await updateProject(project.id, {
      currentScriptId: script.id,
      currentVideoId: video.id,
      status: "processing",
      title: body.title,
      topic: body.topic,
      style: body.style,
      tone: body.tone,
      language: body.language,
      targetDuration: body.targetDuration,
    });

    if (!project) {
      throw new AppError("Unable to update project.", 500);
    }

    await enqueueVideoJob({
      jobId,
      userId: workspace.id,
      project,
      script,
      captionStyle: body.captionStyle,
      useStockMedia: body.useStockMedia,
      enableVoiceover: body.enableVoiceover,
      backgroundMusicPath: body.backgroundMusicPath,
      uploadedAssetPaths: body.uploadedAssetPaths,
    });

    res.status(202).json({
      job: getJobState(jobId),
      project,
      script,
      video,
    });
  }),
);

projectRouter.get(
  "/jobs/:jobId",
  asyncHandler(async (req, res) => {
    const workspace = await getOrCreateWorkspaceUser();
    const job = getJobState(req.params.jobId);
    if (!job) {
      throw new AppError("Job not found.", 404);
    }
    const video = await findVideoByJobId(req.params.jobId);
    const project = video ? await findProjectById(video.projectId) : null;
    if (project && project.userId !== workspace.id) {
      throw new AppError("Job not found.", 404);
    }
    res.json({ job });
  }),
);

projectRouter.post(
  "/projects/:projectId/regenerate",
  asyncHandler(async (req, res) => {
    const workspace = await getOrCreateWorkspaceUser();
    const project = await findProjectById(req.params.projectId);
    if (!project || project.userId !== workspace.id) {
      throw new AppError("Project not found.", 404);
    }
    const script = await findLatestScriptByProject(project.id);
    if (!script) {
      throw new AppError("No script found for this project.", 404);
    }

    await assertUsageAvailable(workspace);
    const jobId = crypto.randomUUID();
    const video = await createVideo({
      projectId: project.id,
      jobId,
      status: "queued",
      outputPath: null,
      previewUrl: null,
      sourceAssets: [],
      captionStyle: "bold",
      backgroundMusicPath: null,
      voiceoverPath: null,
      progress: 0,
      errorMessage: null,
    });

    const nextProject = await updateProject(project.id, {
      status: "processing",
      currentVideoId: video.id,
      currentScriptId: script.id,
    });
    if (!nextProject) {
      throw new AppError("Unable to prepare project regeneration.", 500);
    }

    await enqueueVideoJob({
      jobId,
      userId: workspace.id,
      project: nextProject,
      script,
      captionStyle: "bold",
      useStockMedia: true,
      enableVoiceover: true,
      uploadedAssetPaths: [],
    });

    res.status(202).json({
      project: nextProject,
      script,
      video,
      job: getJobState(jobId),
    });
  }),
);
