default:
    @just --list

# Refresh sources.json from the latest upstream release
update:
    deno run -A scripts/update-sources.ts

# Verify the flake evaluates for every supported system
check:
    nix flake check --all-systems

# Build mo for the current system
build:
    nix build .#mo

# Format nix files in place
fmt:
    nix fmt

# Check nix formatting without writing changes
fmt-check:
    nixfmt --check flake.nix
