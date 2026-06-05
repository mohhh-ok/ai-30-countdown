# Secret Scanning (gitleaks)

To prevent leaking API keys and the like, we use [gitleaks](https://github.com/gitleaks/gitleaks). It scans the staged diff at pre-commit time and aborts the commit if anything is detected.

## Setup

The hook itself is `.githooks/pre-commit` (managed in the repository). Run this once right after cloning:

```sh
brew install gitleaks                 # if not installed
git config core.hooksPath .githooks   # enable the hook
```

If the execute permission was dropped (e.g. on Windows), also run `chmod +x .githooks/pre-commit`.

## Manual scan

```sh
bun run secrets          # scan the entire history
bun run secrets:staged   # staged diff only
```

## Exclusions

For false positives, append `gitleaks:allow` at the end of the relevant line, or exclude it in `.gitleaks.toml`.

## CI

`.github/workflows/gitleaks.yml` re-scans the entire history on push / PR (so anything that slips past the local hook is still caught in CI).
