# mo-nix

Nix flake that packages [`k1LoW/mo`](https://github.com/k1LoW/mo) — a Markdown
viewer that renders files in a browser — as an overlay, with a daily GitHub
Actions workflow that tracks new upstream releases automatically.

## Supported systems

- `aarch64-darwin`
- `x86_64-darwin`
- `aarch64-linux`
- `x86_64-linux`

## Ad-hoc use

```sh
nix run github:wadackel/mo-nix -- path/to/file.md
```

## As a flake input

```nix
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    mo-nix = {
      url = "github:wadackel/mo-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, mo-nix, ... }: {
    # Expose `pkgs.mo` through your overlays list.
    # nixpkgs.overlays = [ mo-nix.overlays.default ];
  };
}
```

The overlay exposes `mo` (alias to `pkgs.mo`). You can also reference the
package directly:

```nix
mo-nix.packages.${system}.mo
```

## How updates work

The [`update.yaml`](./.github/workflows/update.yaml) workflow runs daily. It
queries the latest release of `k1LoW/mo` via `gh api`, prefetches the four
platform assets, and commits the updated `sources.json` directly to `main` if a
new version is available. Failures open a tracking issue.

## License

[MIT](./LICENSE). Upstream `mo` is also MIT-licensed.
