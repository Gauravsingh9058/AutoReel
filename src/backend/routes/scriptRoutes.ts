import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { generationRateLimiter } from "../middleware/rateLimiters";
import { generateScriptWithGemini } from "../services/geminiService";

const schema = z.object({
  topic: z.string().min(3),
  style: z.string().min(2),
  language: z.string().min(2),
  tone: z.string().min(2),
  duration: z.number().int().min(5).max(180),
});

export const scriptRouter = Router();

scriptRouter.post(
  "/generate-script",
  generationRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = schema.parse(req.body);
    const script = await generateScriptWithGemini({
      topic: parsed.topic,
      style: parsed.style,
      language: parsed.language,
      tone: parsed.tone,
      duration: parsed.duration,
    });
    res.json(script);
  }),
);
