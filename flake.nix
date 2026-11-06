{
  description = "CVEsmic, a Wayland desktop app that shakes the screen when a new vulnerability appears";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      pluginDir = ./plugin/cvesmic;
      gnomeDir = ./gnome + "/cvesmic@codeforbreakfast.co";
      version = (builtins.fromJSON (builtins.readFile (pluginDir + "/plugin.json"))).version;
      kwinVersion =
        (builtins.fromJSON (builtins.readFile (pluginDir + "/kwin/metadata.json"))).KPlugin.Version;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
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
      # The files a release attaches. Their names carry no version, so the
      # README can link to releases/latest/download/<name>.
      releaseFiles =
        pkgs:
        if version != kwinVersion then
          throw "plugin.json says version ${version} but kwin/metadata.json says ${kwinVersion}"
        else
          pkgs.stdenvNoCC.mkDerivation {
            pname = "cvesmic-release";
            inherit version;
            src = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions [
                pluginDir
                gnomeDir
              ];
            };
            nativeBuildInputs = [ pkgs.gnome-shell ];
            buildPhase = ''
              pack() {
                tar --sort=name --mtime=@1 --owner=0 --group=0 --numeric-owner -I 'gzip -n' "$@"
              }
              pack -C plugin -cf cvesmic-quickshell.tar.gz cvesmic
              pack -C plugin/cvesmic/kwin -cf cvesmic-kwin.tar.gz metadata.json contents
              gnome-extensions pack gnome/cvesmic@codeforbreakfast.co \
                --extra-source=../../plugin/cvesmic/Feed.mjs \
                --extra-source=../../plugin/cvesmic/Shake.mjs
              sha256sum cvesmic-quickshell.tar.gz cvesmic-kwin.tar.gz cvesmic@codeforbreakfast.co.shell-extension.zip > SHA256SUMS
            '';
            installPhase = ''
              mkdir $out
              cp cvesmic-quickshell.tar.gz cvesmic-kwin.tar.gz cvesmic@codeforbreakfast.co.shell-extension.zip SHA256SUMS $out/
            '';
          };
    in
    {
      packages = forAllSystems (pkgs: rec {
        cvesmic = self.lib.cvesmic pkgs;
        default = cvesmic;
        release = releaseFiles pkgs;
      });

      overlays.default = final: _prev: { cvesmic = self.lib.cvesmic final; };

      lib.cvesmic = cvesmic;

      checks = forAllSystems (pkgs: {
        package = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        release = self.packages.${pkgs.stdenv.hostPlatform.system}.release;
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
