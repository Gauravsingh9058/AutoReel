import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { env } from "../config/env";
import { toPublicFileUrl } from "../lib/filesystem";

function randomFileName(prefix: string, extension: string) {
  return `${prefix}-${crypto.randomUUID()}${extension}`;
}

export async function saveUploadedBuffer(buffer: Buffer, originalName: string) {
  const extension = path.extname(originalName) || ".bin";
  const absolutePath = path.join(env.uploadsDir, randomFileName("upload", extension));
  await fs.writeFile(absolutePath, buffer);
  return {
    absolutePath,
    publicUrl: toPublicFileUrl(absolutePath),
  };
}

export async function downloadRemoteFile(url: string, targetDirectory: string, prefix: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download remote file: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const extension = contentType.includes("image")
    ? ".jpg"
    : contentType.includes("audio")
      ? ".mp3"
      : ".mp4";
  const absolutePath = path.join(targetDirectory, randomFileName(prefix, extension));
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(absolutePath, Buffer.from(arrayBuffer));
  return {
    absolutePath,
    publicUrl: toPublicFileUrl(absolutePath),
  };
}
