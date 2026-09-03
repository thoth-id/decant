# Releasing

How a version of `@thoth-dev/decant` reaches npm and GitHub. Most of this is
automated — a tag is the trigger, and `.github/workflows/release.yml` does the
rest. The manual parts are the first-time setup and deciding the version.

## First-time setup

These happen once, in this order. Skipping one makes the first release fail.

### 1. The npm scope has to exist

`@thoth-dev` is an npm **organisation**, not just a prefix. Publishing into a
scope that does not exist fails with a confusing `404`. Create it at
[npmjs.com/org/create](https://www.npmjs.com/org/create) — the free tier allows
public packages, which is what this is.

### 2. Log in locally

```bash
npm login
npm whoami   # should print your npm user
```

### 3. Publish 0.1.0 by hand

The first publish cannot be automated, because a trusted publisher can only be
configured on a package that already exists.

```bash
bun run typecheck
npm publish --dry-run   # read the file list before it is permanent
npm publish
```

Then tag and release **by hand**, without pushing the tag first. Pushing
`v0.1.0` would fire the release workflow, which would try to publish a version
npm already has and fail:

```bash
git tag v0.1.0
git push origin v0.1.0 --no-verify   # the workflow will run and fail on publish
```

Simpler: skip the tag push and create both at once, which tags the current
commit remotely without triggering a push event:

```bash
gh release create v0.1.0 --generate-notes --target main
```

From 0.2.0 on, the tag does everything — see below.

### 4. Configure trusted publishing

On the package page → **Settings** → **Trusted Publisher**, fill in:

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `thoth-id` — the **GitHub** org, not the npm scope |
| Repository | `decant` |
| Workflow filename | `release.yml` |
| Environment name | *leave empty* — the workflow declares no environment, and a name here would make OIDC fail |
| Allow `npm publish` | **leave unchecked** |

This is what lets the workflow publish without an `NPM_TOKEN` in the repository:
GitHub proves the workflow's identity through OIDC, so there is no long-lived
secret to leak. **The form cannot be edited afterwards** — a wrong value means
deleting the connection and making a new one.

Leaving `npm publish` unchecked is deliberate. The workflow runs
`npm stage publish`, which puts the version in a staging area instead of the
public registry, and a person approves it. See below.

### 5. GitHub Actions has to be allowed

The `thoth-id` organisation restricts Actions to selected repositories
(`enabled_repositories: selected`). If a workflow never runs and no error shows,
this is why. Check with:

```bash
gh api repos/thoth-id/decant/actions/permissions --jq '.enabled'
```

If it prints `false`, add the repository to the organisation allowlist:

```bash
REPO_ID=$(gh api repos/thoth-id/decant --jq '.id')
gh api "orgs/thoth-id/actions/permissions/repositories/$REPO_ID" -X PUT
```

## Releasing a version

With the setup done, a release is two commands.

```bash
# choose one: patch | minor | major
npm version minor       # bumps package.json, commits, and tags v0.2.0

git push --follow-tags  # the tag is what fires the workflow
```

Then watch it:

```bash
gh run watch --repo thoth-id/decant
```

The workflow typechecks, **stages** the version on npm, and opens the GitHub
Release with notes generated from the commits since the previous tag.

Staged is not published. Nobody can install it until you approve:

```bash
npm stage list                 # find the stage id
npm stage view <stage-id>      # what would go public
npm stage approve <stage-id>   # publish it
npm stage reject <stage-id>    # throw it away, the version stays free
```

That last line is the reason for staging. **An npm version can never be
replaced** — publishing straight from CI means a wrong tag burns that number
forever. Staged, a bad build is rejected and the number stays available.

### Before bumping

- Move the entries under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) into
  a section for the new version, and add the comparison links at the bottom.
- Decide the number honestly. Before 1.0.0 the contract is loose, but a change
  that breaks how someone calls the CLI still deserves a **minor**, not a patch.

## What the workflow refuses to do

**Publish when the tag disagrees with `package.json`.** Tagging `v0.2.0` while
the file still says `0.1.0` would publish the wrong version under the right
name. The job stops before `npm publish`.

This matters more than it looks: **an npm version can never be replaced.** Once
`0.2.0` is published, that number is spent forever, even if you unpublish it.

## If something goes wrong

**Published a broken version.** Within 72 hours you can remove it:

```bash
npm unpublish @thoth-dev/decant@0.2.0
```

After 72 hours, unpublishing is not allowed. Deprecate instead, and release a
fix:

```bash
npm deprecate @thoth-dev/decant@0.2.0 "broken, use 0.2.1"
```

Either way the version number stays burned — the next release is `0.2.1`, never
a second `0.2.0`.

**Tagged the wrong commit, before anything published.** Delete the tag locally
and on the remote, then tag again:

```bash
git tag -d v0.2.0
git push origin :refs/tags/v0.2.0
```

**The workflow failed halfway.** Check what completed before re-running — if
`npm publish` already succeeded, re-running the whole job will fail on the
duplicate version. In that case create the GitHub Release by hand:

```bash
gh release create v0.2.0 --verify-tag --generate-notes
```
