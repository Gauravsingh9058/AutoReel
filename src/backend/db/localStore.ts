import fs from "fs/promises";
import path from "path";
import { env } from "../config/env";
import { LocalDatabaseShape } from "../types";

const localDatabaseFile = path.join(env.dataDir, "local-db.json");

const EMPTY_STORE: LocalDatabaseShape = {
  users: [],
  projects: [],
  scripts: [],
  videos: [],
  usage: [],
};

export async function readLocalStore() {
  try {
    const raw = await fs.readFile(localDatabaseFile, "utf8");
    return JSON.parse(raw) as LocalDatabaseShape;
  } catch {
    return EMPTY_STORE;
  }
}

export async function writeLocalStore(nextValue: LocalDatabaseShape) {
  await fs.mkdir(env.dataDir, { recursive: true });
  await fs.writeFile(localDatabaseFile, JSON.stringify(nextValue, null, 2), "utf8");
}
