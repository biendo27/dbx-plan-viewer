# Development and releases

This repository uses Gitflow from version 0.1.1 onward. Earlier implementation
commits already existed on main; their history has been preserved.

- `main` contains released or release-ready code.
- `develop` integrates the next version.
- `feature/<issue>-<slug>` branches start from develop and return through a PR.
- `release/<version>` branches start from develop for release preparation. Merge
  the reviewed PR into main, tag its merge commit as `v<version>`, publish the
  verified package, and merge main back into develop through a PR.
- `hotfix/<issue>-<slug>` branches start from main for urgent release fixes, then
  return to both main and develop through reviewed PRs.

Link implementation and release PRs to their tracking issue. Use conventional
commit titles, preserve merge commits for release/back-merge history, and do not
rewrite published history. Main and develop require a pull request and the
successful `verify` CI check before merging.

Before releasing, verify tests, generated UI, package identity, checksum and
native DBX acceptance. Publish only the unsigned `.dbxp`, its artifact metadata,
and checksums. Never publish live plans, credentials, or private captures.

GitHub release and DBX Marketplace listing are separate milestones. Submit the
unsigned candidate and publisher metadata to the DBX Store in one PR. Signing
and listing approval belong to Store maintainers; a candidate PR is not a listing.
