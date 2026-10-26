# Shipping changes

How a Drive Home change gets from an idea to the live game. Coding agents and
people follow the same process: branch, verify, review, open a pull request,
get the owner's approval, merge, then check production.

This guide adapts [Landwise's shipping guide](https://github.com/stanqiu111/landwise-resume-career/blob/68a9ea125da6247f58df9792e136912d89314e20/docs/SHIPPING.md)
to this repository. That guide credits Addy Osmani's
[How the Claude Code team does code review](https://x.com/addyosmani/article/2114604912520921136).
The project details are in [CLAUDE.md](../CLAUDE.md) and the
[backend guide](../worker/README.md).

## Principles

- Use several layers: author verification, code review, build checks, owner
  judgment, and a recovery plan. A passing build alone is not proof of correct play.
- Keep changes small and single-purpose. Unrelated fixes get separate PRs.
- Verify findings before reporting them, and fix or explain each finding.
- Scale review effort by risk. Agent approval never replaces owner approval.
- Make mistakes cheap to undo. Record anything a code revert cannot restore.
- Whoever lands a change owns its verification and follow-up fixes.

## 1. Decide, then branch

State the problem, intended behavior, and what is outside the change. Read the
relevant project notes before changing an unfamiliar area.

Start a branch from the latest `origin/main`, after inspecting local changes:

```sh
git fetch origin
git switch -c fix/descriptive-name origin/main
```

Never commit or push directly to `main` as the normal workflow. Pushing `main`
deploys the Vercel game automatically. Old work that already reached `main`
stays in Git history; do not undo and reapply it just to manufacture a PR.

## 2. Verify, and keep the evidence

Use Node.js 22.12+ and the committed lockfile (`npm ci`). Run checks that prove
the changed behavior and record their results in the PR. State which checks
were not possible and why. Do not claim an old test run covers new code.

| Change touches | Run and show |
| --- | --- |
| Any change | Inspect the complete diff and run `git diff --check`. Check for credentials, private files, unrelated edits, and inaccurate documentation. |
| Documentation only | Check local links, commands against `package.json`, and claims against the actual implementation. Application tests are unnecessary unless behavior also changes. |
| Game JavaScript, styles, assets, or build configuration | `npm run build`, which checks road lines on all maps before building the game. |
| Menu, controls, race flow, or other visible UI | Inspect the changed screens on desktop and at 390 px width. Check touch controls, keyboard controls, focus, loading, errors, and reduced-motion behavior where applicable. Drive the affected route and inspect browser errors. Keep screenshots for visible changes. |
| Cars, landmarks, brands, or sounds | Use the appropriate car, landmark, or sound studio and the targeted checks documented in `CLAUDE.md`. Shared car helpers must preserve other cars' appearance. |
| Map builder, route data, lane layout, signals, or road rendering | Follow the map rebuild rules in `CLAUDE.md`; run `npm run check:roads` and inspect affected roads in the game. Do not loosen checks to hide a failure. |
| Worker API, identity, progress, scores, or D1 schema | `npm run test:online` and `npx wrangler deploy --dry-run --config worker/wrangler.jsonc`. Cover the changed behavior and relevant failure paths. A dry run checks packaging, not remote behavior. |
| Dependencies | `npm audit`, relevant release notes, `npm ci` accepting the lockfile, and the affected build/runtime checks. |

Use local D1 for automated tests. Never use real home addresses, private player
records, or production identities as fixtures. Use public places when checking
custom routes. Production QA writes need an explicit plan, isolated test data,
and cleanup; a GET health check is not evidence that score writes work.

Do not stop an existing development server without being asked. The default
game port is 5173 and the local Worker port is 8787. If another port is needed,
keep the frontend API URL and Worker's exact origin allowlist consistent.

## 3. Review before opening the PR

Read the diff again with the relevant checks below. Use a separate reviewer
session for an independent review when available; label an author self-review
honestly if that is the only review performed. High-risk changes need a
security-focused review before merging.

- Does the change solve the stated problem, including failure and offline cases?
- Do tests exercise observable behavior rather than repeat the implementation?
- Do shared renderer or map changes preserve unaffected routes and cars?
- Are API inputs bounded and validated, and identity and score ownership checked?
- Does abuse get rejected before expensive work? Are database reads, writes,
  request loops, and retry behavior bounded appropriately?
- Are credentials, player backups, local agent settings, and private locations
  absent from source, screenshots, logs, and committed history?
- Are free-plan and privacy claims accurate? Does anything enable paid usage?
- Can the old frontend and new Worker coexist during a deployment or rollback?

Fix confirmed findings in scope. Record pre-existing issues separately. Review
new commits after fixes; an earlier review covers only the commits it saw.
After three rounds still finding substantive problems, rethink the approach
with the owner instead of continuing a patch loop.

## 4. Open a pull request

Push the working branch and open a PR against `main`. Include:

- **What and why:** the problem and resulting behavior.
- **Risk:** the tier below and its reason.
- **Testing:** commands and results, screenshots where relevant, review
  performed, and gaps in verification.
- **Deployment:** whether the change needs only Vercel, a separate Worker
  deployment, environment changes, or a database migration, and in what order.
- **How to revert:** the known working version and anything code rollback
  cannot undo.

Every PR gets a review summary before merging. Findings must be fixed or
answered in the PR. Keep the description current if the scope changes.

## 5. Checks and owner approval

Vercel builds pushed branches using this project's build configuration. Inspect
the actual check results on the PR; do not assume Vercel ran the backend tests
or deployed the Worker. Record those checks separately. Do not merge while a
required check fails or a material review finding is unresolved.

The highest applicable risk tier wins:

| Tier | Examples | Evidence and approval |
| --- | --- | --- |
| High | Identity/session handling, leaderboard ownership, spending or abuse limits, D1 schema/data changes, credentials, origins, deployment/build controls, or new dependencies/major upgrades | Security-focused review, relevant passing checks, and the owner reads the diff and evidence. |
| Medium | Game behavior, rendering, maps, controls, frontend online integration, other scripts/tests, dependency patches/minor upgrades, or documentation promising limits, prices, privacy, or saved-data behavior | Clean review, relevant passing checks, and the owner checks the evidence. |
| Low | Other documentation, screenshots, or styling without behavioral or privacy claims | Clean review and relevant passing checks. |

For every tier, the owner merges unless they explicitly ask the agent to merge
in the current conversation. Opening a PR is not permission to deploy. A
review or approval applies to the version reviewed; later changes need review.

## 6. Deploy the right components

- Merging into `main` triggers the Vercel game deployment. Check that the
  intended commit reaches **Ready** and receives the production alias.
- Worker code and binding changes require a separate approved
  `npx wrangler deploy --config worker/wrangler.jsonc`. A Vercel deployment
  does not deploy the Worker.
- D1 schema and data changes require a separate reviewed migration plan.
  Prefer additive, backward-compatible changes; back up data privately and
  verify recovery before destructive changes. Do not rerun cutover imports
  against active players; see the backend guide.
- Environment changes may require a new build. Never put server secrets in
  `VITE_*`, Git, command arguments, or logs.
- Keep Vercel Hobby and Cloudflare Workers Free. Do not enable paid plans,
  trials, add-ons, or paid review APIs without the owner's explicit approval.

For a change spanning game, API, and schema, document the compatible deployment
order before running any production command.

## 7. Check after deployment

Verify the exact deployed commit, rather than just the newest timestamp:

- Confirm the intended Vercel deployment is Ready and the live game loads.
- Open the menu, start the affected route, drive, and inspect browser errors.
  Check mobile controls for changes affecting phone play.
- For online changes, check the live API's `/health`, leaderboard reads,
  allowed and rejected origins, and the changed authenticated behavior using
  the agreed QA plan. Verify local progress still survives an API failure.
- For Worker changes, record the deployed version and verify the required D1
  and rate-limit bindings. Inspect relevant runtime errors.
- Record the outcome in the PR. Delete the merged branch only when it is no
  longer needed for active work or recovery.

## 8. Recover, then learn

Restore the last compatible working Vercel deployment or Worker version for
the component that failed, then verify the live flow again. Avoid rolling the
frontend back to a Supabase-dependent version while the old tables are
read-only. Reverting Worker code does not revert D1 schema or restore deleted
data; use the reviewed database recovery plan instead.

The person who landed the change normally fixes it. Add a meaningful
regression check or update the review guidance for the failure that escaped.

## Enforcement to confirm separately

This document does not configure GitHub rules or CI. Before relying on
automatic enforcement, inspect repository settings and the actual PR checks.
Desired protection for `main` requires PRs, passing applicable checks,
resolved review threads, and blocked force pushes and deletion. With only one
owner, avoid requiring an approval the owner cannot give their own PR.

Automated reviewer services or new GitHub Actions require a separate decision
about permissions and cost. Never expose repository secrets to untrusted fork
code. Merge queues and staged rollouts can be added when the project's needs
justify them.
