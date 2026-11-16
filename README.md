# telepi

[![Container image](https://github.com/bodav/telepi/actions/workflows/container.yml/badge.svg)](https://github.com/bodav/telepi/actions/workflows/container.yml)

```text
██████ ██████ ██     ██████ ████   ██████
  ██   ██     ██     ██     ██  ██   ██
  ██   ██████ ██     ██████ ████     ██
  ██   ██     ██     ██     ██       ██
  ██   ██████ ██████ ██████ ██     ██████
```

Telegram for people who live in the terminal.

One conversation at a time, messages flowing into your scrollback, a prompt
pinned to the bottom, slash commands, and QR device login — the same shape as
Claude Code, Copilot CLI or pi.

```
  telepi · you (@you)
  ────────────────────────────────────────────────────────────

  09:58  Durov
  Morning! Did you see the new build?

  10:02  you
  Yeah — shipping it today.

  ── Today ───────────────────────────────────────────────────

  10:04  Durov
  │ you: shipping today?
  Docs are at https://core.telegram.org/api/qr-login
  [photo 1600×900 · 180 KB]

  Durov · @durov                                          connected · 15:13
  ╭────────────────────────────────────────────────────────────╮
  │ ❯ message Durov…                                           │
  ╰────────────────────────────────────────────────────────────╯
   enter send · \⏎ newline · ↑ history · /help        telepi 0.1.0
```

## Features

- **QR device login** — scan once from Telegram → Settings → Devices → Link
  Desktop Device. Expired codes refresh themselves; phone + code and 2FA are
  supported as a fallback.
- **A chat, not a dashboard** — open a chat with `/chats`, read it in native
  terminal scrollback, type at the bottom. No alternate screen, no mouse.
- **Slash command palette** — fuzzy autocomplete above the prompt, `/help`
  overlay, `/older` pager for history that has scrolled away.
- **Telegram formatting** — bold, italic, underline, strike, spoiler, inline
  code, pre blocks, links, mentions, quotes and replies.
- **Real client behaviour** — live messages, edits, deletes, typing indicators,
  read receipts, unread counts, message search, reply/edit/delete, clipboard
  copy, media download and file upload.
- **Credentials stay local** — `~/.config/telepi` with `0600` config and a
  `0700` session directory.

## Requirements

- Node.js **22+** (developed on Node 26)
- A terminal with ANSI colours and a TTY (macOS Terminal, iTerm2, Ghostty,
  kitty, WezTerm, Windows Terminal, …)
- A Telegram account and your own API credentials
- Build tools (Xcode command line tools / `build-essential`) only if
  `better-sqlite3` has no prebuilt binary for your Node version

## Install

```bash
cd telepi
npm install
npm run dev
```

To install the `telepi` command globally:

```bash
npm run build
npm link
telepi
```

## Docker

Multi-arch images (`linux/amd64`, `linux/arm64`) are published to GitHub
Container Registry by the `Container image` workflow whenever a version tag is
pushed:

```bash
docker pull ghcr.io/bodav/telepi:latest
```

Run it interactively — the named volume keeps your session and downloads:

```bash
docker run --rm -it -e TERM=xterm-256color -e API_ID -e API_HASH -v telepi-config:/home/node/.config/telepi ghcr.io/bodav/telepi:latest
```

Version tags are published as `X.Y.Z`, `X.Y`, and `latest`, so use a tag such as
`ghcr.io/bodav/telepi:0.1.0` to pin a release. The GHCR package must be public in
the repository's package settings for anonymous pulls; if it is private, run
`docker login ghcr.io` first with a token that has `read:packages`.

Publish a new version by pushing a tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

To build the image locally instead, run `docker build -t telepi .` from the
repository root and replace `ghcr.io/bodav/telepi:latest` with `telepi` in the
commands below.

`API_ID` and `API_HASH` are passed through from your shell; without them telepi
asks for credentials inside the container, exactly like a local run. Scan the
QR code from your terminal as usual, and the login survives restarts of the
container.

To send files with `/attach`, mount a host directory as well:

```bash
docker run --rm -it -e TERM=xterm-256color -e API_ID -e API_HASH -v telepi-config:/home/node/.config/telepi -v "$PWD:/files" ghcr.io/bodav/telepi:latest
```

Then `/attach /files/photo.jpg` sends it from the mounted directory. Replace
`telepi-config` with a path to use a bind mount instead.

## API credentials

Telegram requires an application `api_id` and `api_hash`. telepi asks for them
on the first run and points you at <https://my.telegram.org/apps>. You can also
provide them ahead of time:

```bash
export API_ID=12345678
export API_HASH=0123456789abcdef0123456789abcdef
```

Environment variables win over the stored config and are never written to disk.

## Signing in

1. Start `telepi`.
2. Scan the QR code with Telegram on your phone:
   **Settings → Devices → Link Desktop Device**.
3. Confirm the login on your phone. If your account has two-step verification,
   enter that password in the terminal.
4. Press `p` on the QR screen to sign in with a phone number and login code
   instead. `ctrl+r` resends the code, `esc` goes back.

The session is stored in `~/.config/telepi/session/`; later launches skip the
login entirely.

## Commands

| Command | Description |
| --- | --- |
| `/help` | filterable command list |
| `/chats [filter]` | chat picker overlay |
| `/open <@user\|id\|link>` | open a chat |
| `/bot [command]` | list this chat's bot commands, or forward one (`/bot model`) |
| `/close` | close the current chat |
| `/older` | older messages in a scrollable pager |
| `/jump <id>` | load a message and its context into the feed |
| `/search [all] <query>` | search this chat, or all chats |
| `/reply [id]` | reply to a message (defaults to the last one) |
| `/edit <id> <text>` | edit your message |
| `/delete <id...>` | delete messages |
| `/copy [id]` | copy message text |
| `/save [id\|last] [path]` | download an attachment (defaults to the latest) |
| `/view [id\|last]` | save an attachment and open it |
| `/attach <path> [caption]` | send a photo, video or file from disk |
| `/unread` | chats with unread messages |
| `/login` | show the signed-in account |
| `/me` | account details |
| `/notify off\|bell\|macos` | notifications for other chats |
| `/theme auto\|dark\|light\|mono` | colours |
| `/ids [on\|off]` | show message ids in the feed |
| `/clear` | clear screen and feed |
| `/logout` | sign out (asks twice) |
| `/quit` | leave |

Aliases: `/ls` → chats, `/go` → open, `/del` → delete, `/download` → save,
`/preview` and `/reveal` → view, `/file` and `/upload` → attach, `/goto` and
`/show` → jump, `/whoami` → me, `/bothelp` → bot, `/exit`, `/q` → quit.

`/attach` reads a file from disk: photos are sent as photos, videos stay
videos, and everything else goes as a document. Quote paths that contain
spaces (`/attach "~/Desktop/my file.pdf" look`), use `~` for your home
directory, and add an optional caption in the same Telegram Markdown as normal
messages. Attach while a reply is armed and the file is sent as that reply.
Uploads show progress in the spinner.

`/save` with no arguments saves the newest attachment in the loaded feed;
`/save last ~/Downloads/` does the same with a destination. `/view` saves the
attachment and opens it with your system's default application, which is handy
for screenshots and generated images.

`/ids on` adds a dim `#id` line to messages as they arrive, so you can tell
`/jump` (or `/copy`, `/save`, `/delete`) exactly which message you mean.
Existing terminal scrollback cannot change; `/jump <id>` reloads a message and
a window around it into the feed, where `/copy`, `/reply`, `/save`, and
`/delete` can act on it. Search results and `/older` entries work the same way,
so old agent output is no longer a dead end.

`/name` runs a telepi command when one matches, and is sent to the chat
otherwise — so Telegram bot commands like `/start` work normally. `/name@bot`
always goes to Telegram, and `//name` sends a literal `/name` without running a
telepi command. When a bot command has the same name as a telepi command,
`/bot <command>` forwards it explicitly: `/bot help`, `/bot save`, or
`/bot model openrouter/...`.

The command palette also lists the current chat's bot commands, read from
Telegram: `/start` for a private bot chat, `/command@bot` in groups. When a bot
command has the same name as a telepi command (usually `/help`), the palette
offers the bot's copy as `//help`, while `/help` keeps running telepi. Typing a
bare `/` puts the bot's commands first; use `/bot` to list them in the feed.

`:name` runs a telepi command and never sends anything to the chat; typing `:`
opens a telepi-only palette. This is handy when a bot's menu is noisy. Short
tokens like `:D` or `:ok` are still sent as ordinary text.

Outgoing text is parsed as Telegram-flavoured Markdown: `**bold**`,
`__italic__`, `~~strike~~`, `||spoiler||` and `` `code` ``. Arguments containing
spaces can be quoted: `/open "My Group"`.

## Keys

| Key | Action |
| --- | --- |
| `enter` | send / run command |
| `alt+enter` or `\` + `enter` | newline |
| `↑` / `↓` | input history (or move through menus) |
| `tab` | complete a command / move between credential fields |
| `esc` | close overlay, clear reply, clear input |
| `ctrl+l` | repaint |
| `ctrl+c` | quit |

## Configuration

| Path | Purpose |
| --- | --- |
| `~/.config/telepi/config.json` | credentials, last chat, theme, notifications (`0600`) |
| `~/.config/telepi/session/` | MTProto session, SQLite (`0700`) |
| `~/.config/telepi/downloads/` | `/save` destination |

`XDG_CONFIG_HOME` is respected, and `TELEPI_CONFIG_DIR` overrides the whole
config directory.

The session directory is effectively a password for your account: it grants full
access without another login. Keep it private, don't sync it, and use `/logout`
before handing a machine to someone else.

## CLI

```
telepi                    open the last chat (or the picker)
telepi --chat <peer>      open a specific chat
telepi --login            sign in again from scratch
telepi --logout           sign out and show the login screen
telepi --no-color         disable colours
telepi --verbose          stack traces for fatal errors
telepi --version
```

## Development

```
src/
  cli.tsx               argument parsing, Ink bootstrap, teardown
  core/                 config, text/width, time, entities, clipboard, notify
  telegram/             client, QR/phone auth, peers, messages, media, search
  chat/                 feed builder (day dividers, sender grouping)
  commands/             declarative registry + implementations
  ui/                   App, login, credentials, chat, overlays, input box
test/                   unit tests for the pure layers
```

```bash
npm run dev        # run from source with tsx
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # tsup → dist/cli.js
```

The rendering layer is Ink 8 + React 19; Telegram is [mtcute](https://mtcute.dev);
QR codes come from `qr`; the session uses SQLite through `@mtcute/node`.

## Limitations

- Text-first: incoming photos, video, voice, stickers and documents are shown as
  descriptive placeholders; `/save` downloads them, but there are no inline
  images. `/attach` sends one local file per command.
- One account per config directory. Point `TELEPI_CONFIG_DIR` at another
  directory for a second account.
- No reactions, polls, stories, folders, archived chats or forum-topic
  navigation yet.
- Messages already in terminal scrollback are immutable; an edit or delete of
  an old message prints a dim notification instead of rewriting history.
  `/jump <id>` reloads a context window when you need to act on an old message.
- A QR code for a long login token is roughly 40×40 cells. telepi warns when
  the terminal is too narrow; if the code looks cut off, maximise the window
  before scanning.

## Disclaimer

telepi is an unofficial client built on Telegram's MTProto API. You need your
own API credentials, and you are responsible for how you use it. Do not use it
for spam, scraping or anything that violates Telegram's terms.
