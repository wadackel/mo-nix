{
  description = "Nix overlay for k1LoW/mo (Markdown viewer in browser)";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

      sources = builtins.fromJSON (builtins.readFile ./sources.json);

      mkMo =
        pkgs:
        let
          lib = pkgs.lib;
          system = pkgs.stdenv.hostPlatform.system;
          platform =
            sources.platforms.${system}
              or (throw "mo-nix: unsupported system ${system}. Supported: ${lib.concatStringsSep ", " (lib.attrNames sources.platforms)}");
          isZip = lib.hasSuffix ".zip" platform.url;
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "mo";
          version = sources.version;
          src = pkgs.fetchurl { inherit (platform) url hash; };
          nativeBuildInputs = lib.optionals isZip [ pkgs.unzip ];
          sourceRoot = ".";
          dontConfigure = true;
          dontBuild = true;
          installPhase = ''
            runHook preInstall
            install -Dm755 mo $out/bin/mo
            runHook postInstall
          '';
          meta = with lib; {
            description = "Markdown viewer in browser";
            homepage = "https://github.com/k1LoW/mo";
            license = licenses.mit;
            platforms = [
              "aarch64-darwin"
              "x86_64-darwin"
              "aarch64-linux"
              "x86_64-linux"
            ];
            mainProgram = "mo";
            sourceProvenance = with sourceTypes; [ binaryNativeCode ];
          };
        };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          mo = mkMo pkgs;
        in
        {
          inherit mo;
          default = mo;
        }
      );

      overlays.default = final: _prev: {
        mo = mkMo final;
      };

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              deno
              gh
              jq
              just
              nixfmt
            ];
          };
        }
      );

      checks = forAllSystems (system: {
        build = self.packages.${system}.mo;
      });

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
