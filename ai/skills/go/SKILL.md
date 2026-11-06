---
name: go
description: "Write, review, or port Go with the toolchain as the feedback loop: go vet, staticcheck, race-enabled tests and gremlins mutation checks, dependency APIs at the exact go.mod version, and the Go style references. Skip non-Go work and questions that need no code."
argument-hint: "[Go task, package, or file]"
allowed-tools: Bash, Read, Grep, Glob
disable-model-invocation: false
---

Go work for: $ARGUMENTS

## Feedback loop

Run these from the module root (the directory with `go.mod`; in a `go.work` workspace, from each module you changed), in order, and fix what each reports before moving on. No hook runs any of them for you — the hooks only run `gofmt` — so this loop is the check.

1. `go vet ./...`, then `staticcheck ./...` when `staticcheck -version` answers. A project with `.golangci.yml` (or `.golangci.yaml`/`.toml`) uses `golangci-lint run` instead: its config is the lint policy. Treat every finding as work unless the project excludes it.
2. Tests: `go test -race ./...`. `-race` needs cgo: if the project or the environment sets `CGO_ENABLED=0` (a Makefile `export CGO_ENABLED := 0` does), run the tests with `CGO_ENABLED=1` and a C compiler, and say so if neither is available rather than dropping `-race` silently.
3. Before calling a logic change done, check that the tests would notice it breaking, when `gremlins --version` answers:

   ```bash
   GOFLAGS=-count=1 gremlins unleash --diff <start>   # <start> = the commit this work began from
   ```

   `GOFLAGS=-count=1` is required: with Go's test cache warm the baseline runs in no time, gremlins derives its timeout from it, and sound mutants come back `TIMED OUT`. `--diff` limits the run to changed lines, new untracked files included. The exit status is 0 whatever the result — the `--threshold-*` flags do not change it — so read the lines: `LIVED` is a test gap (add an assertion that fails on that mutation), `NOT COVERED` is code no test reaches, `TIMED OUT` points at the cache or a slow test, and `Killed: 0, Lived: 0, Not covered: 0` means nothing was checked. Do not write a test that restates the implementation to kill a mutant; leave a truly equivalent one and say why. Skip this step for docs, formatting, and pure renames.

Tests are the oracle. Never change an existing test's expectation to make it pass unless the task changes that behaviour, and say so when it does.

## Dependency APIs: the go.mod version, not memory

- Which version is in use and where its source is: `go list -m -f '{{.Path}} {{.Version}} {{.Dir}}' <module>` — read the code under that directory.
- Its API at that version: `go doc <package>` or `go doc <package>.<Symbol>` from the module root; module mode resolves the version `go.mod` requires.
- With an LSP tool available, hover and go-to-definition (gopls) give the same version's docs and signature.
- A module that is not a dependency yet: `go list -m -versions <module>` for its releases, then that version's page on pkg.go.dev.

## Style references

Read the part that bears on the task, not the whole text; fetch when needed. Precedence: the project's own conventions, then these in order.

1. Go Code Review Comments — the review checklist: https://go.dev/wiki/CodeReviewComments
2. Effective Go — idioms behind the checklist: https://go.dev/doc/effective_go
3. Google Go Style Guide — decisions and best practices where the first two are silent (naming, errors, docs, tests): https://google.github.io/styleguide/go/ (Guide, then Decisions, then Best Practices)

staticcheck's default `ST` checks enforce some of these (ST1005 error strings, ST1016 receiver names); cite the check ID or the section when one drives a change.
