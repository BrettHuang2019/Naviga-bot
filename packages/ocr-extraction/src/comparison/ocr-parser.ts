import { normalizeWhitespace } from "./normalization.js";
import type { OcrLine, OcrPayload, ParsedOcrDocument } from "./types.js";

type InnerOcrPayload = {
  responsev2?: {
    predictionOutput?: {
      fullText?: unknown;
      results?: Array<{
        lines?: Array<{
          text?: unknown;
          boundingBox?: {
            left?: unknown;
            top?: unknown;
            width?: unknown;
            height?: unknown;
          };
        }>;
      }>;
    };
  };
};

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOcrLine(rawLine: {
  text?: unknown;
  boundingBox?: {
    left?: unknown;
    top?: unknown;
    width?: unknown;
    height?: unknown;
  };
}): OcrLine | null {
  const text = typeof rawLine.text === "string" ? normalizeWhitespace(rawLine.text) : "";
  if (!text) {
    return null;
  }

  const left = toFiniteNumber(rawLine.boundingBox?.left);
  const top = toFiniteNumber(rawLine.boundingBox?.top);
  const width = toFiniteNumber(rawLine.boundingBox?.width);
  const height = toFiniteNumber(rawLine.boundingBox?.height);
  if (left === null || top === null || width === null || height === null) {
    return null;
  }

  return {
    text,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

export function sortOcrLines(lines: OcrLine[]): OcrLine[] {
  return [...lines].sort((left, right) => {
    const topDelta = left.top - right.top;
    if (Math.abs(topDelta) > 0.012) {
      return topDelta;
    }

    return left.left - right.left;
  });
}

export function parseOcrText(ocrText: string, imageLink: string | null = null): ParsedOcrDocument {
  let parsed: InnerOcrPayload;
  try {
    parsed = JSON.parse(ocrText) as InnerOcrPayload;
  } catch {
    throw new Error("OCR payload ocrText is not valid JSON.");
  }

  const predictionOutput = parsed.responsev2?.predictionOutput;
  const results = predictionOutput?.results;
  const linesPayload = results?.[0]?.lines;
  if (!Array.isArray(linesPayload)) {
    throw new Error("OCR payload ocrText is missing responsev2.predictionOutput.results[0].lines.");
  }

  const fullText = typeof predictionOutput?.fullText === "string" ? predictionOutput.fullText : "";
  const lines = sortOcrLines(linesPayload.map((line) => normalizeOcrLine(line)).filter((line): line is OcrLine => line !== null));

  return {
    fullText,
    lines,
    imageLink,
  };
}

export function parseOcrPayload(payload: OcrPayload): ParsedOcrDocument {
  if (typeof payload?.ocrText !== "string" || payload.ocrText.length === 0) {
    throw new Error("OCR payload is missing ocrText.");
  }

  return parseOcrText(payload.ocrText, typeof payload.imageLink === "string" ? payload.imageLink : null);
}

export function createParsedOcrDocumentFromFullText(fullText: string): ParsedOcrDocument {
  const normalizedLines = fullText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0);

  const lineHeight = normalizedLines.length > 0 ? 1 / normalizedLines.length : 1;
  const lines = normalizedLines.map((text, index) => ({
    text,
    left: 0,
    width: 1,
    top: index * lineHeight,
    height: lineHeight,
    right: 1,
    bottom: (index + 1) * lineHeight,
  }));

  return {
    fullText,
    lines,
    imageLink: null,
  };
}
