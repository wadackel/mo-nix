#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net

// Refresh sources.json against the latest k1LoW/mo release.
//
// stdout: "unchanged" when sources.json already tracks the latest tag,
//         "changed"   when sources.json was rewritten.
// exit 0: either of the above.
// exit 1: upstream fetch failure, asset lookup failure, checksums mismatch,
//         or hash computation failure.
//
// Threat model: checksums.txt and the asset are fetched from the same release
// URL prefix (github.com/k1LoW/mo/releases/download/<tag>/). An attacker who
// can rewrite the release can rewrite both, so this verification only catches
// transport-layer issues (CDN tampering, in-flight corruption, asset misnaming,
// or bugs in this script itself), not malicious upstream publishers.

const UPSTREAM_OWNER = "k1LoW";
const UPSTREAM_REPO = "mo";

// Restricts upstream-controlled tags to a shape that is safe to interpolate
// into shell commands, commit messages, and Nix string contexts downstream.
// Leading zeros are rejected so the tag round-trips through semver tooling
// without surprises. Prerelease suffixes (`-rc.1` etc.) are accepted so
// upstream RC releases keep auto-updating.
export const TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[A-Za-z0-9.]+)?$/;

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
    args: ["api", `repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases/latest`],
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

async function downloadToBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`download failed for ${url}: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function downloadToText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`download failed for ${url}: HTTP ${res.status}`);
  }
  return await res.text();
}

// Copy bytes into a fresh ArrayBuffer because Deno's `crypto.subtle.digest`
// typings reject `Uint8Array<ArrayBufferLike>` (the type returned by
// `Response.arrayBuffer()` / `new Uint8Array(...)`) — it requires a
// non-shared ArrayBuffer to rule out `SharedArrayBuffer`.
function toFreshBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

export async function sriHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toFreshBuffer(bytes));
  let binary = "";
  const view = new Uint8Array(digest);
  for (let i = 0; i < view.byteLength; i += 1) {
    binary += String.fromCharCode(view[i]);
  }
  return `sha256-${btoa(binary)}`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toFreshBuffer(bytes));
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

// Parses a `checksums.txt` of the form emitted by goreleaser:
//   "<sha256-hex-lowercase>  <asset-name>"
// Lines that are empty or start with `#` are skipped. Every other line must be
// well-formed; malformed lines, uppercase hex, non-64-char hex, and duplicate
// asset names all throw so a corrupted file fails fast instead of silently
// pinning stale or wrong hashes.
export function parseChecksums(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 2) {
      throw new Error(`malformed checksums line: ${JSON.stringify(line)}`);
    }
    const [hex, name] = parts;
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      throw new Error(`invalid sha256 hex in checksums: ${hex}`);
    }
    if (out[name] !== undefined) {
      throw new Error(`duplicate checksums entry: ${name}`);
    }
    out[name] = hex;
  }
  return out;
}

export function verifyAgainstChecksums(
  name: string,
  bytesHex: string,
  map: Record<string, string>,
): void {
  const expected = map[name];
  if (expected === undefined) {
    throw new Error(`asset missing from checksums.txt: ${name}`);
  }
  if (expected !== bytesHex) {
    throw new Error(
      `checksum mismatch for ${name}: expected ${expected}, got ${bytesHex}`,
    );
  }
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

function findAssetByName(release: Release, name: string): ReleaseAsset {
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) {
    throw new Error(`Asset not found in release ${release.tag_name}: ${name}`);
  }
  return asset;
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
  const tmp = `${sourcesPath}.tmp.${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, JSON.stringify(next, null, 2) + "\n");
  await Deno.rename(tmp, sourcesPath);
}

function versionFromTag(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

async function processPlatform(
  system: string,
  asset: ReleaseAsset,
  checksums: Record<string, string>,
): Promise<PlatformEntry> {
  // Single download; both the SRI hash recorded in sources.json and the
  // checksums.txt cross-check are derived from THESE bytes. Refetching the URL
  // would let the two checks diverge on an upstream asset swap mid-update.
  const bytes = await downloadToBytes(asset.browser_download_url);
  const hex = await sha256Hex(bytes);
  verifyAgainstChecksums(asset.name, hex, checksums);
  const hash = await sriHash(bytes);
  console.error(`[update-sources] checksum verified for ${system} (${asset.name})`);
  return { url: asset.browser_download_url, hash };
}

async function main(): Promise<void> {
  const release = await fetchLatestRelease();
  if (!TAG_PATTERN.test(release.tag_name)) {
    throw new Error(
      `Refusing tag with unexpected shape: ${JSON.stringify(release.tag_name)}`,
    );
  }
  console.error(`[update-sources] upstream latest tag: ${release.tag_name}`);

  const current = await readCurrent();
  if (current && current.tag === release.tag_name) {
    console.error("[update-sources] decision: unchanged (tags match)");
    console.log("unchanged");
    return;
  }

  // Hard fail when checksums.txt is missing — staleness is preferable to
  // pinning a hash that was never cross-checked.
  const checksumsAsset = findAssetByName(release, "checksums.txt");
  const checksumsText = await downloadToText(checksumsAsset.browser_download_url);
  const checksums = parseChecksums(checksumsText);

  const picked = pickAssets(release);
  const platforms: Record<string, PlatformEntry> = {};
  for (const [system, asset] of Object.entries(picked)) {
    platforms[system] = await processPlatform(system, asset, checksums);
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

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  });
}
