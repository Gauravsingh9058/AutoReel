import fs from "fs/promises";
import path from "path";
import { env } from "../config/env";

export async function ensureStorageDirectories() {
  await Promise.all([
    fs.mkdir(env.uploadsDir, { recursive: true }),
    fs.mkdir(env.generatedDir, { recursive: true }),
    fs.mkdir(env.mediaCacheDir, { recursive: true }),
    fs.mkdir(env.dataDir, { recursive: true }),
  ]);
}

export function toPublicFileUrl(absolutePath: string) {
  const normalized = absolutePath.replace(/\\/g, "/");

  if (normalized.startsWith(env.generatedDir.replace(/\\/g, "/"))) {
    return `/generated/${path.basename(absolutePath)}`;
  }

  if (normalized.startsWith(env.uploadsDir.replace(/\\/g, "/"))) {
    return `/uploads/${path.basename(absolutePath)}`;
  }

  if (normalized.startsWith(env.mediaCacheDir.replace(/\\/g, "/"))) {
    return `/media-cache/${path.basename(absolutePath)}`;
  }

  return absolutePath;
}
