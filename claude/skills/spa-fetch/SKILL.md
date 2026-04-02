---
name: spa-fetch
description: "Fetch rendered content from SPA sites using Playwright. Use when WebFetch fails on JS-rendered pages, or when asked to fetch/read SPA or authenticated internal sites."
argument-hint: "<url> [css-selector] [--html]"
allowed-tools: Bash, Read, AskUserQuestion
model: sonnet
---

Fetch rendered content from a JavaScript-heavy SPA site.

Arguments: $ARGUMENTS

## Script

`~/.config/claude/skills/spa-fetch/spa-fetch.js`

## Steps

### 1. Headless fetch

```bash
node ~/.config/claude/skills/spa-fetch/spa-fetch.js <url> [css-selector] [--html]; echo "EXIT:$?"
```

Use `dangerouslyDisableSandbox: true` and `timeout: 45000`.

Check the `EXIT:` line in stdout to determine the result:

- **EXIT:0**: success — go to step 3
- **EXIT:10**: login required — go to step 2
- **EXIT:1**: error — report to user

### 2. Login flow (only if exit code 10)

Run the login browser in background:

```bash
node ~/.config/claude/skills/spa-fetch/spa-fetch.js --open-login <url>
```

Use `dangerouslyDisableSandbox: true`, `timeout: 300000`, and `run_in_background: true`.

Then **immediately** use AskUserQuestion:
> 로그인이 필요합니다. 브라우저가 열렸으니 로그인해주세요. 로그인 완료 후 자동으로 닫힙니다. 닫히면 알려주세요.

When user confirms, retry step 1.

### 3. Output

Present the fetched content, or use it for the requested analysis.

## Rules

- Always use `dangerouslyDisableSandbox: true`
- Do NOT combine --open-login with fetch in a single call
- If script not found, run `cd ~/.config/claude/skills/spa-fetch && npm install`
