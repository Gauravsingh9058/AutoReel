import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: ".env.local" });
dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  appUrl: process.env.APP_URL || "http://127.0.0.1:4173",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  pexelsApiKey: process.env.PEXELS_API_KEY || "",
  usePostgres: process.env.USE_POSTGRES === "true",
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
  storageMode: process.env.STORAGE_MODE || "local",
  storageBaseUrl: process.env.STORAGE_BASE_URL || "",
  uploadsDir: process.env.UPLOADS_DIR || path.join(process.cwd(), "storage", "uploads"),
  generatedDir: process.env.GENERATED_DIR || path.join(process.cwd(), "storage", "generated"),
  mediaCacheDir: process.env.MEDIA_CACHE_DIR || path.join(process.cwd(), "storage", "media-cache"),
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), "storage", "data"),
  defaultMusicPath: process.env.DEFAULT_BACKGROUND_MUSIC_PATH || "",
  enforceReelLimits: process.env.ENFORCE_REEL_LIMITS === "true",
  unlimitedReelGeneration: process.env.UNLIMITED_REEL_GENERATION !== "false",
  freeReelLimit: Number(process.env.FREE_REEL_LIMIT || 5),
  proReelLimit: Number(process.env.PRO_REEL_LIMIT || 500),
  metaGraphVersion: process.env.META_GRAPH_VERSION || "v24.0",
  metaAppId: process.env.META_APP_ID || "",
  metaAppSecret: process.env.META_APP_SECRET || "",
  metaRedirectUri: process.env.META_REDIRECT_URI || "",
  metaOAuthScopes:
    process.env.META_OAUTH_SCOPES ||
    "pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish,business_management",
  metaAccessToken: process.env.META_ACCESS_TOKEN || "",
  metaInstagramAccountId: process.env.META_IG_USER_ID || "",
};
