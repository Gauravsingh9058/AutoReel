import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { getUsageSummary } from "../repositories/appRepository";
import { UserRecord } from "../types";

export async function assertUsageAvailable(user: UserRecord) {
  const summary = await getUsageSummary(user.id);
  const limit = user.plan === "pro" ? env.proReelLimit : env.freeReelLimit;

  if (!env.enforceReelLimits || env.unlimitedReelGeneration || limit < 0) {
    return {
      currentPlan: user.plan,
      reelsUsed: summary.reelsUsed,
      monthlyReelLimit: -1,
    };
  }

  if (summary.reelsUsed >= limit) {
    throw new AppError("Workspace reel limit reached for this month.", 402, {
      currentPlan: user.plan,
      reelsUsed: summary.reelsUsed,
      monthlyReelLimit: limit,
    });
  }

  return {
    currentPlan: user.plan,
    reelsUsed: summary.reelsUsed,
    monthlyReelLimit: limit,
  };
}
