import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GO_SCRAPER_DIR = path.join(ROOT_DIR, "academia-scraper");
const DEFAULT_GO_BINARY = process.platform === "win32"
  ? path.join(GO_SCRAPER_DIR, "loginprobe.exe")
  : path.join(GO_SCRAPER_DIR, "loginprobe");

function resolveGoScraperInvocation() {
  const explicitBinary = process.env.ACADEMIA_SCRAPER_BIN?.trim();
  if (explicitBinary) {
    return { command: explicitBinary, args: [], cwd: ROOT_DIR, source: "env-binary" };
  }

  const useGoRun = ["1", "true", "yes"].includes(
    String(process.env.ACADEMIA_SCRAPER_USE_GO_RUN || "").toLowerCase(),
  );
  if (!useGoRun && existsSync(DEFAULT_GO_BINARY)) {
    return { command: DEFAULT_GO_BINARY, args: [], cwd: ROOT_DIR, source: "default-binary" };
  }

  return { command: "go", args: ["run", "./cmd/loginprobe"], cwd: GO_SCRAPER_DIR, source: "go-run" };
}

function runInvocation(invocation, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GODEBUG: "netdns=cgo" },
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill("SIGTERM");
      reject(new Error(`academia scraper timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      let parsed = null;
      try {
        parsed = stdout.trim() ? JSON.parse(stdout) : null;
      } catch (error) {
        reject(new Error(`could not parse academia scraper JSON: ${error.message}\n${stdout}`));
        return;
      }

      resolve({
        exitCode: code,
        stderr,
        runtime: invocation.source,
        parsed,
      });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export function getAcademiaScraperRuntime() {
  return resolveGoScraperInvocation();
}

export async function runAcademiaScraper(payload, { timeoutMs = 120000 } = {}) {
  const primary = resolveGoScraperInvocation();
  try {
    return await runInvocation(primary, payload, timeoutMs);
  } catch (error) {
    const canFallbackToBinary =
      primary.source === "go-run" &&
      existsSync(DEFAULT_GO_BINARY);

    if (!canFallbackToBinary) throw error;

    return runInvocation(
      { command: DEFAULT_GO_BINARY, args: [], cwd: ROOT_DIR, source: "fallback-binary" },
      payload,
      timeoutMs,
    );
  }
}
