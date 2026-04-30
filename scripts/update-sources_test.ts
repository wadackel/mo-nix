import {
  assert,
  assertEquals,
  assertFalse,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  parseChecksums,
  sriHash,
  TAG_PATTERN,
  verifyAgainstChecksums,
} from "./update-sources.ts";

Deno.test("TAG_PATTERN accepts canonical tags", () => {
  assert(TAG_PATTERN.test("v1.4.0"));
  assert(TAG_PATTERN.test("v1.5.0"));
  assert(TAG_PATTERN.test("v10.20.30"));
  assert(TAG_PATTERN.test("v1.0.0-rc.1"));
});

Deno.test("TAG_PATTERN rejects leading-zero numeric components", () => {
  assertFalse(TAG_PATTERN.test("v01.2.3"));
  assertFalse(TAG_PATTERN.test("v1.02.3"));
  assertFalse(TAG_PATTERN.test("v1.2.03"));
});

Deno.test("TAG_PATTERN rejects malformed shapes", () => {
  // Missing leading `v`.
  assertFalse(TAG_PATTERN.test("1.4.0"));
  // Two-component versions are not stable upstream releases.
  assertFalse(TAG_PATTERN.test("v1.4"));
  // Non-numeric components.
  assertFalse(TAG_PATTERN.test("vfoo.bar.baz"));
  // Empty prerelease identifier after the dash.
  assertFalse(TAG_PATTERN.test("v1.0.0-"));
  // SemVer build-metadata (`+...`) is not part of the upstream tag shape.
  assertFalse(TAG_PATTERN.test("v1.0.0+meta"));
});

Deno.test("sriHash produces SRI-formatted SHA-256 used by pkgs.fetchurl", async () => {
  // SHA-256 of the empty byte string is well known; base64 of those 32 bytes
  // is the same SRI string `nix store prefetch-file` and `nix hash file --sri`
  // emit for an empty file.
  const empty = new Uint8Array(0);
  assertEquals(
    await sriHash(empty),
    "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
  );

  // Round-trip property: the output must always start with `sha256-` and the
  // base64 payload must decode back to 32 bytes.
  const sample = new TextEncoder().encode("mo-nix");
  const got = await sriHash(sample);
  assert(got.startsWith("sha256-"));
  const decoded = Uint8Array.from(
    atob(got.slice("sha256-".length)),
    (c) => c.charCodeAt(0),
  );
  assertEquals(decoded.byteLength, 32);
});

// Verbatim copy of the v1.5.0 release `checksums.txt`. Includes assets the
// flake does not consume (apk/deb/rpm/windows*) so the parser is exercised
// against the realistic shape, not a curated subset.
const FIXTURE_V1_5_0 =
  "719cae2b487900023b67d3d8ed83c8308f8fb2048bfbfdde29083285840718a5  mo_1.5.0-1_amd64.apk\n" +
  "d832e648398c47bb17d3e9cc365e210ab2b5d880ad0e48ce77ea4162cd063469  mo_1.5.0-1_amd64.deb\n" +
  "903e9b74cd0ed13a49d90c2e9d25a074aec47e683f64ff0f34477cb7fdae1bbc  mo_1.5.0-1_amd64.rpm\n" +
  "36a27532e3aaabb6b2b0338b09aa5180b7f374218f1c1c7590585335bc1f2c9a  mo_1.5.0-1_arm64.apk\n" +
  "a22dbc3134bc44669648a685eeb0736284f58c45510507661dcb54d1873c7362  mo_1.5.0-1_arm64.deb\n" +
  "3203961a585e4ac7f37b2be1d698bb3fec183e0b86b89d9fb4c21a9ecf39224e  mo_1.5.0-1_arm64.rpm\n" +
  "c62bf279a06567de31a20262eb490c4b231e12f48b3303cd32fc73616f7ca6db  mo_v1.5.0_darwin_amd64.zip\n" +
  "d35b631e4481c9fd2070a13d587d1a383b177e57604d6826e9fa5bcd5c4ae2a2  mo_v1.5.0_darwin_arm64.zip\n" +
  "9abd7d8c7d3ef6138c3f60c280d2aeb9af56d9554f9bf5f6b203f71d119b15e9  mo_v1.5.0_linux_amd64.tar.gz\n" +
  "f067519fd6daed0d679bc2f13d082d28815184f4b23d2b780d69833a783df444  mo_v1.5.0_linux_arm64.tar.gz\n" +
  "703c3ad7735e43e18d34d406e625a2d0d079467274957e8841b4b12d7ef9d569  mo_v1.5.0_windows_amd64.tar.gz\n";

Deno.test("parseChecksums extracts every entry from the v1.5.0 fixture", () => {
  const map = parseChecksums(FIXTURE_V1_5_0);
  // 11 entries total in the upstream fixture.
  assertEquals(Object.keys(map).length, 11);
  // The four assets the flake actually consumes.
  assertEquals(
    map["mo_v1.5.0_darwin_arm64.zip"],
    "d35b631e4481c9fd2070a13d587d1a383b177e57604d6826e9fa5bcd5c4ae2a2",
  );
  assertEquals(
    map["mo_v1.5.0_darwin_amd64.zip"],
    "c62bf279a06567de31a20262eb490c4b231e12f48b3303cd32fc73616f7ca6db",
  );
  assertEquals(
    map["mo_v1.5.0_linux_arm64.tar.gz"],
    "f067519fd6daed0d679bc2f13d082d28815184f4b23d2b780d69833a783df444",
  );
  assertEquals(
    map["mo_v1.5.0_linux_amd64.tar.gz"],
    "9abd7d8c7d3ef6138c3f60c280d2aeb9af56d9554f9bf5f6b203f71d119b15e9",
  );
});

Deno.test("parseChecksums tolerates blank lines, comments, and CRLF", () => {
  const text =
    "# leading comment\r\n" +
    "\r\n" +
    "9abd7d8c7d3ef6138c3f60c280d2aeb9af56d9554f9bf5f6b203f71d119b15e9  mo_v1.5.0_linux_amd64.tar.gz\r\n" +
    "\n";
  const map = parseChecksums(text);
  assertEquals(Object.keys(map).length, 1);
  assertEquals(
    map["mo_v1.5.0_linux_amd64.tar.gz"],
    "9abd7d8c7d3ef6138c3f60c280d2aeb9af56d9554f9bf5f6b203f71d119b15e9",
  );
});

Deno.test("parseChecksums rejects malformed input", () => {
  // Hex too short.
  assertThrows(
    () => parseChecksums("abc  asset.tar.gz\n"),
    Error,
    "invalid sha256 hex",
  );
  // Uppercase hex is not what goreleaser emits and is rejected to make
  // case-mismatch bugs surface immediately.
  assertThrows(
    () =>
      parseChecksums(
        "9ABD7D8C7D3EF6138C3F60C280D2AEB9AF56D9554F9BF5F6B203F71D119B15E9  asset.tar.gz\n",
      ),
    Error,
    "invalid sha256 hex",
  );
  // Three columns instead of two (e.g. an extra signature column).
  assertThrows(
    () =>
      parseChecksums(
        "9abd7d8c7d3ef6138c3f60c280d2aeb9af56d9554f9bf5f6b203f71d119b15e9  asset.tar.gz  extra\n",
      ),
    Error,
    "malformed checksums line",
  );
  // Duplicate asset name across two lines must throw.
  const dup =
    "9abd7d8c7d3ef6138c3f60c280d2aeb9af56d9554f9bf5f6b203f71d119b15e9  asset.tar.gz\n" +
    "f067519fd6daed0d679bc2f13d082d28815184f4b23d2b780d69833a783df444  asset.tar.gz\n";
  assertThrows(() => parseChecksums(dup), Error, "duplicate checksums entry");
});

Deno.test("verifyAgainstChecksums passes on match, throws on mismatch and unknown", () => {
  const map = {
    "asset.tar.gz":
      "9abd7d8c7d3ef6138c3f60c280d2aeb9af56d9554f9bf5f6b203f71d119b15e9",
  };
  // Match: must not throw.
  verifyAgainstChecksums(
    "asset.tar.gz",
    "9abd7d8c7d3ef6138c3f60c280d2aeb9af56d9554f9bf5f6b203f71d119b15e9",
    map,
  );
  // Mismatch: must throw with explicit expected/got framing.
  assertThrows(
    () =>
      verifyAgainstChecksums(
        "asset.tar.gz",
        "0000000000000000000000000000000000000000000000000000000000000000",
        map,
      ),
    Error,
    "checksum mismatch",
  );
  // Asset not in the map: must throw rather than silently skip.
  assertThrows(
    () =>
      verifyAgainstChecksums(
        "missing.tar.gz",
        "9abd7d8c7d3ef6138c3f60c280d2aeb9af56d9554f9bf5f6b203f71d119b15e9",
        map,
      ),
    Error,
    "asset missing from checksums.txt",
  );
});
