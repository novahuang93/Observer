import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const globalForAnthropic = globalThis as unknown as { __anthropic?: Anthropic };

function readEnvFile(): Record<string, string> {
  // Some parent processes (e.g. the Claude Code desktop app) inject empty
  // ANTHROPIC_* variables into child environments, which take precedence over
  // .env.local because shell-set vars always win. As a fallback we read the
  // values directly from the project's .env.local.
  const out: Record<string, string> = {};
  for (const name of [".env.local", ".env"]) {
    try {
      const text = fs.readFileSync(path.join(process.cwd(), name), "utf-8");
      for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const match = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"\s]+)"?/);
        if (match && !(match[1] in out)) out[match[1]] = match[2];
      }
    } catch {
      /* file may not exist */
    }
  }
  return out;
}

function pick(name: string, file: Record<string, string>): string | undefined {
  // Project-local .env.local wins. This matters in sandboxed contexts where
  // the parent process injects non-empty defaults (e.g. ANTHROPIC_BASE_URL=
  // https://api.anthropic.com) that would otherwise override our config.
  if (file[name]) return file[name];
  const fromEnv = process.env[name]?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return undefined;
}

export function getAnthropic(): Anthropic {
  if (!globalForAnthropic.__anthropic) {
    const file = readEnvFile();
    const apiKey = pick("ANTHROPIC_API_KEY", file);
    const baseURL = pick("ANTHROPIC_BASE_URL", file);
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env.local in the project root.",
      );
    }
    globalForAnthropic.__anthropic = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
  }
  return globalForAnthropic.__anthropic;
}

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
