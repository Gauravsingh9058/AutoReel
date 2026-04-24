import multer from "multer";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { generationRateLimiter } from "../middleware/rateLimiters";
import { fetchPexelsMedia } from "../services/pexelsService";
import { saveUploadedBuffer } from "../services/storageService";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const fetchMediaSchema = z.object({
  projectId: z.string().min(3),
  keywords: z.array(z.string().min(2)).min(1).max(8),
});

export const mediaRouter = Router();

mediaRouter.post(
  "/fetch-media",
  generationRateLimiter,
  asyncHandler(async (req, res) => {
    const body = fetchMediaSchema.parse(req.body);
    const assets = await fetchPexelsMedia(body.keywords, body.projectId);
    res.json({ assets });
  }),
);

mediaRouter.post(
  "/upload-assets",
  upload.array("files", 10),
  asyncHandler(async (req, res) => {
    const uploadedFiles = await Promise.all(
      (req.files as Express.Multer.File[]).map(async (file) => {
        const stored = await saveUploadedBuffer(file.buffer, file.originalname);
        return {
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          absolutePath: stored.absolutePath,
          publicUrl: stored.publicUrl,
        };
      }),
    );

    res.status(201).json({ files: uploadedFiles });
  }),
);
