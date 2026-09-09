# Python SDK releases

Python SDK releases use the version in `pyproject.toml` and the GitHub tag
`python-sdk-v<version>`. They do not change npm package versions or deploy the gateway or website.
The current source prepares 0.1.12; a version in source is not proof of publication.

## Prepare and publish

1. Merge the reviewed candidate only after required CI passes. Freeze the full commit SHA on main.
2. Check the package version, `llmkit.__version__`, changelog and upgrade notes against that revision.
   This workflow accepts stable `major.minor.patch` releases and builds one pure-Python wheel and
   one source archive. Pre-releases or platform-specific wheels need a separate contract change.
3. Run `Publish Python SDK` on main with that exact SHA as `expected_sha`. The workflow refuses an
   existing PyPI version, tests Python 3.11, builds and installs the wheel, attests both files, and
   publishes through the existing PyPI trusted publisher. The `pypi` environment approval remains
   required wherever configured; this guide does not change repository environment settings.
4. Require the post-publication check to match PyPI's package identity, filenames, sizes, hashes and
   downloaded bytes to the original build. The workflow retains those attested files for 90 days as
   `llmkit-sdk-<version>-dist`, including when a later publication or verification step fails.

No package may be called released from the workflow's start, a version label, or an upload alone.

## Verify the original files

Use Node.js 24 and an authenticated GitHub CLI with artifact-attestation support. Set `VERSION`,
`RELEASE_SHA` and `RUN_ID` from the reviewed release and its publication run. Run this from a checkout
of that exact revision. The temporary directory is deliberately retained for inspection.

```bash
set -eu
: "${VERSION:?Set the reviewed Python package version}"
: "${RELEASE_SHA:?Set the full reviewed source SHA}"
: "${RUN_ID:?Set the publication workflow run ID}"
node scripts/assert-unpublished-version.mjs expected-sha "$RELEASE_SHA" "$(git rev-parse HEAD)"
DIST="$(mktemp -d)"
gh run download "$RUN_ID" --repo smigolsmigol/llmkit \
  --name "llmkit-sdk-${VERSION}-dist" --dir "$DIST"
node scripts/assert-unpublished-version.mjs pypi-artifacts "$VERSION" "$DIST"
for artifact in "$DIST"/*; do
  gh attestation verify "$artifact" --repo smigolsmigol/llmkit \
    --signer-workflow smigolsmigol/llmkit/.github/workflows/publish-pypi.yml \
    --source-digest "$RELEASE_SHA" --signer-digest "$RELEASE_SHA" \
    --source-ref refs/heads/main --deny-self-hosted-runners
done
```

The JSON report proves byte parity with PyPI. The GitHub verification separately binds each file
to the repository, publication workflow and reviewed source revision. See the
[GitHub verification reference](https://cli.github.com/manual/gh_attestation_verify).
PyPI's publish attestation is a separate statement; its presence in the
[Integrity API](https://docs.pypi.org/api/integrity/) is not cryptographic verification by this script.

## Complete the GitHub release

After both checks pass, the release operator creates `Python SDK <version>` with tag
`python-sdk-v<version>` at the same reviewed commit, attaches the two verified files without
rebuilding or overwriting assets, and includes the source SHA, publication-run link, package install
command and migration notes. Resolve the tag to its commit before accepting the release; a tag name
or `target_commitish` alone is not a source-identity check. An existing mismatched tag or asset stops
the release. Download the attached files and repeat the checks above against those files before
announcing completion.

The legacy SLSA and Node SBOM release jobs skip Python package tags because they build npm artifacts.
Python build attestations do not claim the legacy workflow's SLSA level, and artifact attestations
do not constitute a cryptographic signature on the source tag.

## Support and recovery

Security fixes target the latest package release as stated in [SECURITY.md](../../SECURITY.md).
No older support window or backward-compatibility guarantee is implied. Describe any Python floor,
optional-extra, policy-format or API changes in the release notes. The 0.1.12 candidate adds packaged
Boundary Check policies and installed-wheel native-adapter proof; it does not reopen hosted signup.

If PyPI accepted either file but a later step failed, do not rerun the publisher blindly: its
existing-version guard must continue to reject that version. Recover the retained original files,
inspect the registry file set, and rerun read-only verification. A missing or different published
file needs an explicit maintainer recovery decision, not a rebuild disguised as the original upload.
If only the GitHub release is missing, complete that step from the verified original files.

For a bad published release, preserve its evidence, assess whether it must be yanked, and publish a
new corrected version through review. Do not delete or replace historical artifacts, move tags, or
downgrade users silently. A previous version is a rollback option only after checking compatibility
and known vulnerabilities.
