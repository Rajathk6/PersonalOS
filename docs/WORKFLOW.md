# WORKFLOW — branches, test cycles, releases (SDLC, plain English)

## Branches (what lives where)

- `main` — **stable releases only.** Nothing gets committed here directly, ever.
  Every commit on `main` is a merge from `develop` that passed the full test cycle.
  If anything breaks, we roll `main` back to the previous release tag.
- `develop` — **integration branch.** All finished feature work lands here via
  pull requests. This is the branch agents and humans work against day to day.
- `feature/<what>` — **one branch per bundle of work** (e.g.
  `feature/phase-0-bundle-0a`). Branched off `develop`, merged back via PR.
  Short-lived: merged and deleted, never left rotting.

```
feature/* --PR--> develop --release--> main (tagged v0.1, v0.2, ...)
```

## Rules (no exceptions)

1. **Never commit to `main` or `develop` directly.** All changes ride a `feature/*`
   branch + pull request. (Docs-only typo? Still a feature branch. Cheap and safe.)
2. **One bundle per PR.** A PR maps to one ROADMAP bundle (0A, 0B, …). Small enough
   to review in one sitting; big enough to be worth verifying.
3. **Verify before merge, once per bundle** (the test cycle):
   `npm run typecheck` + `npm run lint` + `npm test` green, plus the bundle's own
   runtime checks (boot, migrate, live HTTP, recovery simulation — see ROADMAP).
   Paste the results into the PR description. Red = no merge.
4. **No CI until first prototype** (decision 2026-10-08): the merger pastes
   verification evidence into the PR body and a second look (human or agent)
   confirms it. CI returns in one small PR once Phase 1 works end to end.
5. **`main` releases are deliberate:** when `develop` is green and a milestone is
   done, open a PR `develop → main`, verify again, merge, then tag
   (`git tag v0.x && git push --tags`). Tag message = what the release proves.
6. **Roll back, don't patch forward on `main`.** If a release breaks:
   `git revert` the release merge on `main` (history stays honest), fix on a
   feature branch against `develop`, re-release.
7. **Every PR updates the paper trail:** `PROGRESS.md` (what this bundle did +
   verification evidence) and `docs/DECISIONS.md` (any new decision). No silent work.

## What "verified" means per bundle (test cycles, SDLC style)

| Cycle | When | What runs |
|---|---|---|
| Static | every PR | typecheck, lint, unit tests (local; CI returns post-prototype) |
| Runtime | every bundle | DB migrate, service boot, live request checks |
| Recovery | bundles with state (0C, 1, 5) | kill/restart mid-task, stale-lease requeue, catch-up |
| Release | develop → main | full static + runtime + recovery re-run on the merge |

Fragile hardware reality (power cuts, 1 Mbps) is why recovery testing is a named
cycle, not an afterthought.
