import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./src/backend/config/env";
import { errorHandler } from "./src/backend/middleware/errorHandler";
import { instagramRouter } from "./src/backend/routes/instagramRoutes";
import { mediaRouter } from "./src/backend/routes/mediaRoutes";
import { projectRouter } from "./src/backend/routes/projectRoutes";
import { scriptRouter } from "./src/backend/routes/scriptRoutes";
import { ensureStorageDirectories } from "./src/backend/lib/filesystem";
import { startVideoWorker } from "./src/backend/queue/videoQueue";
import { getFfmpegCommandsExample } from "./src/backend/services/videoPipeline";

dotenv.config({ path: ".env.local" });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function isExistingServerHealthy(host: string, port: number) {
  try {
    const response = await fetch(`http://${host}:${port}/api/health`);
    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { status?: string };
    return data.status === "ok";
  } catch {
    return false;
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 4173);
  const HOST = process.env.HOST || "127.0.0.1";

  if (await isExistingServerHealthy(HOST, PORT)) {
    console.log(`VidSnapAI is already running at http://${HOST}:${PORT}`);
    return;
  }

  await ensureStorageDirectories();
  startVideoWorker();

  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/uploads", express.static(env.uploadsDir));
  app.use("/generated", express.static(env.generatedDir));
  app.use("/media-cache", express.static(env.mediaCacheDir));

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      app: "VidSnapAI",
      mode: env.nodeEnv,
      storageMode: env.storageMode,
      databaseConfigured: Boolean(env.usePostgres && env.databaseUrl),
      redisConfigured: Boolean(env.redisUrl),
    });
  });

  app.get("/api/ffmpeg/examples", (_req, res) => {
    res.json(getFfmpegCommandsExample());
  });

  app.use("/api", scriptRouter);
  app.use("/api", mediaRouter);
  app.use("/api", projectRouter);
  app.use("/api", instagramRouter);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.use(errorHandler);

  app.listen(PORT, HOST, () => {
    console.log(`VidSnapAI SaaS running on http://${HOST}:${PORT}`);
  });
}

startServer();
