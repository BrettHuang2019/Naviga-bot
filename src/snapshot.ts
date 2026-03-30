import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Frame, Page } from "playwright";

type SnapshotManifest = {
  pages: Record<string, string>;
};

type DomNodeSnapshot = {
  type: "element" | "text";
  tagName?: string;
  text?: string;
  attributes?: Record<string, string>;
  children?: DomNodeSnapshot[];
};

type PageSnapshot = {
  capturedAt: string;
  url: string;
  title: string;
  root: DomNodeSnapshot | null;
};

const EMPTY_MANIFEST: SnapshotManifest = { pages: {} };
const DOM_SNAPSHOT_EVALUATOR = `
  (() => {
    const allowedAttributes = new Set([
      "id",
      "name",
      "role",
      "type",
      "value",
      "href",
      "src",
      "alt",
      "title",
      "placeholder",
      "aria-label",
      "aria-labelledby",
      "aria-describedby",
      "data-testid",
      "data-test",
      "for"
    ]);

    const serializeNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.replace(/\\s+/g, " ").trim();
        return text ? { type: "text", text } : null;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return null;
      }

      const element = node;
      const attributes = Array.from(element.attributes).reduce((accumulator, attribute) => {
        if (
          allowedAttributes.has(attribute.name) ||
          attribute.name === "class" ||
          attribute.name.startsWith("data-")
        ) {
          accumulator[attribute.name] = attribute.value;
        }

        return accumulator;
      }, {});

      const children = Array.from(element.childNodes)
        .map((childNode) => serializeNode(childNode))
        .filter((childNode) => childNode !== null);

      return {
        type: "element",
        tagName: element.tagName.toLowerCase(),
        attributes,
        children
      };
    };

    return {
      capturedAt: new Date().toISOString(),
      url: window.location.href,
      title: document.title,
      root: serializeNode(document.documentElement)
    };
  })()
`;

function normalizeUrl(url: string): string {
  const parsedUrl = new URL(url);
  parsedUrl.hash = "";
  return parsedUrl.toString();
}

function toSlug(url: string): string {
  const parsedUrl = new URL(url);
  const base = `${parsedUrl.hostname}${parsedUrl.pathname}`.replace(/[^a-zA-Z0-9]+/g, "-");
  const trimmed = base.replace(/^-+|-+$/g, "").toLowerCase() || "page";
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
  return `${trimmed}-${hash}`;
}

async function readManifest(manifestPath: string): Promise<SnapshotManifest> {
  try {
    const contents = await readFile(manifestPath, "utf8");
    return JSON.parse(contents) as SnapshotManifest;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return EMPTY_MANIFEST;
    }

    throw error;
  }
}

async function collectDomSnapshot(page: Page): Promise<PageSnapshot> {
  return page.evaluate(DOM_SNAPSHOT_EVALUATOR);
}

async function collectDomSnapshotForFrame(frame: Frame): Promise<PageSnapshot> {
  return frame.evaluate(DOM_SNAPSHOT_EVALUATOR);
}

export async function createDomSnapshotRecorder(rootDir: string): Promise<{
  capture: (page: Page) => Promise<void>;
}> {
  const snapshotDir = path.join(rootDir, "artifacts", "dom");
  const manifestPath = path.join(snapshotDir, "manifest.json");

  await mkdir(snapshotDir, { recursive: true });

  const manifest = await readManifest(manifestPath);
  const inFlight = new Set<string>();

  return {
    async capture(page: Page): Promise<void> {
      const captureUrl = async (url: string, collectSnapshot: () => Promise<PageSnapshot>): Promise<void> => {
        if (!url || url === "about:blank") {
          return;
        }

        const normalizedUrl = normalizeUrl(url);
        if (manifest.pages[normalizedUrl] || inFlight.has(normalizedUrl)) {
          return;
        }

        inFlight.add(normalizedUrl);

        try {
          const snapshot = await collectSnapshot();
          const fileName = `${toSlug(normalizedUrl)}.json`;
          const filePath = path.join(snapshotDir, fileName);

          await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
          manifest.pages[normalizedUrl] = fileName;
          await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
          console.log(`Saved DOM snapshot for ${normalizedUrl} -> ${fileName}`);
        } finally {
          inFlight.delete(normalizedUrl);
        }
      };

      await captureUrl(page.url(), () => collectDomSnapshot(page));

      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) {
          continue;
        }

        try {
          await captureUrl(frame.url(), () => collectDomSnapshotForFrame(frame));
        } catch {
          // Ignore detached or inaccessible frames while the page is still loading.
        }
      }
    },
  };
}
