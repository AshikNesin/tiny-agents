# Publishing to a release-hub

`Release Hub Publish` (`.github/workflows/release-hub.yml`, synced from the boilerplate) publishes the
signed release APK to a [release-hub](https://github.com/AshikNesin/release-hub) server's direct
channel — the one installed apps poll for updates. It is **keyless**: the job's GitHub Actions OIDC
token is exchanged for a 1-hour release hub token scoped to this one app, so no release hub secret is stored in the
repo. The signing keystore lives on the release hub (generated when the android platform is added); CI
fetches it per run, signs, uploads, and deletes it.

## One-time setup

1. **Register the app** on your release hub: UI → Apps → Register app. The slug defaults to the repo name
   lowercased; override with the repo variable `RELEASE_HUB_SLUG`. Add the android platform — the release hub
   generates the RSA keystore there and then.
2. **Add the keyless grant**: release hub UI → the app → Configuration → Keyless publishing. Paste this
   repo's OIDC subject for runs on the default branch:
   - repos created before 2026-07-15: `repo:OWNER/REPO:ref:refs/heads/main`
   - newer repos use **immutable subject claims**: copy the prefix (`repo:OWNER@OWNER-ID/REPO@REPO-ID`)
     from the repo's Settings → Actions → OIDC configuration and append `:ref:refs/heads/main`.

   Not sure of the exact subject? Run the workflow once — the release hub's 401 message names the subject
   it received; copy that.
3. **Set `RELEASE_HUB_URL`** (repo Settings → Secrets and variables → Actions → Variables), e.g.
   `https://release-hub.example.com`.

The workflow fails fast with a pointed message when the variable is missing or the grant doesn't
match.

## Releasing

Bump `VERSION_CODE` in `android/version.properties` (it only goes up — the release hub refuses a code it
already has) and merge that to `main`. The push runs **Release Hub Publish**, which builds, signs and
uploads. That's all.

A change to `version.properties` that keeps the same `VERSION_CODE` fails the run rather than
publishing twice. In a repo with no `RELEASE_HUB_URL` set, a version bump skips the job quietly. To
publish with release notes, or to retry a failed run, run **Release Hub Publish** from the Actions
tab.

## Monorepo children

GitHub only reads workflows at the repo root, and monorepo children exclude `.github/workflows/**`
from sync. Copy `release-hub.yml` to the repo root and change three things:

- `uses: ./.github/actions/setup-android` → `uses: ./mobile/.github/actions/setup-android`
- both `working-directory: android` → `working-directory: mobile/android`
- the push trigger's path `android/version.properties` → `mobile/android/version.properties`

## What the minted token can do

Only this app's publish endpoints: upload/list/delete releases, read the manifest, fetch the
signing key. Other apps, token creation, Play config — 403. Revoking the grant on the release hub kills its
outstanding tokens immediately; they expire after an hour regardless.
