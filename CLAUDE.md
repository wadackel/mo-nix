# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Nix flake that repackages upstream [`k1LoW/mo`](https://github.com/k1LoW/mo) release binaries for four systems (`aarch64-darwin`, `x86_64-darwin`, `aarch64-linux`, `x86_64-linux`) and exposes them as `packages.<sys>.mo` + `overlays.default`. The repo has no application source of its own. A daily GitHub Actions workflow refreshes `sources.json` against the latest upstream release.

## Language policy

- **Artifacts (commits, code, comments, workflows, PR titles/descriptions, issues): English only.** This is a public OSS repo.
- **Interactive conversation with Claude Code: follow the user's configured language** (from `~/.claude/settings.json` / global `CLAUDE.md`). Do not switch conversation language just because this repo's artifacts are English.

## Commands

Run everything through `just`. All recipes wrap with `nix develop -c <cmd>` — do not use `eval "$(nix print-dev-env)"`, it fails under macOS bash 3.2.

- `just update` — Refresh `sources.json` from the latest upstream release. Prints `changed` or `unchanged`.
- `just check` — `nix flake check` for the **current system only**. CI runs this on both `ubuntu-latest` and `macos-latest`.
- `just check-eval-all` — `nix flake show --all-systems`. Eval-only verification of all four platforms on one runner (does not build cross-system, which would fail).
- `just build` — `nix build .#mo` for the current system.
- `just fmt` / `just fmt-check` — `nixfmt` on `flake.nix`.

Do not run `nix flake check --all-systems` directly — it attempts to build the `fetchurl` derivations for every system and fails on mismatched hosts (e.g. darwin assets on a Linux runner). Use `just check-eval-all` instead.

## Non-obvious implementation choices

- **`fetchurl` + conditional `unzip`, not `fetchzip`.** Upstream ships `.zip` for darwin and `.tar.gz` for linux. `nix store prefetch-file --json` returns a flat-file (fetchurl-compatible) SRI hash; `fetchzip` expects a recursive NAR hash. `flake.nix` sets `nativeBuildInputs = lib.optionals isZip [ pkgs.unzip ]` and `sourceRoot = "."` so stdenv's default unpack handles both.
- **Tag regex is defense-in-depth.** `scripts/update-sources.ts` validates the upstream tag against `^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$` before it is interpolated into shell commands, commit messages, or Nix string contexts. `.github/workflows/update.yaml` re-validates the same pattern against `sources.json` before the commit step, so a hand-edited `sources.json` cannot smuggle an arbitrary tag through.
- **GitHub Actions are SHA-pinned.** Never change a pin to `@v*`. When bumping an action, replace the full 40-char SHA and keep the `# v<major>` comment accurate.
- **Daily workflow requires `GH_TOKEN`.** `update.yaml` passes `${{ github.token }}` into the step so `gh api` can hit `repos/k1LoW/mo/releases/latest`. `permissions: contents: write, issues: write` for that workflow only; CI is `contents: read`.
- **`sources.json` is treated as generated.** Prefer `just update` over hand edits. A failure opens an issue labelled `update-failed`, or rewrites the title and body of the one already open — it never adds a comment, so the only notification is the initial one. The title carries the consecutive failure count (`(×N)`) so the severity is visible from the issue list. A later successful run closes that issue, which is what re-arms the notification: leaving one open would let the next outage land as a silent in-place edit.
- **No Nix store cache in CI.** `cache-nix-action` was removed after the same configuration broke a sibling repository's scheduled workflow for 61 days straight. The cache tarball carries both `/nix/var/nix/db` and `/nix/store`; `tar` treats per-entry hard-link failures as non-fatal and only exits non-zero at the very end, so the database restores completely while an arbitrary subset of store paths does not. Every later `nix develop` then dies with `store path ... does not exist`, and because a failed restore is only a warning the job never falls back to a cache miss. The trigger was [cache-nix-action#170](https://github.com/nix-community/cache-nix-action/issues/170), and `DeterminateSystems/nix-installer-action` is not in that action's compatible-installer list to begin with ([#337](https://github.com/nix-community/cache-nix-action/issues/337)). Caching bought little here anyway: the derivation is `fetchurl` + copy with no compile step and the devShell is fully binary-cached, so a cold update run takes about a minute. If a store cache is ever reintroduced, do not reuse the `nix-v1-` key prefix.

## Commit convention

Automated bumps use `chore: bump mo to <tag>` (e.g. `chore: bump mo to v1.4.0`). Match this style for manual updates to `sources.json`. No pre-commit hooks are configured.

## Deno script conventions

`scripts/update-sources.ts` runs under Deno 2.x via `just update`. When editing it:
- Use `Deno.Command` with `stderr: "piped"` and surface stderr in thrown errors.
- Resolve paths relative to the script with `new URL(".", import.meta.url).pathname`.
- Keep the atomic-write pattern (`writeAtomic`: tmp file + rename).
