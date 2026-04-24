export interface ScriptParams {
  topic: string;
  style: string;
  language: string;
  tone: string;
  duration: number;
}

export interface ReelScriptScene {
  sceneNumber: number;
  visual: string;
  text: string;
  spokenText: string;
}

export interface ReelScriptResult {
  title: string;
  script: string;
  scenes: ReelScriptScene[];
  pexelsKeywords: string[];
}

export async function generateReelScript(params: ScriptParams) {
  const response = await fetch("/api/generate-script", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    let message = "Something went wrong. Please try again.";

    try {
      const data = await response.json();
      if (typeof data?.error === "string" && data.error.trim()) {
        message = data.error;
      }
    } catch {
      // Fall back to the generic message if the server response is not JSON.
    }

    throw new Error(message);
  }

  return (await response.json()) as ReelScriptResult;
}
