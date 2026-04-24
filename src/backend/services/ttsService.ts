import fs from "fs/promises";
import path from "path";
import googleTTS from "google-tts-api";
import { env } from "../config/env";

function splitTextForTts(text: string, maxLength = 180) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength) {
      if (current) {
        chunks.push(current);
      }
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function languageCode(language: string) {
  const normalized = language.toLowerCase();
  if (normalized.includes("hindi") || normalized.includes("hinglish")) {
    return "hi";
  }
  return "en";
}

async function runFfmpegConcat(inputListPath: string, outputPath: string) {
  const { spawn } = await import("child_process");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(env.ffmpegPath, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      inputListPath,
      "-c",
      "copy",
      outputPath,
    ]);

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      }
    });
  });
}

async function synthesizeWithGoogleTts(text: string, projectId: string, language: string) {
  const chunks = splitTextForTts(text);
  if (!chunks.length) {
    return null;
  }

  const workingDir = path.join(env.generatedDir, `${projectId}-tts`);
  await fs.mkdir(workingDir, { recursive: true });

  const chunkFiles: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const audioUrl = googleTTS.getAudioUrl(chunk, {
      lang: languageCode(language),
      slow: false,
      host: "https://translate.google.com",
    });
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Free TTS request failed with status ${response.status}`);
    }

    const chunkPath = path.join(workingDir, `chunk-${index + 1}.mp3`);
    await fs.writeFile(chunkPath, Buffer.from(await response.arrayBuffer()));
    chunkFiles.push(chunkPath);
  }

  const outputPath = path.join(env.generatedDir, `${projectId}-voiceover.mp3`);
  if (chunkFiles.length === 1) {
    await fs.copyFile(chunkFiles[0], outputPath);
    return outputPath;
  }

  const concatListPath = path.join(workingDir, "chunks.txt");
  await fs.writeFile(
    concatListPath,
    chunkFiles.map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8",
  );

  await runFfmpegConcat(concatListPath, outputPath);
  return outputPath;
}

function powershellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function synthesizeWithWindowsSpeech(text: string, projectId: string) {
  if (process.platform !== "win32") {
    return null;
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const { spawn } = await import("child_process");
  const outputPath = path.join(env.generatedDir, `${projectId}-voiceover.wav`);
  const command = [
    "Add-Type -AssemblyName System.Speech",
    "$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$speaker.Rate = 1",
    "$speaker.Volume = 100",
    `$speaker.SetOutputToWaveFile(${powershellString(outputPath)})`,
    `$speaker.Speak(${powershellString(normalized)})`,
    "$speaker.Dispose()",
  ].join("; ");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `Windows speech synthesis exited with code ${code}`));
      }
    });
  });

  return outputPath;
}

export async function synthesizeVoiceover(text: string, projectId: string, language: string) {
  try {
    return await synthesizeWithGoogleTts(text, projectId, language);
  } catch (error) {
    const localVoiceover = await synthesizeWithWindowsSpeech(text, projectId);
    if (localVoiceover) {
      return localVoiceover;
    }
    throw error;
  }
}
