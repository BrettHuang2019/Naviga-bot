import { readFile } from "node:fs/promises";
import path from "node:path";

function parseDotEnv(contents: string): Record<string, string> {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce<Record<string, string>>((env, line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        return env;
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      const unquotedValue =
        rawValue.startsWith('"') && rawValue.endsWith('"')
          ? rawValue.slice(1, -1)
          : rawValue.startsWith("'") && rawValue.endsWith("'")
            ? rawValue.slice(1, -1)
            : rawValue;

      if (key) {
        env[key] = unquotedValue;
      }

      return env;
    }, {});
}

export async function loadEnv(rootDir: string): Promise<Record<string, string>> {
  const envPath = path.join(rootDir, ".env");
  try {
    const contents = await readFile(envPath, "utf8");
    return parseDotEnv(contents);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }

    throw error;
  }
}
