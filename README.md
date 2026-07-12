<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:8B5CF6,100:22D3EE&height=170&section=header&text=cc-token-doctor&fontColor=ffffff&fontSize=44&fontAlignY=40&desc=Diagnose%20and%20fix%20Claude%20Code's%20token%20drain&descSize=17&descAlignY=64" width="100%" />

[![npm version](https://img.shields.io/npm/v/cc-token-doctor?style=for-the-badge&logo=npm&logoColor=white&color=8B5CF6)](https://www.npmjs.com/package/cc-token-doctor)
[![license MIT](https://img.shields.io/badge/license-MIT-A855F7?style=for-the-badge)](LICENSE)
[![aidhd.co](https://img.shields.io/badge/aidhd.co-22D3EE?style=for-the-badge&labelColor=0D1117)](https://aidhd.co)

</div>

Since late March 2026, Claude Code users have been burning through tokens at 10-20x the expected rate. Max 5x subscribers ($100/month) exhaust session windows in 90 minutes. Max 20x users ($200/month) hit 100% on a single prompt.

CC Token Doctor tells you exactly what's wrong and fixes it.

## Quick Start

```bash
npx cc-token-doctor
```

That's it. One command. No install needed. It will:

1. **Scan** your Claude Code sessions automatically
2. **Show you** what's wrong in plain English
3. **Explain** each fix — what it does, what it touches, how to undo it
4. **Fix it** if you say yes (with full backup)

## What It Checks

- **Cache health** — is your prompt cache actually working, or is Claude re-reading everything from scratch?
- **Cache TTL** — is your cache expiring every 5 minutes instead of lasting an hour?
- **Peak hours** — are you working during Anthropic's throttled window (weekdays 5-11am PT)?
- **Token spikes** — are individual messages using way more tokens than they should?
- **Session resumes** — does coming back to a session break your cache?

## Web Dashboard

Run the diagnostic, then open the visual dashboard to see your results:

**[aidhd.co/token-doctor](https://aidhd.co/token-doctor)**

Drop your report file in and get a full visual breakdown — color-coded health indicators, token usage charts, and plain-English explanations.

## Commands

```bash
npx cc-token-doctor              # Full diagnostic + offer to fix
npx cc-token-doctor --fix        # Apply recommended fixes
npx cc-token-doctor --undo       # Restore everything to original state
npx cc-token-doctor --diagnose-only  # Just diagnose, don't offer fixes
npx cc-token-doctor --all        # Scan all sessions (not just last 30 days)
npx cc-token-doctor --no-open    # Skip the "open dashboard?" prompt
npx cc-token-doctor --list-patches   # Show all available patches
```

## How The Fixes Work

Every fix explains itself before applying. You choose: apply all, pick one by one, or skip.

### Attribution Header (Safe — no files modified)
Claude Code sends a tracking header that changes between turns, breaking cache stability. This sets an environment variable to disable it.

### 1-Hour Cache TTL (Low risk — backup created)
The default 5-minute cache TTL means any pause longer than 5 minutes throws away your entire cache. This unlocks the 1-hour TTL that already exists in the code but is locked behind a feature flag.

### Cache Prefix Stabilizer (Low risk — backup created)
When you resume a session, some data isn't saved properly, so the cache can't match the original conversation. This fix ensures all data types are persisted so resumes work cleanly.

All binary patches create a full backup before making changes. Run `npx cc-token-doctor --undo` to restore everything.

## Privacy

- All data stays on your machine
- No data is uploaded anywhere
- The web dashboard runs entirely in your browser — the JSON never leaves your computer
- Open source — read the code yourself

## Credits

Built on research by the Claude Code community:

- **[Rangizingo](https://github.com/Rangizingo/cc-cache-fix)** — patch discovery and implementation
- **[flightlesstux](https://github.com/flightlesstux/prompt-caching)** — API-level caching research
- **[kitaekatt](https://github.com/kitaekatt/cache-kit)** — cache reporting
- **Community bug reporters** — GitHub issues [#38335](https://github.com/anthropics/claude-code/issues/38335), [#38029](https://github.com/anthropics/claude-code/issues/38029), [#37436](https://github.com/anthropics/claude-code/issues/37436), [#34410](https://github.com/anthropics/claude-code/issues/34410)

## License

MIT

## About

Built by [Marta Varen](https://aidhd.co). Part of [AIDHD](https://aidhd.co): guides, tools, and open knowledge for human × AI companionship.
