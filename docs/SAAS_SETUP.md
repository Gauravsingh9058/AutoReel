# VidSnapAI SaaS Setup

## Backend Structure

```text
server.ts
src/
  App.tsx
  services/
    geminiService.ts
    saasApi.ts
  backend/
    config/
      env.ts
    db/
      localStore.ts
      postgres.ts
      migrations/
        001_init.sql
    lib/
      asyncHandler.ts
      errors.ts
      filesystem.ts
    middleware/
      errorHandler.ts
      rateLimiters.ts
    queue/
      videoQueue.ts
      worker.ts
    repositories/
      appRepository.ts
    routes/
      instagramRoutes.ts
      mediaRoutes.ts
      projectRoutes.ts
      scriptRoutes.ts
    services/
      geminiService.ts
      instagramService.ts
      pexelsService.ts
      storageService.ts
      ttsService.ts
      usageService.ts
      videoPipeline.ts
```

## FFmpeg Commands

Generate scene clips:

```bash
ffmpeg -y -loop 1 -i scene.jpg -t 5 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,drawtext=text='Hook':x=(w-text_w)/2:y=h-260" -r 30 scene-1.mp4
```

Concatenate clips:

```bash
ffmpeg -y -f concat -safe 0 -i clips.txt -c:v libx264 -pix_fmt yuv420p stitched.mp4
```

Burn subtitles and mix audio:

```bash
ffmpeg -y -i stitched.mp4 -i voiceover.mp3 -i music.mp3 -filter_complex "[2:a]volume=0.18[music];[1:a][music]amix=inputs=2:duration=longest[aout]" -vf "subtitles=captions.srt" -map 0:v -map "[aout]" -shortest final.mp4
```

## Local Infra

1. Copy `.env.example` to `.env.local`.
2. Fill `GEMINI_API_KEY` and `PEXELS_API_KEY`.
3. Install FFmpeg and ensure `ffmpeg` and `ffprobe` are on `PATH`.
4. Run PostgreSQL and Redis for production-grade mode.
5. Apply `src/backend/db/migrations/001_init.sql` to PostgreSQL.
6. Start the app with `npm run dev`.
7. Start the async worker with `npm run worker` when `REDIS_URL` is configured.

## Render / Vercel / VPS

### Render

1. Create a Web Service from this repo.
2. Build command: `npm install && npm run build`
3. Start command: `npm run dev`
4. Add environment variables from `.env.example`.
5. Attach PostgreSQL and Redis services.
6. Add persistent disk storage if you keep local renders instead of S3/Cloudinary.

### Vercel

1. Deploy the React frontend on Vercel.
2. Deploy the Node backend separately on Render, Railway, Fly.io, or a VPS.
3. Point the frontend API calls to the backend domain through a rewrite or environment variable.
4. Keep FFmpeg on the backend host only.

### VPS

1. Install Node.js 22+, FFmpeg, PostgreSQL, and Redis.
2. Clone the repo and run `npm install`.
3. Apply the SQL migration.
4. Run `npm run build`.
5. Use PM2 or systemd:
   - `pm2 start npm --name vidsnapai-api -- run dev`
   - `pm2 start npm --name vidsnapai-worker -- run worker`
6. Reverse proxy with Nginx to `127.0.0.1:4173`.

## Free Voiceover

1. The reel pipeline now uses a free Google-based TTS path through `google-tts-api`.
2. No ElevenLabs account or API key is required.
3. Voiceover is generated server-side, chunked into MP3 pieces, and concatenated with FFmpeg.
4. The final reel mixes the generated speech with optional uploaded or default background music.

## Instagram

1. Create a Meta app with Instagram Graph API enabled.
2. Configure `META_APP_ID`, `META_APP_SECRET`, and `META_REDIRECT_URI`.
3. Use `/api/instagram/connect-url` to start the OAuth flow.
4. Exchange the returned code with `/api/instagram/exchange-code`.
5. Or connect a real account token with `/api/instagram/connect-token` by sending `accessToken` and, optionally, `instagramAccountId`.
6. For direct publish mode, set `META_ACCESS_TOKEN` and `META_IG_USER_ID` in the server environment.
7. Set `APP_URL` or `STORAGE_BASE_URL` to the public HTTPS domain where rendered MP4 files are available.
8. Publish a reel with `/api/instagram/publish`.

The publish flow uses the Instagram Graph API `/<IG_USER_ID>/media` endpoint with `media_type=REELS`, waits for the media container to finish, then calls `/<IG_USER_ID>/media_publish`.

## API Surface

- `POST /api/generate-script`
- `POST /api/fetch-media`
- `POST /api/upload-assets`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `POST /api/generate-video`
- `GET /api/jobs/:jobId`
- `POST /api/projects/:projectId/regenerate`
- `GET /api/instagram/connect-url`
- `POST /api/instagram/connect-token`
- `POST /api/instagram/exchange-code`
- `POST /api/instagram/publish`
