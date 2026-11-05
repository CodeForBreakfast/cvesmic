# Releasing CVEsmic

A release is one pull request. Merging it releases, because the Release workflow does everything after the merge. Nobody pushes a tag by hand.

The pull request raises `version` in `plugin/cvesmic/plugin.json` and adds `RELEASE-NOTES/<version>.md`. The notes become the GitHub Release body word for word.

Write each paragraph of the notes on one line. GitHub renders a release body with hard line breaks, and `nix flake check` refuses a wrapped file.

The Release workflow runs when CI succeeds on a push to `main`. If `v<version>` has no GitHub Release and the notes file exists, it builds the package, tags the commit and creates the release with a tarball and its checksum. If the version has neither a release nor a notes file, the run fails until the notes file lands.

A release that died part-way is repaired by running the Release workflow by hand on `main`. Every step is safe to run twice.
