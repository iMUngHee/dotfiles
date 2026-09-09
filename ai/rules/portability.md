---
paths:
  - "**/*.sh"
  - "**/*.bash"
  - "**/*.zsh"
  - "**/Makefile"
---

# Portability

Shell that ships to more than one machine has to run on all of them. This config
deploys to macOS, Linux and Windows (Git Bash); assume the same of any script
until you know otherwise.

- Never assume a coreutil is GNU. macOS ships BSD versions; Git Bash ships GNU
  ones over Windows semantics.
- When two spellings exist, **try GNU first and fall back to BSD** — not the
  other way round. BSD refuses a GNU flag it does not have and prints nothing,
  while GNU often *accepts* the BSD letter with a different meaning and answers
  it: `stat -f %m` asks GNU for file-system statistics, and inside one command
  substitution that output is concatenated with the fallback's.
- Give each attempt its own assignment (`v=$(a) || v=$(b)`) rather than chaining
  inside one substitution, so a leaky first attempt cannot merge into the result.
- Comment any line that exists for one platform, so the next reader does not
  remove it as noise.
- Windows breaks three assumptions Unix lets you keep: `jq` writes CRLF because
  it opens stdout in text mode, a file another process holds open cannot be read
  at all, and there are no mode bits for `chmod` to set.
- Say which platforms you actually ran on and which you only reasoned about.
