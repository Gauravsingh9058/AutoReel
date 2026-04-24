import { env } from "../config/env";
import { ConfigError } from "../lib/errors";

const graphBase = `https://graph.facebook.com/${env.metaGraphVersion}`;

interface MetaErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
  };
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface PageAccount {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: {
    id: string;
    username?: string;
  };
}

interface ContainerStatus {
  id: string;
  status_code?: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";
  status?: string;
}

async function parseGraphResponse<T>(response: Response, fallbackMessage: string) {
  const data = (await response.json().catch(() => ({}))) as T & MetaErrorResponse;
  if (!response.ok) {
    const graphMessage = data.error?.error_user_msg || data.error?.message;
    const code = data.error?.code ? ` (code ${data.error.code})` : "";
    throw new Error(`${graphMessage || fallbackMessage}${code}`);
  }
  return data;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function assertMetaOAuthConfig() {
  if (!env.metaAppId || !env.metaAppSecret || !env.metaRedirectUri) {
    throw new ConfigError("META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI are required for Instagram connect.");
  }
}

export function getInstagramOAuthUrl() {
  if (!env.metaAppId || !env.metaRedirectUri) {
    throw new ConfigError("META_APP_ID and META_REDIRECT_URI are required for Instagram connect.");
  }

  const params = new URLSearchParams({
    client_id: env.metaAppId,
    redirect_uri: env.metaRedirectUri,
    scope: env.metaOAuthScopes,
    response_type: "code",
  });

  return `https://www.facebook.com/${env.metaGraphVersion}/dialog/oauth?${params.toString()}`;
}

export async function exchangeInstagramCode(code: string) {
  assertMetaOAuthConfig();

  const params = new URLSearchParams({
    client_id: env.metaAppId,
    client_secret: env.metaAppSecret,
    redirect_uri: env.metaRedirectUri,
    code,
  });

  const response = await fetch(`${graphBase}/oauth/access_token?${params.toString()}`);
  return parseGraphResponse<TokenResponse>(response, "Meta token exchange failed.");
}

export async function exchangeLongLivedToken(accessToken: string) {
  assertMetaOAuthConfig();

  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: env.metaAppId,
    client_secret: env.metaAppSecret,
    fb_exchange_token: accessToken,
  });

  const response = await fetch(`${graphBase}/oauth/access_token?${params.toString()}`);
  return parseGraphResponse<TokenResponse>(response, "Meta long-lived token exchange failed.");
}

export async function discoverInstagramBusinessAccount(accessToken: string) {
  const params = new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: accessToken,
  });

  const response = await fetch(`${graphBase}/me/accounts?${params.toString()}`);
  const result = await parseGraphResponse<{ data?: PageAccount[] }>(
    response,
    "Unable to discover Facebook Pages linked to Instagram.",
  );
  const connectedPage = result.data?.find((page) => page.instagram_business_account?.id);

  if (!connectedPage?.instagram_business_account) {
    throw new Error("No Instagram Business or Creator account found. Link your Instagram account to a Facebook Page first.");
  }

  return {
    pageId: connectedPage.id,
    pageName: connectedPage.name || "Facebook Page",
    instagramAccountId: connectedPage.instagram_business_account.id,
    instagramUsername: connectedPage.instagram_business_account.username || "",
    accessToken: connectedPage.access_token || accessToken,
  };
}

export async function connectInstagramAccountFromCode(code: string) {
  const shortLivedToken = await exchangeInstagramCode(code);
  const longLivedToken = await exchangeLongLivedToken(shortLivedToken.access_token).catch(() => shortLivedToken);
  return discoverInstagramBusinessAccount(longLivedToken.access_token);
}

export async function connectInstagramAccountFromAccessToken(input: {
  accessToken: string;
  instagramAccountId?: string;
}) {
  const tokenData = await exchangeLongLivedToken(input.accessToken).catch(() => ({
    access_token: input.accessToken,
  }));

  if (input.instagramAccountId) {
    return {
      instagramAccountId: input.instagramAccountId,
      instagramUsername: "",
      accessToken: tokenData.access_token,
    };
  }

  return discoverInstagramBusinessAccount(tokenData.access_token);
}

async function getContainerStatus(containerId: string, accessToken: string) {
  const params = new URLSearchParams({
    fields: "status_code,status",
    access_token: accessToken,
  });

  const response = await fetch(`${graphBase}/${containerId}?${params.toString()}`);
  return parseGraphResponse<ContainerStatus>(response, "Unable to check Instagram media container status.");
}

async function waitForContainer(containerId: string, accessToken: string) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const status = await getContainerStatus(containerId, accessToken);
    if (status.status_code === "FINISHED" || status.status_code === "PUBLISHED") {
      return status;
    }
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(`Instagram media container is ${status.status_code.toLowerCase()}: ${status.status || "processing failed"}`);
    }
    await wait(5000);
  }

  throw new Error("Instagram is still processing this Reel. Try publishing again in a minute.");
}

export async function publishInstagramReel(input: {
  accessToken: string;
  instagramAccountId: string;
  videoUrl: string;
  caption: string;
}) {
  const createBody = new URLSearchParams({
    media_type: "REELS",
    video_url: input.videoUrl,
    caption: input.caption,
    share_to_feed: "true",
    access_token: input.accessToken,
  });

  const createContainer = await fetch(`${graphBase}/${input.instagramAccountId}/media`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: createBody,
  });

  const container = await parseGraphResponse<{ id: string }>(createContainer, "Meta media container creation failed.");
  const status = await waitForContainer(container.id, input.accessToken);

  const publishBody = new URLSearchParams({
    creation_id: container.id,
    access_token: input.accessToken,
  });

  const publish = await fetch(`${graphBase}/${input.instagramAccountId}/media_publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: publishBody,
  });

  const published = await parseGraphResponse<{ id: string }>(publish, "Meta publish failed.");

  return {
    containerId: container.id,
    containerStatus: status.status_code,
    mediaId: published.id,
  };
}
