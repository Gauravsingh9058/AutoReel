import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env";
import { incrementUserUsage, replaceVideoAssets, updateProject, updateVideo } from "../repositories/appRepository";
import { generateVerticalReel } from "../services/videoPipeline";
import { JobState, VideoGenerationPayload } from "../types";

const localJobs = new Map<string, JobState>();

let queue: Queue<VideoGenerationPayload> | null = null;
let workerStarted = false;
let queueModePromise: Promise<"redis" | "local"> | null = null;
let warnedAboutRedisFallback = false;

function now() {
  return new Date().toISOString();
}

function redisConnection() {
  if (!env.redisUrl) {
    return null;
  }

  return new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
  });
}

function logRedisFallbackOnce(reason?: unknown) {
  if (warnedAboutRedisFallback) {
    return;
  }

  warnedAboutRedisFallback = true;
  const details = reason instanceof Error ? reason.message : "";
  console.warn(`Redis unavailable. Falling back to local video processing.${details ? ` ${details}` : ""}`);
}

async function detectQueueMode() {
  if (!env.redisUrl) {
    return "local" as const;
  }

  const probe = new IORedis(env.redisUrl, {
    lazyConnect: true,
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });

  try {
    await probe.ping();
    return "redis" as const;
  } catch (error) {
    logRedisFallbackOnce(error);
    return "local" as const;
  } finally {
    probe.disconnect();
  }
}

async function getQueueMode() {
  if (!queueModePromise) {
    queueModePromise = detectQueueMode();
  }

  return queueModePromise;
}

function setJobState(jobId: string, patch: Partial<JobState>) {
  const current = localJobs.get(jobId) || {
    id: jobId,
    videoId: "",
    projectId: "",
    status: "queued" as const,
    progress: 0,
    message: "Queued",
    createdAt: now(),
    updatedAt: now(),
  };

  const next = {
    ...current,
    ...patch,
    updatedAt: now(),
  };
  localJobs.set(jobId, next);
  return next;
}

async function processPayload(payload: VideoGenerationPayload) {
  setJobState(payload.jobId, {
    id: payload.jobId,
    videoId: payload.project.currentVideoId || "",
    projectId: payload.project.id,
    status: "processing",
    progress: 5,
    message: "Preparing assets",
  });

  await updateProject(payload.project.id, { status: "processing" });

  const result = await generateVerticalReel(payload, {
    onProgress: async (progress, message) => {
      setJobState(payload.jobId, {
        status: progress >= 100 ? "completed" : "processing",
        progress,
        message,
      });

      if (payload.project.currentVideoId) {
        await updateVideo(payload.project.currentVideoId, {
          status: progress >= 100 ? "completed" : "processing",
          progress,
        });
      }
    },
  });

  if (payload.project.currentVideoId) {
    await updateVideo(payload.project.currentVideoId, {
      status: "completed",
      progress: 100,
      outputPath: result.outputPath,
      previewUrl: result.previewUrl,
      sourceAssets: result.assets,
      voiceoverPath: result.voiceoverPath,
    });
    await replaceVideoAssets(payload.project.currentVideoId, result.assets);
  }

  await incrementUserUsage(payload.userId, "video_generation", {
    projectId: payload.project.id,
    jobId: payload.jobId,
  });
  await updateProject(payload.project.id, { status: "completed" });
  setJobState(payload.jobId, {
    status: "completed",
    progress: 100,
    message: "Video ready",
    outputUrl: result.previewUrl,
  });
  return result;
}

async function processJobSafely(payload: VideoGenerationPayload) {
  try {
    await processPayload(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video generation failed.";
    setJobState(payload.jobId, {
      status: "failed",
      progress: 100,
      message,
      errorMessage: message,
    });
    await updateProject(payload.project.id, { status: "failed" });
    if (payload.project.currentVideoId) {
      await updateVideo(payload.project.currentVideoId, {
        status: "failed",
        progress: 100,
        errorMessage: message,
      });
    }
  }
}

function enqueueLocalJob(payload: VideoGenerationPayload) {
  setTimeout(() => {
    void processJobSafely(payload);
  }, 50);
}

export async function enqueueVideoJob(payload: VideoGenerationPayload) {
  setJobState(payload.jobId, {
    id: payload.jobId,
    videoId: payload.project.currentVideoId || "",
    projectId: payload.project.id,
    status: "queued",
    progress: 0,
    message: "Job queued",
  });

  if ((await getQueueMode()) === "redis") {
    if (!queue) {
      const connection = redisConnection();
      queue = new Queue<VideoGenerationPayload>("vidsnapai-video-jobs", {
        connection: connection || undefined,
      });
    }
    try {
      await queue.add("generate-video", payload, {
        jobId: payload.jobId,
        removeOnComplete: true,
        removeOnFail: false,
      });
    } catch (error) {
      logRedisFallbackOnce(error);
      queueModePromise = Promise.resolve("local");
      enqueueLocalJob(payload);
    }
  } else {
    enqueueLocalJob(payload);
  }

  return getJobState(payload.jobId);
}

export function getJobState(jobId: string) {
  return localJobs.get(jobId) || null;
}

export function startVideoWorker() {
  if (workerStarted) {
    return;
  }

  workerStarted = true;
  void (async () => {
    if ((await getQueueMode()) !== "redis") {
      return;
    }

    const connection = redisConnection();
    if (!connection) {
      return;
    }

    new Worker<VideoGenerationPayload>(
      "vidsnapai-video-jobs",
      async (job) => {
        await processJobSafely(job.data);
      },
      { connection },
    );
  })();
}
