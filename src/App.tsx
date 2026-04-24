/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { startTransition, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Film,
  ImageIcon,
  Instagram,
  Languages,
  Loader2,
  Monitor,
  Music,
  Sparkles,
  Trash2,
  Type as FontType,
  Upload,
  Video,
  Volume2,
  WandSparkles,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { generateReelScript, ReelScriptResult } from "./services/geminiService";
import {
  GalleryItem,
  JobRecord,
  ProjectRecord,
  UsageSummary,
  WorkspaceSummary,
  createProject,
  deleteProject,
  generateVideo,
  getJob,
  loadDashboard,
  publishInstagramProject,
  uploadAssets,
} from "./services/saasApi";

const STYLES = ["Viral", "Educational", "Storytelling", "Motivational", "Promotional"];
const LANGUAGES = ["English", "Hindi", "Hinglish"];
const TONES = ["Professional", "Casual", "Energetic", "Bold"];
const DURATIONS = [15, 30, 45, 60];
const CAPTION_STYLES = ["bold", "clean", "emoji"];

const PIPELINE_STEPS = [
  { title: "Script Analysis", threshold: 10, icon: Sparkles },
  { title: "Media Fetching", threshold: 35, icon: ImageIcon },
  { title: "Voiceover Build", threshold: 60, icon: Volume2 },
  { title: "Caption Burn-In", threshold: 80, icon: FontType },
  { title: "Render & Mix", threshold: 95, icon: Music },
];

function buildManualScriptResult(script: string, title: string): ReelScriptResult {
  const scenes = script
    .split(/\n+/)
    .filter(Boolean)
    .map((line, index) => ({
      sceneNumber: index + 1,
      visual: line,
      text: line,
      spokenText: line,
    }));

  return {
    title: title || "Draft Video",
    script,
    scenes,
    pexelsKeywords: [],
  };
}

export default function App() {
  const [formData, setFormData] = useState({
    title: "",
    topic: "",
    script: "",
    useAiScript: true,
    scriptStyle: "Viral",
    scriptLanguage: "English",
    scriptTone: "Energetic",
    targetDuration: 30,
    useStockImages: true,
    enableVoiceover: true,
    captionStyle: "bold",
  });
  const [generatedData, setGeneratedData] = useState<ReelScriptResult | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploadedPaths, setUploadedPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isScriptLoading, setIsScriptLoading] = useState(false);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [publishingProjectId, setPublishingProjectId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  const progress = job?.progress || 0;
  const isUnlimitedUsage = (usage?.monthlyReelLimit ?? 0) < 0;
  const reelsRemaining = usage ? (isUnlimitedUsage ? "Unlimited" : Math.max(usage.monthlyReelLimit - usage.reelsUsed, 0)) : 0;
  const canGenerateVideo = Boolean(generatedData || formData.script.trim());

  useEffect(() => {
    void hydrateDashboard();
  }, []);

  useEffect(() => {
    if (!job || !["queued", "processing"].includes(job.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void getJob(job.id)
        .then((nextJob) => {
          startTransition(() => {
            setJob(nextJob);
            if (nextJob.outputUrl) {
              setPreviewUrl(nextJob.outputUrl);
            }
          });

          if (nextJob.status === "completed") {
            setIsVideoLoading(false);
            setSuccessMessage("Your reel is ready with captions and free voiceover audio.");
            void hydrateDashboard();
            window.clearInterval(interval);
          }

          if (nextJob.status === "failed") {
            setIsVideoLoading(false);
            setError(nextJob.errorMessage || "Video generation failed.");
            window.clearInterval(interval);
          }
        })
        .catch((pollError) => {
          setError(pollError instanceof Error ? pollError.message : "Polling failed.");
          setIsVideoLoading(false);
          window.clearInterval(interval);
        });
    }, 2500);

    return () => window.clearInterval(interval);
  }, [job]);

  const pipelineRows = PIPELINE_STEPS.map((step) => ({
    ...step,
    complete: progress >= step.threshold,
  }));

  async function hydrateDashboard() {
    try {
      const dashboard = await loadDashboard();

      startTransition(() => {
        setWorkspace(dashboard.workspace);
        setProjects(dashboard.projects);
        setGallery(dashboard.gallery);
        setUsage(dashboard.usage);
      });
    } catch (dashboardError) {
      setError(dashboardError instanceof Error ? dashboardError.message : "Unable to load workspace.");
    }
  }

  async function handleGenerateScript(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsScriptLoading(true);

    try {
      if (formData.useAiScript) {
        if (!formData.topic.trim()) {
          throw new Error("Please enter a topic to generate a script.");
        }

        const result = await generateReelScript({
          topic: formData.topic,
          style: formData.scriptStyle,
          language: formData.scriptLanguage,
          tone: formData.scriptTone,
          duration: formData.targetDuration,
        });

        startTransition(() => {
          setGeneratedData(result);
          setFormData((previous) => ({
            ...previous,
            script: result.script,
            title: previous.title || result.title,
          }));
        });
        setSuccessMessage("Script generated. VidSnapAI is ready to turn it into a reel.");
      } else {
        if (!formData.script.trim()) {
          throw new Error("Please paste your script before rendering the reel.");
        }

        const manualResult = buildManualScriptResult(formData.script, formData.title);
        setGeneratedData(manualResult);
        setSuccessMessage("Manual script prepared. You can render the reel now.");
      }
    } catch (scriptError) {
      setError(scriptError instanceof Error ? scriptError.message : "Something went wrong.");
    } finally {
      setIsScriptLoading(false);
    }
  }

  async function handleAssetSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files || []) as File[];
    setUploadedFiles(nextFiles);
    if (!nextFiles.length) {
      setUploadedPaths([]);
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      const response = await uploadAssets(nextFiles);
      setUploadedPaths(response.files.map((file) => file.absolutePath));
      setSuccessMessage(`${response.files.length} asset(s) uploaded to your workspace.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleGenerateVideo() {
    setError(null);
    setSuccessMessage(null);

    const scriptPayload = generatedData || buildManualScriptResult(formData.script, formData.title);
    if (!scriptPayload.script.trim()) {
      setError("Generate or paste a script before rendering the video.");
      return;
    }

    setIsVideoLoading(true);

    try {
      let projectId = activeProjectId;
      if (!projectId) {
        const project = await createProject({
          title: formData.title || scriptPayload.title,
          topic: formData.topic || scriptPayload.title,
          style: formData.scriptStyle,
          language: formData.scriptLanguage,
          tone: formData.scriptTone,
          duration: formData.targetDuration,
        });
        projectId = project.id;
        setActiveProjectId(project.id);
      }

      const response = await generateVideo({
        projectId: projectId || undefined,
        title: formData.title || scriptPayload.title,
        topic: formData.topic || scriptPayload.title,
        style: formData.scriptStyle,
        tone: formData.scriptTone,
        language: formData.scriptLanguage,
        targetDuration: formData.targetDuration,
        script: scriptPayload,
        captionStyle: formData.captionStyle,
        useStockMedia: formData.useStockImages,
        enableVoiceover: formData.enableVoiceover,
        uploadedAssetPaths: uploadedPaths,
      });

      setJob(response.job);
      setActiveProjectId(response.project.id);
      if (response.video.previewUrl) {
        setPreviewUrl(response.video.previewUrl);
      }
      setSuccessMessage("Render started. VidSnapAI is building your reel.");
      await hydrateDashboard();
    } catch (videoError) {
      setError(videoError instanceof Error ? videoError.message : "Video generation failed.");
      setIsVideoLoading(false);
    }
  }

  async function handlePublishToInstagram(item: GalleryItem) {
    setError(null);
    setSuccessMessage(null);

    if (!workspace?.instagramConnected) {
      setError("Set META_ACCESS_TOKEN and META_IG_USER_ID in .env.local before publishing.");
      return;
    }

    const defaultCaption = `${item.project.title}\n\n${item.project.topic}\n\n#reels #vidsnapai`;
    const caption = window.prompt("Instagram Reel caption", defaultCaption);
    if (!caption?.trim()) {
      return;
    }

    setPublishingProjectId(item.project.id);
    try {
      const response = await publishInstagramProject(item.project.id, caption.trim());
      setSuccessMessage(`Reel published to Instagram. Media ID: ${response.result.mediaId}`);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Instagram publish failed.");
    } finally {
      setPublishingProjectId(null);
    }
  }

  async function handleDeleteReel(item: GalleryItem) {
    setError(null);
    setSuccessMessage(null);

    const confirmed = window.confirm("Delete this saved reel from the workspace? Published Instagram posts must be removed in Instagram.");
    if (!confirmed) {
      return;
    }

    setDeletingProjectId(item.project.id);
    try {
      await deleteProject(item.project.id);
      if (activeProjectId === item.project.id) {
        setActiveProjectId(null);
      }
      if (previewUrl === item.video.previewUrl) {
        setPreviewUrl(null);
      }
      setSuccessMessage("Saved reel deleted from this workspace.");
      await hydrateDashboard();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete reel.");
    } finally {
      setDeletingProjectId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#E4E3E0] font-sans selection:bg-orange-500/30 selection:text-orange-200">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-orange-600/10 blur-[120px] animate-pulse" />
        <div
          className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-600/10 blur-[120px] animate-pulse"
          style={{ animationDelay: "2s" }}
        />
      </div>

      <header className="relative z-10 border-b border-white/10 backdrop-blur-md bg-black/50 sticky top-0">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 group">
            <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center p-1.5 shadow-[0_0_15px_rgba(234,88,12,0.4)] transition-transform group-hover:scale-110">
              <Video className="text-white fill-current" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                VidSnap<span className="text-orange-500">AI</span>
              </h1>
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/30">One Workspace Reel Engine</div>
            </div>
          </div>

          <div className="text-[10px] uppercase tracking-[0.25em] text-white/40">
            {workspace ? workspace.name : "Loading Workspace"}
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12 lg:grid lg:grid-cols-[1fr_420px] gap-12">
        <section className="space-y-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <h2 className="text-4xl lg:text-6xl font-bold tracking-tighter leading-[0.9]">
              TOPIC TO <span className="italic text-orange-500">VOICEOVER REEL</span>
            </h2>
            <p className="text-white/60 max-w-2xl text-lg">
              Generate a script, fetch visuals, create a free AI voice track, burn captions, preview the finished reel, and download or publish it.
            </p>
          </motion.div>

          <form onSubmit={handleGenerateScript} className="space-y-8">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-40 flex items-center gap-2">
                  <FontType size={12} className="text-orange-500" /> Project Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. My Viral Fitness Reel"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-orange-500/50 transition-colors placeholder:text-white/20"
                  value={formData.title}
                  onChange={(event) => setFormData((previous) => ({ ...previous, title: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-40 flex items-center gap-2">
                  <Zap size={12} className="text-orange-500" /> Topic / Concept
                </label>
                <input
                  type="text"
                  placeholder="e.g. 5 Morning Habits for High Productivity"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-orange-500/50 transition-colors placeholder:text-white/20"
                  value={formData.topic}
                  onChange={(event) => setFormData((previous) => ({ ...previous, topic: event.target.value }))}
                />
              </div>
            </div>

            <div className="p-6 bg-white/[0.02] border border-white/10 rounded-2xl space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-500/20 rounded-xl flex items-center justify-center border border-orange-500/30">
                    <Sparkles className="text-orange-500" size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold">AI Script Generator</h3>
                    <p className="text-[10px] uppercase tracking-wider text-white/40">Gemini on the backend, no keys in the browser</p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={formData.useAiScript}
                    onChange={(event) => setFormData((previous) => ({ ...previous, useAiScript: event.target.checked }))}
                  />
                  <div className="w-11 h-6 bg-white/10 rounded-full peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600" />
                </label>
              </div>

              {formData.useAiScript ? (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-40">Style</label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-sm appearance-none cursor-pointer focus:border-orange-500/50"
                      value={formData.scriptStyle}
                      onChange={(event) => setFormData((previous) => ({ ...previous, scriptStyle: event.target.value }))}
                    >
                      {STYLES.map((style) => (
                        <option key={style} value={style}>
                          {style}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-1">
                      <Languages size={10} /> Language
                    </label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-sm appearance-none cursor-pointer focus:border-orange-500/50"
                      value={formData.scriptLanguage}
                      onChange={(event) => setFormData((previous) => ({ ...previous, scriptLanguage: event.target.value }))}
                    >
                      {LANGUAGES.map((language) => (
                        <option key={language} value={language}>
                          {language}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-1">
                      <Music size={10} /> Tone
                    </label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-sm appearance-none cursor-pointer focus:border-orange-500/50"
                      value={formData.scriptTone}
                      onChange={(event) => setFormData((previous) => ({ ...previous, scriptTone: event.target.value }))}
                    >
                      {TONES.map((tone) => (
                        <option key={tone} value={tone}>
                          {tone}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-1">
                      <Clock size={10} /> Duration
                    </label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-sm appearance-none cursor-pointer focus:border-orange-500/50"
                      value={formData.targetDuration}
                      onChange={(event) =>
                        setFormData((previous) => ({ ...previous, targetDuration: Number(event.target.value) }))
                      }
                    >
                      {DURATIONS.map((duration) => (
                        <option key={duration} value={duration}>
                          {duration}s
                        </option>
                      ))}
                    </select>
                  </div>
                </motion.div>
              ) : (
                <div className="text-white/40 text-xs italic flex items-center gap-2">
                  <AlertCircle size={14} /> AI generation disabled. Paste your script manually and continue to rendering.
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-40">Final Script Output</label>
                  {generatedData && <span className="text-[10px] text-orange-500 font-bold uppercase tracking-widest">Ready for reel render</span>}
                </div>
                <textarea
                  rows={8}
                  placeholder="The script will appear here after generation..."
                  className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-4 focus:outline-none focus:border-orange-500/30 transition-colors font-mono text-sm leading-relaxed"
                  value={formData.script}
                  onChange={(event) => setFormData((previous) => ({ ...previous, script: event.target.value }))}
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8 ring-1 ring-white/10 p-6 rounded-2xl bg-white/[0.01]">
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-widest opacity-60 border-b border-orange-500/20 pb-2 flex items-center gap-2">
                  <ImageIcon size={14} className="text-orange-500" /> Media Settings
                </h4>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Use Source Stock Media (Pexels)</span>
                  <input
                    type="checkbox"
                    className="accent-orange-500"
                    checked={formData.useStockImages}
                    onChange={(event) => setFormData((previous) => ({ ...previous, useStockImages: event.target.checked }))}
                  />
                </div>
                <div className="text-[11px] text-white/35">
                  If Pexels is not configured, VidSnapAI will fall back to built-in scene visuals or your uploaded assets.
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Free Script-to-Audio Voiceover</span>
                  <input
                    type="checkbox"
                    className="accent-orange-500"
                    checked={formData.enableVoiceover}
                    onChange={(event) => setFormData((previous) => ({ ...previous, enableVoiceover: event.target.checked }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-40">Caption Style</label>
                  <select
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
                    value={formData.captionStyle}
                    onChange={(event) => setFormData((previous) => ({ ...previous, captionStyle: event.target.value }))}
                  >
                    {CAPTION_STYLES.map((style) => (
                      <option key={style} value={style}>
                        {style}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-widest opacity-60 border-b border-orange-500/20 pb-2 flex items-center gap-2">
                  <Upload size={14} className="text-orange-500" /> Source Assets
                </h4>
                <label className="block p-4 bg-white/5 border border-dashed border-white/20 rounded-lg text-center cursor-pointer hover:bg-white/10 transition-colors">
                  <input type="file" multiple accept="image/*,video/*,audio/*" className="hidden" onChange={handleAssetSelection} />
                  <div className="space-y-2">
                    <Film size={18} className="mx-auto opacity-60" />
                    <div className="text-sm font-medium">Upload your own media or music</div>
                    <div className="text-[11px] uppercase tracking-[0.2em] opacity-35">
                      {isUploading ? "Uploading..." : uploadedFiles.length ? `${uploadedFiles.length} file(s) selected` : "Optional"}
                    </div>
                  </div>
                </label>
                {uploadedFiles.length > 0 && (
                  <div className="text-xs text-white/45 space-y-1">
                    {uploadedFiles.map((file) => (
                      <div key={file.name}>{file.name}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className="md:col-span-2 grid md:grid-cols-2 gap-4 pt-4">
                <button
                  type="submit"
                  disabled={isScriptLoading}
                  className="w-full h-14 bg-white text-black font-bold uppercase tracking-widest rounded-xl hover:bg-orange-500 hover:text-white transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center justify-center gap-2">
                    {isScriptLoading ? (
                      <>
                        <Loader2 className="animate-spin" size={20} />
                        Generating Script
                      </>
                    ) : (
                      <>
                        Generate Script <ChevronRight size={20} />
                      </>
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={!canGenerateVideo || isVideoLoading}
                  onClick={handleGenerateVideo}
                  className="w-full h-14 bg-orange-500 text-white font-bold uppercase tracking-widest rounded-xl hover:bg-orange-400 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center justify-center gap-2">
                    {isVideoLoading ? (
                      <>
                        <Loader2 className="animate-spin" size={20} />
                        Rendering Reel
                      </>
                    ) : (
                      <>
                        Generate Reel <WandSparkles size={20} />
                      </>
                    )}
                  </span>
                </button>
              </div>
            </div>

            {error && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400 text-sm">
                <AlertCircle size={20} />
                {error}
              </motion.div>
            )}

            {successMessage && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3 text-emerald-300 text-sm">
                <CheckCircle2 size={20} />
                {successMessage}
              </motion.div>
            )}
          </form>
        </section>

        <aside className="space-y-6">
          <div className="p-6 bg-white/[0.03] border border-white/10 rounded-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-orange-500 mb-2">Workspace</div>
                <h3 className="text-2xl font-semibold">{workspace?.name || "Local Workspace"}</h3>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">Voiceover</div>
                <div className="text-sm font-bold uppercase">Free TTS</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-black/30 border border-white/5">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">Reels Used</div>
                <div className="text-2xl font-semibold">{usage?.reelsUsed ?? 0}</div>
              </div>
              <div className="p-4 rounded-xl bg-black/30 border border-white/5">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">Remaining</div>
                <div className="text-2xl font-semibold">{reelsRemaining}</div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-white/35">
                <span>Workspace Usage</span>
                <span>{isUnlimitedUsage ? "Unlimited" : `${usage?.reelsUsed ?? 0}/${usage?.monthlyReelLimit ?? 0}`}</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-orange-300"
                  style={{
                    width: isUnlimitedUsage
                      ? "100%"
                      : `${Math.min(100, ((usage?.reelsUsed ?? 0) / Math.max(usage?.monthlyReelLimit ?? 1, 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>

            <div className="space-y-3 border-t border-white/10 pt-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-white/55">
                  <Instagram size={14} className="text-orange-500" />
                  Instagram Backend
                </div>
                <div
                  className={`text-[10px] font-bold uppercase tracking-[0.2em] ${
                    workspace?.instagramConnected ? "text-emerald-300" : "text-white/35"
                  }`}
                >
                  {workspace?.instagramConnected ? "Connected" : "Not Connected"}
                </div>
              </div>
              <div className="rounded-lg border border-white/8 bg-black/25 p-3 text-[11px] leading-relaxed text-white/45">
                Publishing uses the Instagram account configured in backend environment variables only.
              </div>
            </div>
          </div>

          <div className="p-6 bg-white/[0.03] border border-white/10 rounded-2xl">
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] mb-6 opacity-60">Preview Pipeline</h3>
            <div className="space-y-5">
              {pipelineRows.map((step) => (
                <div key={step.title} className={`flex items-center gap-4 ${step.complete ? "opacity-100" : "opacity-50"}`}>
                  <div className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 ${step.complete ? "border-orange-500 text-orange-400" : "border-white/20"}`}>
                    <step.icon size={14} />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-semibold">{step.title}</div>
                    <div className="text-[10px] opacity-40 uppercase tracking-widest">
                      {step.complete ? "Complete" : job?.message || "Waiting for process"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] opacity-40 mb-2">
                <span>Render Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-orange-500 to-orange-300 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>

          <div className="p-6 bg-[#0B0C10] border border-white/10 rounded-2xl aspect-[9/16] relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(234,88,12,0.12),transparent)]" />
            {previewUrl ? (
              <div className="relative z-10 h-full flex flex-col gap-4">
                <div className="text-xs font-bold uppercase tracking-[0.2em] opacity-50">Live Preview</div>
                <video src={previewUrl} controls className="w-full h-full object-cover rounded-xl bg-black/40" />
                <a
                  href={previewUrl}
                  download
                  className="inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-white text-black font-bold uppercase tracking-[0.2em] hover:bg-orange-500 hover:text-white transition-colors"
                >
                  Download Reel
                </a>
              </div>
            ) : (
              <div className="relative z-10 w-full h-full text-center space-y-4 px-8 flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 mx-auto flex items-center justify-center">
                  <Monitor className="text-white/20" size={32} />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-bold uppercase tracking-widest opacity-40">Live Preview</div>
                  <div className="text-[10px] opacity-20">Your rendered vertical reel with audio will appear here</div>
                </div>
              </div>
            )}
          </div>

          <div className="p-6 bg-white/[0.03] border border-white/10 rounded-2xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] opacity-60">
                <Film size={14} className="text-orange-500" />
                Reel Gallery
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">{gallery.length} saved</div>
            </div>

            {gallery.length ? (
              <div className="grid grid-cols-2 gap-3">
                {gallery.slice(0, 6).map((item) => (
                  <div key={item.video.id} className="rounded-xl border border-white/8 bg-black/25 p-2 space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProjectId(item.project.id);
                        setPreviewUrl(item.video.previewUrl);
                      }}
                      className="group w-full text-left space-y-2"
                    >
                      <div className="aspect-[9/16] overflow-hidden rounded-lg border border-white/10 bg-black/50">
                        <video
                          src={item.video.previewUrl}
                          muted
                          preload="metadata"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      </div>
                      <div>
                        <div className="truncate text-xs font-semibold">{item.project.title}</div>
                        <div className="mt-1 truncate text-[10px] uppercase tracking-[0.16em] text-white/35">{item.project.topic}</div>
                      </div>
                    </button>
                    <a
                      href={item.video.previewUrl}
                      download
                      className="flex h-8 items-center justify-center gap-2 rounded-lg bg-white/8 text-[10px] font-bold uppercase tracking-[0.18em] text-white/70 transition-colors hover:bg-orange-500 hover:text-white"
                    >
                      <Download size={12} />
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={() => void handlePublishToInstagram(item)}
                      disabled={publishingProjectId === item.project.id}
                      className="flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-orange-500/15 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-300 transition-colors hover:bg-orange-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {publishingProjectId === item.project.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Instagram size={12} />
                      )}
                      Post
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteReel(item)}
                      disabled={deletingProjectId === item.project.id}
                      className="flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-red-500/10 text-[10px] font-bold uppercase tracking-[0.18em] text-red-300 transition-colors hover:bg-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingProjectId === item.project.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-white/40">
                Completed reels will appear here automatically after rendering finishes.
              </div>
            )}
          </div>

          <div className="p-6 bg-white/[0.03] border border-white/10 rounded-2xl space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] opacity-60">
              <Film size={14} className="text-orange-500" />
              Recent Projects
            </div>
            {projects.length ? (
              <div className="space-y-3">
                {projects.slice(0, 5).map((project) => (
                  <button
                    key={project.id}
                    onClick={() => setActiveProjectId(project.id)}
                    className={`w-full text-left p-4 rounded-xl border transition-colors ${
                      activeProjectId === project.id ? "border-orange-500/50 bg-orange-500/10" : "border-white/8 bg-black/20 hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{project.title}</div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/35 mt-1">{project.topic}</div>
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-orange-400">{project.status}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-sm text-white/40">No saved reel projects yet. Your first generated reel will appear here.</div>
            )}
          </div>
        </aside>
      </main>

      <footer className="relative z-10 border-t border-white/10 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2 opacity-40 underline-offset-4 decoration-orange-500 hover:opacity-100 transition-opacity">
            <CheckCircle2 size={16} />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Verified Automation Engine</span>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.4em] opacity-20">© 2026 VIDSNAPAI STUDIO</div>
        </div>
      </footer>
    </div>
  );
}
