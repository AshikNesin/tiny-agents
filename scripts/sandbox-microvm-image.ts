#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRIDGE_PORT = 8080;

const { values: args } = parseArgs({
  options: {
    region: { type: "string" },
    bucket: { type: "string" },
    "build-role-arn": { type: "string" },
    "base-image-arn": { type: "string" },
    name: { type: "string", default: "tiny-agents-sandbox" },
    architecture: { type: "string", default: "X86_64" },
    "memory-mib": { type: "string", default: "4096" },
    "dry-run": { type: "boolean", default: false },
  },
});

function required(name: keyof typeof args): string {
  const value = args[name];
  if (typeof value !== "string" || !value) {
    console.error(`--${name} is required. See docs/guides/microvm-sandbox.md.`);
    process.exit(1);
  }
  return value;
}

function run(command: string, commandArgs: string[], cwd = root): void {
  console.log(`$ ${command} ${commandArgs.join(" ")}`);
  if (args["dry-run"]) return;
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit" });
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

async function main(): Promise<void> {
  const region = required("region");
  const bucket = required("bucket");
  const buildRoleArn = required("build-role-arn");
  const baseImageArn =
    args["base-image-arn"] ?? `arn:aws:lambda:${region}:aws:microvm-image:al2023-1`;
  const name = args.name!;

  const work = mkdtempSync(path.join(tmpdir(), "tiny-agents-microvm-"));
  try {
    const context = path.join(work, "context");
    cpSync(path.join(root, "docker/sandbox"), context, {
      recursive: true,
      filter: (source) => !source.endsWith("compose.override.yml"),
    });
    await esbuild.build({
      entryPoints: [path.join(root, "packages/sandbox/src/microvm/bridge-main.ts")],
      outfile: path.join(context, "microvm-bridge.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    const zip = path.join(work, `${name}.zip`);
    run("zip", ["-qr", zip, "."], context);

    const key = `${name}/${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
    run("aws", ["s3", "cp", zip, `s3://${bucket}/${key}`, "--region", region]);

    const input = path.join(work, "create-image.json");
    writeFileSync(
      input,
      JSON.stringify(
        {
          name,
          description: "tiny-agents sandbox: sshd behind a WebSocket bridge (ADR 0055)",
          baseImageArn,
          buildRoleArn,
          codeArtifact: { uri: `s3://${bucket}/${key}` },
          cpuConfigurations: [{ architecture: args.architecture }],
          resources: [{ minimumMemoryInMiB: Number(args["memory-mib"]) }],
          hooks: {
            port: BRIDGE_PORT,
            microvmImageHooks: { ready: "ENABLED" },
            microvmHooks: { run: "ENABLED" },
          },
        },
        null,
        2,
      ),
    );
    run("aws", [
      "lambda-microvms",
      "create-microvm-image",
      "--region",
      region,
      "--cli-input-json",
      `file://${input}`,
    ]);
    console.log(
      "\nWhen the image is CREATED, set SANDBOX_MICROVM_IMAGE to its ARN (aws lambda-microvms get-microvm-image).",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
