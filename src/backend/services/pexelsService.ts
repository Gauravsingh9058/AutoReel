import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { env } from "../config/env";
import { toPublicFileUrl } from "../lib/filesystem";
import { MediaAssetRecord, MediaKind } from "../types";

function pexelsHeaders() {
  if (!env.pexelsApiKey) {
    return null;
  }

  return {
    Authorization: env.pexelsApiKey,
  };
}

function mediaId(kind: MediaKind, sourceUrl: string) {
  return crypto.createHash("md5").update(`${kind}:${sourceUrl}`).digest("hex");
}

async function cacheRemoteAsset(kind: MediaKind, remoteUrl: string) {
  const identifier = mediaId(kind, remoteUrl);
  const extension = kind === "image" ? ".jpg" : ".mp4";
  const absolutePath = path.join(env.mediaCacheDir, `${identifier}${extension}`);

  try {
    await fs.access(absolutePath);
    return absolutePath;
  } catch {
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      throw new Error(`Pexels download failed with status ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(absolutePath, buffer);
    return absolutePath;
  }
}

export async function fetchPexelsMedia(keywords: string[], projectId: string) {
  const assets: MediaAssetRecord[] = [];
  const headers = pexelsHeaders();

  if (!headers) {
    return assets;
  }

  for (const keyword of keywords.slice(0, 6)) {
    try {
      const videoResponse = await fetch(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&orientation=portrait&per_page=1`,
        { headers },
      );
      const videoData = (await videoResponse.json()) as any;
      const videoFile =
        videoData?.videos?.[0]?.video_files?.find((file: any) => file.width >= 720) ||
        videoData?.videos?.[0]?.video_files?.[0];

      if (videoFile?.link) {
        const localPath = await cacheRemoteAsset("video", videoFile.link);
        assets.push({
          id: crypto.randomUUID(),
          projectId,
          kind: "video",
          source: "pexels",
          sourceUrl: videoFile.link,
          localPath,
          previewUrl: toPublicFileUrl(localPath),
          durationSeconds: videoData?.videos?.[0]?.duration || null,
          createdAt: new Date().toISOString(),
        });
        continue;
      }

      const imageResponse = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&orientation=portrait&per_page=1`,
        { headers },
      );
      const imageData = (await imageResponse.json()) as any;
      const imageUrl = imageData?.photos?.[0]?.src?.large2x || imageData?.photos?.[0]?.src?.large;
      if (imageUrl) {
        const localPath = await cacheRemoteAsset("image", imageUrl);
        assets.push({
          id: crypto.randomUUID(),
          projectId,
          kind: "image",
          source: "pexels",
          sourceUrl: imageUrl,
          localPath,
          previewUrl: toPublicFileUrl(localPath),
          durationSeconds: null,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.warn(`Pexels lookup failed for keyword "${keyword}". Falling back to built-in visuals.`, error);
    }
  }

  return assets;
}
