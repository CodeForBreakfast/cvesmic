{
  description = "CVEsmic, a Wayland desktop app that shakes the screen when a new vulnerability appears";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      pluginDir = ./plugin/cvesmic;
      version = (builtins.fromJSON (builtins.readFile (pluginDir + "/plugin.json"))).version;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      cvesmic =
        pkgs:
        pkgs.stdenvNoCC.mkDerivation {
          pname = "cvesmic";
          inherit version;
          src = pluginDir;
          dontBuild = true;
          installPhase = ''
            mkdir -p $out/share/cvesmic
            cp -r . $out/share/cvesmic/
          '';
          meta.description = "Shakes the screen when a new vulnerability appears";
        };
    in
    {
      packages = forAllSystems (pkgs: rec {
        cvesmic = self.lib.cvesmic pkgs;
        default = cvesmic;
      });

      overlays.default = final: _prev: { cvesmic = self.lib.cvesmic final; };

      lib.cvesmic = cvesmic;

      checks = forAllSystems (pkgs: {
        package = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        release-notes-wrap = pkgs.runCommand "release-notes-wrap" { src = ./RELEASE-NOTES; } ''
          for f in "$src"/*.md; do
            if awk 'prev != "" && $0 != "" {bad=1} {prev=$0} END {exit !bad}' "$f"; then
              echo "$f wraps a paragraph across lines; GitHub renders release bodies with hard breaks" >&2
              exit 1
            fi
          done
          touch $out
        '';
      });
    };
}
