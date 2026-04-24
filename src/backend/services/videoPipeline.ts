import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { env } from "../config/env";
import { MediaAssetRecord, SceneDefinition, ScriptRecord, VideoGenerationPayload } from "../types";
import { fetchPexelsMedia } from "./pexelsService";
import { synthesizeVoiceover } from "./ttsService";

interface PipelineResult {
  outputPath: string;
  previewUrl: string;
  assets: MediaAssetRecord[];
  voiceoverPath?: string | null;
}

interface PipelineHooks {
  onProgress?: (progress: number, message: string) => Promise<void> | void;
}

interface AudioInput {
  label: string;
  role: "voice" | "music";
}

function ffmpegPathForFilter(inputPath: string) {
  return inputPath.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function timestampFromSeconds(totalSeconds: number) {
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(Math.floor(totalSeconds % 60)).padStart(2, "0");
  const milliseconds = String(Math.floor((totalSeconds % 1) * 1000)).padStart(3, "0");
  return `${hours}:${minutes}:${seconds},${milliseconds}`;
}

function normalizeOverlayText(value: string) {
  return value.replace(/\r?\n/g, " ").trim();
}

async function runCommand(binary: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `${binary} exited with code ${code}`));
      }
    });
  });
}

async function writeSubtitleFile(script: ScriptRecord, outputDir: string, totalDuration: number) {
  const scenes = script.scenes.length ? script.scenes : fallbackScenes(script.content);
  const durationPerScene = totalDuration / Math.max(scenes.length, 1);
  let cursor = 0;
  const lines = scenes.map((scene, index) => {
    const start = cursor;
    const end = cursor + durationPerScene;
    cursor = end;
    return [
      String(index + 1),
      `${timestampFromSeconds(start)} --> ${timestampFromSeconds(end)}`,
      scene.spokenText || scene.text || scene.visual,
      "",
    ].join("\n");
  });

  const subtitlePath = path.join(outputDir, "captions.srt");
  await fs.writeFile(subtitlePath, lines.join("\n"), "utf8");
  return subtitlePath;
}

function fallbackScenes(script: string): SceneDefinition[] {
  return script
    .split(/\n+/)
    .filter(Boolean)
    .map((line, index) => ({
      sceneNumber: index + 1,
      visual: line,
      text: line,
      spokenText: line,
    }));
}

async function createSceneClip(
  asset: MediaAssetRecord | null,
  scene: SceneDefinition,
  sceneDuration: number,
  index: number,
  workingDir: string,
) {
  const clipPath = path.join(workingDir, `scene-${index + 1}.mp4`);
  const overlayText = normalizeOverlayText(scene.text || scene.spokenText || scene.visual || `Scene ${index + 1}`);
  const overlayTextPath = path.join(workingDir, `scene-${index + 1}.txt`);
  await fs.writeFile(overlayTextPath, overlayText, "utf8");
  const baseFilter =
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1," +
    `drawtext=textfile='${ffmpegPathForFilter(overlayTextPath)}':x=(w-text_w)/2:y=h-260:fontcolor=white:fontsize=44:box=1:boxcolor=black@0.45:boxborderw=24,` +
    `fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(sceneDuration - 0.35, 0.1)}:d=0.25`;

  if (!asset) {
    await runCommand(env.ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x111111:s=1080x1920:r=30",
      "-t",
      String(sceneDuration),
      "-vf",
      baseFilter,
      "-pix_fmt",
      "yuv420p",
      clipPath,
    ]);
    return clipPath;
  }

  const sourceArgs =
    asset.kind === "image"
      ? ["-loop", "1", "-i", asset.localPath]
      : ["-stream_loop", "-1", "-i", asset.localPath];

  await runCommand(env.ffmpegPath, [
    "-y",
    ...sourceArgs,
    "-t",
    String(sceneDuration),
    "-vf",
    baseFilter,
    "-r",
    "30",
    "-an",
    "-pix_fmt",
    "yuv420p",
    clipPath,
  ]);

  return clipPath;
}

export async function generateVerticalReel(
  payload: VideoGenerationPayload,
  hooks: PipelineHooks = {},
): Promise<PipelineResult> {
  const workingDir = path.join(env.generatedDir, payload.project.id);
  await fs.mkdir(workingDir, { recursive: true });
  await hooks.onProgress?.(10, "Preparing media");

  let assets: MediaAssetRecord[] = [];
  if (payload.uploadedAssetPaths.length) {
    assets = payload.uploadedAssetPaths.map((assetPath, index) => ({
      id: `${payload.project.id}-upload-${index}`,
      projectId: payload.project.id,
      kind: assetPath.endsWith(".mp3") ? "audio" : assetPath.match(/\.(png|jpg|jpeg|webp)$/i) ? "image" : "video",
      source: "upload",
      sourceUrl: assetPath,
      localPath: assetPath,
      previewUrl: assetPath,
      durationSeconds: null,
      createdAt: new Date().toISOString(),
    }));
  } else if (payload.useStockMedia) {
    assets = await fetchPexelsMedia(payload.script.keywords, payload.project.id);
  }

  const scenes = payload.script.scenes.length ? payload.script.scenes : fallbackScenes(payload.script.content);
  const sceneDuration = payload.project.targetDuration / Math.max(scenes.length, 1);
  const clipPaths: string[] = [];
  const visualAssets = assets.filter((asset) => asset.kind !== "audio");

  for (const [index, scene] of scenes.entries()) {
    const asset = visualAssets[index % Math.max(visualAssets.length, 1)] || null;
    clipPaths.push(await createSceneClip(asset, scene, sceneDuration, index, workingDir));
    await hooks.onProgress?.(15 + Math.round(((index + 1) / scenes.length) * 35), `Rendered scene ${index + 1}/${scenes.length}`);
  }

  const concatPath = path.join(workingDir, "clips.txt");
  await fs.writeFile(
    concatPath,
    clipPaths.map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );

  const stitchedPath = path.join(workingDir, "stitched.mp4");
  await runCommand(env.ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    stitchedPath,
  ]);

  await hooks.onProgress?.(60, "Building captions");
  const subtitlePath = await writeSubtitleFile(payload.script, workingDir, payload.project.targetDuration);

  let voiceoverPath: string | null = null;
  if (payload.enableVoiceover) {
    voiceoverPath = await synthesizeVoiceover(payload.script.content, payload.project.id, payload.project.language);
    await hooks.onProgress?.(72, "Voiceover synthesized");
  }

  const outputPath = path.join(env.generatedDir, `${payload.project.id}.mp4`);
  const finalArgs = ["-y", "-i", stitchedPath];
  const audioInputs: AudioInput[] = [];
  const uploadedMusicPath = payload.uploadedAssetPaths.find((assetPath) => assetPath.match(/\.(mp3|wav|m4a)$/i)) || null;
  const hasDefaultMusic = payload.backgroundMusicPath || uploadedMusicPath || env.defaultMusicPath;
  let nextInputIndex = 1;

  if (voiceoverPath) {
    finalArgs.push("-i", voiceoverPath);
    audioInputs.push({ label: `[${nextInputIndex}:a]`, role: "voice" });
    nextInputIndex += 1;
  }

  if (hasDefaultMusic) {
    finalArgs.push("-i", payload.backgroundMusicPath || uploadedMusicPath || env.defaultMusicPath);
    audioInputs.push({ label: `[${nextInputIndex}:a]`, role: "music" });
  }

  const videoFilter = `subtitles='${ffmpegPathForFilter(subtitlePath)}'`;
  const outputEncodingArgs = [
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
  ];

  if (audioInputs.length === 2) {
    const voice = audioInputs.find((input) => input.role === "voice");
    const music = audioInputs.find((input) => input.role === "music");
    finalArgs.push(
      "-filter_complex",
      `${voice?.label}aresample=48000,volume=1.35[voice];${music?.label}aresample=48000,volume=0.16[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      "-vf",
      videoFilter,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-shortest",
      ...outputEncodingArgs,
      outputPath,
    );
  } else if (audioInputs.length === 1) {
    const input = audioInputs[0];
    const volume = input.role === "voice" ? "1.35" : "0.22";
    finalArgs.push(
      "-filter_complex",
      `${input.label}aresample=48000,volume=${volume}[aout]`,
      "-vf",
      videoFilter,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-shortest",
      ...outputEncodingArgs,
      outputPath,
    );
  } else {
    finalArgs.push("-vf", videoFilter, "-an", "-c:v", "libx264", "-movflags", "+faststart", outputPath);
  }

  await hooks.onProgress?.(84, "Finalizing video");
  await runCommand(env.ffmpegPath, finalArgs);
  await hooks.onProgress?.(100, "Video completed");

  return {
    outputPath,
    previewUrl: `/generated/${path.basename(outputPath)}`,
    assets,
    voiceoverPath,
  };
}

export function getFfmpegCommandsExample() {
  return {
    sceneClip:
      `ffmpeg -y -loop 1 -i scene.jpg -t 5 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,drawtext=text='Hook':x=(w-text_w)/2:y=h-260" -r 30 scene-1.mp4`,
    concat:
      `ffmpeg -y -f concat -safe 0 -i clips.txt -c:v libx264 -pix_fmt yuv420p stitched.mp4`,
    captionsAndMusic:
      `ffmpeg -y -i stitched.mp4 -i voiceover.mp3 -i music.mp3 -filter_complex "[2:a]volume=0.18[music];[1:a][music]amix=inputs=2:duration=longest[aout]" -vf "subtitles=captions.srt" -map 0:v -map "[aout]" -shortest final.mp4`,
  };
}
