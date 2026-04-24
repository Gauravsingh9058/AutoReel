import dotenv from "dotenv";
import { ensureStorageDirectories } from "../lib/filesystem";
import { startVideoWorker } from "./videoQueue";

dotenv.config({ path: ".env.local" });
dotenv.config();

await ensureStorageDirectories();
startVideoWorker();

console.log("VidSnapAI worker is listening for video jobs.");
