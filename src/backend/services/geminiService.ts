import { GoogleGenAI, Type } from "@google/genai";
import { env } from "../config/env";
import { AppError, ConfigError } from "../lib/errors";
import { ScriptGenerationInput, ScriptResult } from "../types";

const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
const RETRY_DELAYS_MS = [700, 1600];
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_PROVIDER_STATUSES = new Set([
  "ABORTED",
  "DEADLINE_EXCEEDED",
  "INTERNAL",
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
]);
const MIN_WORDS_PER_SECOND = 1.8;
const MAX_WORDS_PER_SECOND = 2.5;

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function targetWordRange(duration: number) {
  return {
    min: Math.max(12, Math.round(duration * MIN_WORDS_PER_SECOND)),
    max: Math.max(20, Math.round(duration * MAX_WORDS_PER_SECOND)),
  };
}

function targetSceneCount(duration: number) {
  return Math.max(3, Math.min(12, Math.round(duration / 5)));
}

function buildPrompt(input: ScriptGenerationInput, attempt: number) {
  const wordRange = targetWordRange(input.duration);
  const sceneCount = targetSceneCount(input.duration);
  const strictnessNote =
    attempt === 0
      ? ""
      : "Important: the last draft was too short. Do not return only a hook or teaser. Return a complete narration that can actually fill the requested duration.";

  return `Generate a complete social media reel script as JSON.
Topic: ${input.topic}
Style: ${input.style}
Language: ${input.language}
Tone: ${input.tone}
Target Duration: ${input.duration} seconds
Target Spoken Word Count: ${wordRange.min}-${wordRange.max} words
Target Scene Count: ${sceneCount}

Requirements:
- The script must be a full voiceover sized for ${input.duration} seconds, not just an intro.
- The "script" field must contain the complete spoken narration in ${wordRange.min}-${wordRange.max} words.
- Create exactly ${sceneCount} scenes.
- Each scene must have meaningful spokenText, and the combined spokenText across all scenes must cover the full narration.
- Keep each scene's "text" short and caption-friendly.
- Keep each scene's "visual" specific enough for stock footage or on-screen direction.
- Include 5 to 8 useful pexelsKeywords.
- Do not include markdown, notes, or explanations outside the JSON.
${strictnessNote}`.trim();
}

function normalizeScriptResult(result: ScriptResult) {
  const normalizedScenes = (result.scenes || [])
    .map((scene, index) => ({
      sceneNumber: Number.isFinite(scene.sceneNumber) ? scene.sceneNumber : index + 1,
      visual: (scene.visual || "").trim(),
      text: (scene.text || "").trim(),
      spokenText: (scene.spokenText || "").trim(),
    }))
    .filter((scene) => scene.visual || scene.text || scene.spokenText);

  const combinedSpokenText = normalizedScenes.map((scene) => scene.spokenText).filter(Boolean).join(" ").trim();
  const normalizedScript = (result.script || "").trim() || combinedSpokenText;

  return {
    title: (result.title || "").trim(),
    script: normalizedScript,
    scenes: normalizedScenes,
    pexelsKeywords: (result.pexelsKeywords || []).map((keyword) => keyword.trim()).filter(Boolean),
  } satisfies ScriptResult;
}

function isScriptLongEnough(result: ScriptResult, duration: number) {
  const wordRange = targetWordRange(duration);
  const scriptWords = countWords(result.script);
  const spokenWords = countWords(result.scenes.map((scene) => scene.spokenText).join(" "));
  const sceneCount = result.scenes.length;
  const effectiveWords = Math.max(scriptWords, spokenWords);

  return effectiveWords >= wordRange.min && sceneCount >= Math.max(3, targetSceneCount(duration) - 1);
}

function getGeminiClient() {
  if (!env.geminiApiKey) {
    throw new ConfigError("GEMINI_API_KEY is missing. Add it to the backend environment.");
  }

  return new GoogleGenAI({ apiKey: env.geminiApiKey });
}

function getCandidateModels() {
  return Array.from(new Set([env.geminiModel.trim(), ...FALLBACK_MODELS].filter(Boolean)));
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function tryParseJsonFromText(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }

  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function parseGeminiError(error: unknown) {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const message = error instanceof Error ? error.message : String(error || "");
  const parsed = tryParseJsonFromText(message);
  const parsedError =
    parsed?.error && typeof parsed.error === "object" ? (parsed.error as Record<string, unknown>) : undefined;

  const statusCode =
    readNumber(record.status) ??
    readNumber(record.statusCode) ??
    readNumber(record.code) ??
    readNumber(parsedError?.code) ??
    readNumber(parsed?.code);

  return {
    message: readString(parsedError?.message) || readString(parsed?.message) || message,
    providerStatus: readString(parsedError?.status) || readString(parsed?.status),
    statusCode,
  };
}

function isTransientGeminiError(error: unknown) {
  const parsed = parseGeminiError(error);
  return (
    (typeof parsed.statusCode === "number" && TRANSIENT_STATUS_CODES.has(parsed.statusCode)) ||
    (typeof parsed.providerStatus === "string" && TRANSIENT_PROVIDER_STATUSES.has(parsed.providerStatus))
  );
}

function normalizeGeminiFailure(error: unknown, modelsTried: string[]) {
  const parsed = parseGeminiError(error);

  if (isTransientGeminiError(error)) {
    return new AppError("Gemini is temporarily busy. Please try again in a minute.", 503, {
      modelsTried,
      providerStatus: parsed.providerStatus,
      providerStatusCode: parsed.statusCode,
    });
  }

  return new AppError("Gemini could not generate a script right now. Please try again.", 502, {
    modelsTried,
    providerMessage: parsed.message,
    providerStatus: parsed.providerStatus,
    providerStatusCode: parsed.statusCode,
  });
}

export async function generateScriptWithGemini(input: ScriptGenerationInput) {
  const client = getGeminiClient();
  const models = getCandidateModels();

  const requestConfig = {
    systemInstruction:
      "You are VidSnapAI, a senior viral-video strategist who writes complete short-form video narrations optimized for retention, captions, edits, and stock footage coverage.",
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        script: { type: Type.STRING },
        scenes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              sceneNumber: { type: Type.NUMBER },
              visual: { type: Type.STRING },
              text: { type: Type.STRING },
              spokenText: { type: Type.STRING },
            },
            required: ["sceneNumber", "visual", "text", "spokenText"],
          },
        },
        pexelsKeywords: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ["title", "script", "scenes", "pexelsKeywords"],
    },
  };

  let lastError: unknown;
  const modelsTried: string[] = [];

  for (const model of models) {
    modelsTried.push(model);

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length + 1; attempt += 1) {
      try {
        const prompt = buildPrompt(input, attempt);
        const response = await client.models.generateContent({
          model,
          contents: prompt,
          config: requestConfig,
        });

        const parsed = normalizeScriptResult(JSON.parse(response.text || "{}") as ScriptResult);
        if (!isScriptLongEnough(parsed, input.duration)) {
          lastError = new AppError(
            `Generated script was too short for ${input.duration} seconds. Please try again.`,
            502,
            {
              duration: input.duration,
              actualWords: countWords(parsed.script),
              sceneCount: parsed.scenes.length,
            },
          );

          if (attempt <= RETRY_DELAYS_MS.length) {
            continue;
          }

          throw lastError;
        }

        return parsed;
      } catch (error) {
        lastError = error;

        if (!isTransientGeminiError(error)) {
          if (error instanceof AppError && error.message.includes("too short")) {
            continue;
          }
          throw normalizeGeminiFailure(error, modelsTried);
        }

        const delay = RETRY_DELAYS_MS[attempt];
        if (typeof delay === "number") {
          await sleep(delay);
        }
      }
    }
  }

  throw normalizeGeminiFailure(lastError, modelsTried);
}
