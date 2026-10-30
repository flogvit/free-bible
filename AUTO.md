# AUTO.md — flogvit/free-bible

How Dux builds, tests, deploys, verifies, rolls back and patches free-bible.
Format: [Grensesnitt/grensesnitt-auto](https://github.com/Grensesnitt/grensesnitt-auto) (`docs/reference.md`). Facts read on 2026-10-29 from main of this repository and of flogvit/flogvit-com-server (`README.md`, `package.json`; `deploy-bibel-data.sh`).

Open Bible translations and their generators. The Bible app reads this text: `server/deploy-bibel-data.sh` imports it locally and replaces the content tables in prod, table by table in one transaction each, then restarts bibel-hono.

## about

```yaml
version: 1
repository: flogvit/free-bible
default_branch: main
description: free-bible, open Bible translations and the generators that build them; the text bible.flogvit.com reads
work_queue: the Dux work queue for flogvit/free-bible (GitHub issues labelled dux)
checked: "2026-10-29"
```

## stack

```yaml
packages:
  - path: "."
    language: TypeScript (Bun)
    runtimes:
      - name: bun
        version: "OPEN: not pinned"
        pinned_in: nothing
    package_manager: bun
    lockfile: bun.lock
  - path: kvn
    language: TypeScript (the @free-bible/kvn package)
    runtimes:
      - name: bun
        version: "OPEN: not pinned"
        pinned_in: nothing
    package_manager: bun
    lockfile: kvn/bun.lock
```

## build

```yaml
steps: []
```

## test

```yaml
gate:
  - run: bun run test
    cwd: "."
  - run: bun run test
    cwd: kvn
green: exit code 0 from both (bun run test:all)
```

## deploy

```yaml
deploys_from: main
environments:
  prod:
    mechanism: vm-ssh
    start:
      on: command
      command: bash server/deploy-bibel-data.sh
      cwd: the flogvit.com workspace root, with free-bible (symlinked as flogvit.com/free-bible) and bibel/ on a clean origin/main
    target:
      database: the content tables of the Bible app's database on the managed MySQL db-flogvit, reached with the mysql client on flogvit-vm and bibel.env
      host: flogvit-vm (ssh alias)
      restarts: bibel-hono
    order:
      - import the text locally into the DBngin MySQL in bibel/.env (scripts/import-bible.ts)
      - "for each content table: dump locally and load into prod in one transaction (START TRANSACTION; DELETE; INSERT; COMMIT)"
      - restart bibel-hono (it caches the books table at start)
      - tag free-bible; the RELEASE.md post goes in bibel/ when readers see the change (server/README.md «deploy <navn>»)
    downtime:
      policy: anytime
      reason: readers see the old content until each table's COMMIT; the bibel-hono restart is the same as a deploy, which already runs at any time; a kernel reboot is still a step
    patch_effect:
      - kind: restart
        what: bibel-hono restarts to read the new books table; Caddy holds requests while it starts
        length: up to 20 s
      - kind: reboot
        what: a kernel update on flogvit-vm, which takes down every flogvit.com product on it
    verify:
      checks:
        - url: https://bible.flogvit.com/en
          expect: "200"
        - command: bash server/smoke.sh bibel-hono
          expect: exit code 0
    rollback:
      backup: "OPEN: no dump of the prod content tables is taken before they are replaced"
      undo: "In a worktree of free-bible at the previous tag: bash server/deploy-bibel-data.sh (the content is derived from this repository, so the previous text can be loaded again)"
```

## secrets

```yaml
sources: []
```

## owner-only

```yaml
- area: publishing
  what: the licences of the translations and what is published as free
- area: host-restart
  what: a reboot of flogvit-vm
```

## do-not-touch

```yaml
protected_branches:
  - main
migrations:
  path: null
  rule: There are no migration files.
customer_prod_rules: []
```

## guards

```yaml
worktree: own
force_push: never
main: work-queue-merge-only
extra:
  - deploy-bibel-data.sh touches only the import-owned content tables; user tables (user_*, sessions) are never touched.
```

## security

```yaml
thresholds:
  auto_to_prod: 9.0
  to_queue: 7.0
dependency_patch:
  how: bun update <package> so bun.lock changes; run the test gate
  rollout: merge to main; the text reaches prod with bash server/deploy-bibel-data.sh
runtime_patch:
  how: the Bun on the machine that imports
  rollout: nothing runs in prod from here
```
