import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { asyncHandler } from "../lib/asyncHandler";
import { AppError } from "../lib/errors";
import { getOrCreateWorkspaceUser, getProjectBundle, incrementUserUsage } from "../repositories/appRepository";
import { publishInstagramReel } from "../services/instagramService";

const publishSchema = z.object({
  projectId: z.string().min(3),
  caption: z.string().min(3),
});

export const instagramRouter = Router();

instagramRouter.get(
  "/instagram/connect-url",
  asyncHandler(async (_req, res) => {
    res.json({
      url: "",
      mode: "backend",
    });
  }),
);

instagramRouter.post(
  "/instagram/publish",
  asyncHandler(async (req, res) => {
    const workspace = await getOrCreateWorkspaceUser();
    const body = publishSchema.parse(req.body);
    const instagramAccountId = env.metaInstagramAccountId;
    const instagramAccessToken = env.metaAccessToken;

    if (!instagramAccountId || !instagramAccessToken) {
      throw new AppError("Set META_ACCESS_TOKEN and META_IG_USER_ID in .env.local before publishing to Instagram.", 400);
    }

    const bundle = await getProjectBundle(body.projectId);
    if (!bundle.project || bundle.project.userId !== workspace.id) {
      throw new AppError("Project not found.", 404);
    }
    if (!bundle.video?.previewUrl) {
      throw new AppError("Generate a video before publishing.", 400);
    }

    const publicBaseUrl = (env.storageBaseUrl || env.appUrl).replace(/\/$/, "");
    if (!bundle.video.previewUrl.startsWith("http") && !/^https:\/\//i.test(publicBaseUrl)) {
      throw new AppError("Instagram needs a public HTTPS video URL. Set APP_URL or STORAGE_BASE_URL to your deployed/ngrok HTTPS URL.", 400);
    }

    const absoluteVideoUrl = bundle.video.previewUrl.startsWith("http")
      ? bundle.video.previewUrl
      : `${publicBaseUrl}${bundle.video.previewUrl}`;

    if (!/^https:\/\//i.test(absoluteVideoUrl)) {
      throw new AppError("Instagram needs the rendered video to be available over public HTTPS before publishing.", 400);
    }

    const result = await publishInstagramReel({
      accessToken: instagramAccessToken,
      instagramAccountId,
      videoUrl: absoluteVideoUrl,
      caption: body.caption,
    });

    await incrementUserUsage(workspace.id, "instagram_post", {
      projectId: body.projectId,
      instagramMediaId: result.mediaId,
    });

    res.json({ result });
  }),
);

instagramRouter.delete(
  "/instagram/reels/:mediaId",
  asyncHandler(async (_req, _res) => {
    throw new AppError(
      "Instagram Graph API does not support deleting published media. Delete the live Reel manually in Instagram, or delete the local reel from this workspace.",
      501,
    );
  }),
);
