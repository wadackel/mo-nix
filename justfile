default:
    @just --list

# Refresh sources.json from the latest upstream release
update:
    deno run -A scripts/update-sources.ts

# Verify the flake evaluates for the current system (CI runs this on both linux and darwin)
check:
    nix flake check

# Evaluate outputs for every supported system without building (eval-only)
check-eval-all:
    nix flake show --all-systems

# Build mo for the current system
build:
    nix build .#mo

# Format nix files in place
fmt:
    nix fmt

# Check nix formatting without writing changes
fmt-check:
    nixfmt --check flake.nix
