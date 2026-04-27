import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

type HomeConfigFile = {
  navigaBatchId?: number | string | null;
};

function getHomeConfigPath(rootDir: string): string {
  return path.join(rootDir, "workflow", "business-rules", "home-config.yml");
}

export async function loadHomeConfigBatchId(rootDir: string): Promise<string | null> {
  try {
    const raw = await readFile(getHomeConfigPath(rootDir), "utf8");
    const parsed = parse(raw) as HomeConfigFile | null;
    const value = parsed?.navigaBatchId;
    if (value === undefined || value === null) {
      return null;
    }

    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
