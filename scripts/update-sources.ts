#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

// Refresh sources.json against the latest k1LoW/mo release.
//
// stdout: "unchanged" when sources.json already tracks the latest tag,
//         "changed"   when sources.json was rewritten.
// exit 0: either of the above.
// exit 1: upstream fetch failure, asset lookup failure, or prefetch failure.

const UPSTREAM_OWNER = "k1LoW";
const UPSTREAM_REPO = "mo";

// Restricts upstream-controlled tags to a shape that is safe to interpolate
// into shell commands, commit messages, and Nix string contexts downstream.
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/;

type Ext = "zip" | "tar.gz";

type PlatformSpec = {
  asset: string;
  ext: Ext;
};

const PLATFORMS: Record<string, PlatformSpec> = {
  "aarch64-darwin": { asset: "darwin_arm64", ext: "zip" },
  "x86_64-darwin": { asset: "darwin_amd64", ext: "zip" },
  "aarch64-linux": { asset: "linux_arm64", ext: "tar.gz" },
  "x86_64-linux": { asset: "linux_amd64", ext: "tar.gz" },
};

type PlatformEntry = {
  url: string;
  hash: string;
};

type Sources = {
  version: string;
  tag: string;
  platforms: Record<string, PlatformEntry>;
};

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type Release = {
  tag_name: string;
  assets: ReleaseAsset[];
};

const scriptDir = new URL(".", import.meta.url).pathname;
const sourcesPath = `${scriptDir}../sources.json`;

async function fetchLatestRelease(): Promise<Release> {
  const cmd = new Deno.Command("gh", {
    args: [
      "api",
      `repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases/latest`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    const err = new TextDecoder().decode(stderr);
    throw new Error(`gh api failed (exit ${code}): ${err}`);
  }
  return JSON.parse(new TextDecoder().decode(stdout)) as Release;
}

async function prefetch(url: string): Promise<string> {
  const cmd = new Deno.Command("nix", {
    args: ["store", "prefetch-file", "--json", "--refresh", url],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    const err = new TextDecoder().decode(stderr);
    throw new Error(`nix store prefetch-file failed for ${url} (exit ${code}): ${err}`);
  }
  const parsed = JSON.parse(new TextDecoder().decode(stdout)) as { hash?: string };
  if (typeof parsed.hash !== "string" || !parsed.hash.startsWith("sha256-")) {
    throw new Error(`nix store prefetch-file returned unexpected payload for ${url}: ${JSON.stringify(parsed)}`);
  }
  return parsed.hash;
}

function buildAssetName(tag: string, spec: PlatformSpec): string {
  return `mo_${tag}_${spec.asset}.${spec.ext}`;
}

function pickAssets(release: Release): Record<string, ReleaseAsset> {
  const picked: Record<string, ReleaseAsset> = {};
  for (const [system, spec] of Object.entries(PLATFORMS)) {
    const name = buildAssetName(release.tag_name, spec);
    const asset = release.assets.find((a) => a.name === name);
    if (!asset) {
      throw new Error(`Asset not found for ${system}: expected ${name}`);
    }
    picked[system] = asset;
  }
  return picked;
}

async function readCurrent(): Promise<Sources | null> {
  try {
    const raw = await Deno.readTextFile(sourcesPath);
    return JSON.parse(raw) as Sources;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

async function writeAtomic(next: Sources): Promise<void> {
  const tmp = `${sourcesPath}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(next, null, 2) + "\n");
  await Deno.rename(tmp, sourcesPath);
}

function versionFromTag(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

async function main(): Promise<void> {
  const release = await fetchLatestRelease();
  if (!TAG_PATTERN.test(release.tag_name)) {
    throw new Error(`Refusing tag with unexpected shape: ${JSON.stringify(release.tag_name)}`);
  }
  console.error(`[update-sources] upstream latest tag: ${release.tag_name}`);
  const current = await readCurrent();

  if (current && current.tag === release.tag_name) {
    console.error("[update-sources] decision: unchanged (tags match)");
    console.log("unchanged");
    return;
  }

  const picked = pickAssets(release);
  const platforms: Record<string, PlatformEntry> = {};
  for (const [system, asset] of Object.entries(picked)) {
    const hash = await prefetch(asset.browser_download_url);
    platforms[system] = { url: asset.browser_download_url, hash };
  }

  const next: Sources = {
    version: versionFromTag(release.tag_name),
    tag: release.tag_name,
    platforms,
  };
  await writeAtomic(next);
  console.error(
    `[update-sources] decision: changed (${current?.tag ?? "(none)"} -> ${release.tag_name})`,
  );
  console.log("changed");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  Deno.exit(1);
});
