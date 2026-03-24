import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const envValueSchema = z.string().min(1);

const selectorSchema = z
  .object({
    css: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    placeholder: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .superRefine((selector, context) => {
    const selectorKinds = [
      selector.css,
      selector.text,
      selector.label,
      selector.placeholder,
      selector.role,
    ].filter(Boolean);

    if (selectorKinds.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Each selector must define exactly one selector strategy.",
      });
    }

    if (selector.name && !selector.role) {
      context.addIssue({
        code: "custom",
        message: "Selector name can only be used together with role.",
      });
    }
  });

const stepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("goto"),
    url: z.string().min(1),
  }),
  z.object({
    type: z.literal("pause"),
    ms: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("usePage"),
    page: z.string().min(1),
  }),
  z.object({
    type: z.literal("click"),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal("fill"),
    target: z.string().min(1),
    value: z.string().min(1),
  }),
  z.object({
    type: z.literal("waitFor"),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal("waitForUrl"),
    urlIncludes: z.string().min(1).optional(),
    urlExcludes: z.string().min(1).optional(),
  }).superRefine((step, context) => {
    if (!step.urlIncludes && !step.urlExcludes) {
      context.addIssue({
        code: "custom",
        message: "waitForUrl must define urlIncludes or urlExcludes.",
      });
    }
  }),
  z.object({
    type: z.literal("exportSubscriptionDetail"),
    outputPath: z.string().min(1),
  }),
]);

const appConfigSchema = z.object({
  version: z.number().int().positive(),
  browser: z
    .object({
      headless: z.boolean().default(false),
    })
    .default({ headless: false }),
  defaultWorkflow: z.string().min(1),
});

const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1).optional(),
  dependsOn: z.array(z.string().min(1)).default([]),
  steps: z.array(stepSchema).min(1),
});

const pageDefinitionSchema = z.object({
  id: z.string().min(1),
  selectors: z.record(z.string().min(1), selectorSchema),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type SelectorDefinition = z.infer<typeof selectorSchema>;
export type PageDefinition = z.infer<typeof pageDefinitionSchema>;

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
  const contents = await readFile(envPath, "utf8");
  return parseDotEnv(contents);
}

async function loadYamlFile<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  const contents = await readFile(filePath, "utf8");
  const parsed = parse(contents);
  return schema.parse(parsed);
}

async function loadYamlDirectory<T extends { id: string }>(
  directoryPath: string,
  schema: z.ZodType<T>,
): Promise<Map<string, T>> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const items = new Map<string, T>();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yml")) {
      continue;
    }

    const filePath = path.join(directoryPath, entry.name);
    const item = await loadYamlFile(filePath, schema);

    if (items.has(item.id)) {
      throw new Error(`Duplicate id "${item.id}" in ${directoryPath}`);
    }

    items.set(item.id, item);
  }

  return items;
}

export async function loadAppConfig(rootDir: string): Promise<AppConfig> {
  const appConfigPath = path.join(rootDir, "workflow", "app.yml");
  return loadYamlFile(appConfigPath, appConfigSchema);
}

export async function loadWorkflowDefinitions(rootDir: string): Promise<Map<string, WorkflowDefinition>> {
  const workflowsDir = path.join(rootDir, "workflow", "workflows");
  return loadYamlDirectory(workflowsDir, workflowDefinitionSchema);
}

export async function loadPageDefinitions(rootDir: string): Promise<Map<string, PageDefinition>> {
  const pagesDir = path.join(rootDir, "workflow", "pages");
  return loadYamlDirectory(pagesDir, pageDefinitionSchema);
}

export function resolveEnvReference(value: string, env: Record<string, string>): string {
  if (!value.startsWith("env:")) {
    return value;
  }

  const envKey = value.slice("env:".length).trim();
  const envValue = env[envKey];

  if (typeof envValue !== "string" || envValue.trim().length === 0) {
    throw new Error(`Environment variable "${envKey}" is missing or empty.`);
  }

  return envValueSchema.parse(envValue);
}
