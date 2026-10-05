# Aerix Quest Bot

> **High-Performance Multi-User Discord Quest Auto-Completion Bot**

An advanced, multi-user Discord bot designed to automatically detect, accept, progress, and complete all eligible Discord Quests (Video Streaming, Desktop Client Heartbeat Spoofing, Activity Tasks) in the background for multiple users concurrently.

Built with a clean royal purple aesthetic (`#6D28D9`), closed-box prolog formatting, live progress tracking, dedicated channel access control, and strictly zero emojis.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup & Installation](#setup--installation)
  - [1. Clone Repository](#1-clone-repository)
  - [2. Install Dependencies](#2-install-dependencies)
  - [3. Discord Developer Portal Configuration](#3-discord-developer-portal-configuration)
  - [4. Environment Variables](#4-environment-variables)
  - [5. Run the Bot](#5-run-the-bot)
- [Commands Reference](#commands-reference)
  - [User Commands](#user-commands)
  - [Administrator Commands](#administrator-commands)
- [Channel Restriction System](#channel-restriction-system)
- [Token Extraction Guide](#token-extraction-guide)
  - [Method 1: Network Tab (Recommended · 100% Reliable)](#method-1-network-tab-recommended--100-reliable)
  - [Method 2: Console Runtime](#method-2-console-runtime)
- [Production Deployment](#production-deployment)
  - [Running with PM2](#running-with-pm2)
  - [Running with Systemd](#running-with-systemd)
- [Security & Architecture Notes](#security--architecture-notes)
- [License](#license)

---

## Features

- **Concurrent Multi-User Processing**: Allows multiple server members to run quest auto-completion simultaneously. Features a FIFO queue system when maximum concurrency limits are reached.
- **Persistent Credential Linking**: Users link their Discord token once using `/link` or `c?link`. Future quest sessions can be triggered with `/quest start` or `c?start` without re-entering tokens.
- **All Quest Types Supported**:
  - `WATCH_VIDEO` & `WATCH_VIDEO_ON_MOBILE`: Automated segmented video heartbeat dispatching.
  - `PLAY_ON_DESKTOP`, `PLAY_ON_XBOX`, `PLAY_ON_PLAYSTATION`: Gateway game activity spoofing with periodic heartbeats.
  - `PLAY_ACTIVITY` & `ACHIEVEMENT_IN_ACTIVITY`: Embedded application launch and activity progression.
- **Dedicated Quest Channel Enforcement**: Administrators can restrict all quest commands and button interactions to a specific designated channel. Attempted interactions in other channels are blocked and redirected to the designated channel.
- **Interactive Control Station**: Deploy persistent interactive control panel embeds (`/quest panel` or `c?panel`) with embedded action buttons (`INITIALIZE`, `LINK ACCOUNT`, `DOCUMENTATION`).
- **Live Visual Progress Tracking**: Dynamic updates displaying elapsed runtime, active queue position, overall quest completion percentage, and individual task badges (`VIDEO`, `CLIENT`, `ACTIVITY`).
- **Instant Guild Slash Commands**: Automatic synchronization of application slash commands directly to connected servers for zero-delay command updates.
- **Zero-Emoji Design**: Clean technical aesthetic using ASCII/Unicode box borders, custom small-caps typography, and deep royal purple themes.
- **Token Security**: Tokens entered in server channels via prefix commands are instantly purged from the channel. Modal interactions and slash inputs remain private and ephemeral.

---

## Architecture

```text
aerix-quest-bot/
├── bot.ts                   # Main application entry point
├── src/
│   ├── client.ts            # Discord quest selfbot client & WebSocket spoofing
│   ├── questManager.ts      # Core quest processor (video, game, activity loops)
│   ├── utils.ts             # Token sanitization and validation utilities
│   ├── bot/
│   │   ├── index.ts         # Discord bot lifecycle, gateway events & handlers
│   │   ├── commands.ts      # Slash command definitions & guild/global registration
│   │   ├── embeds.ts        # Purple closed-box UI embeds & buttons
│   │   ├── taskManager.ts   # Concurrency manager & FIFO queue scheduler
│   │   ├── linkManager.ts   # Persistent user credential storage
│   │   ├── settingsManager.ts # Per-guild channel restriction configuration
│   │   └── types.ts         # TypeScript interfaces and data models
├── data/                    # Local storage (git-ignored for security)
│   ├── linked_accounts.json # Encrypted/stored user session mappings
│   └── guild_settings.json  # Guild channel configurations
├── .env.example             # Template environment configuration
├── package.json             # Project dependencies and run scripts
└── tsconfig.json            # TypeScript compiler configuration
```

---

## Prerequisites

- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm** or **yarn** / **pnpm**
- A **Discord Bot Token** from the [Discord Developer Portal](https://discord.com/developers/applications)

---

## Setup & Installation

### 1. Clone Repository

```bash
git clone https://github.com/Bihariaayu/aerix-quest-bot.git
cd aerix-quest-bot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Discord Developer Portal Configuration

1. Visit the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and give your bot a name (e.g. `Aerix Quest`).
3. Navigate to the **Bot** tab on the left sidebar:
   - Click **Reset Token** and copy your **Bot Token**.
   - Under **Privileged Gateway Intents**, enable:
     - **Message Content Intent** (Required for prefix `c?` commands)
     - **Server Members Intent**
4. Navigate to **OAuth2 ➔ URL Generator**:
   - Under **Scopes**, select `bot` and `applications.commands`.
   - Under **Bot Permissions**, select:
     - `Send Messages`
     - `Embed Links`
     - `Attach Files`
     - `Read Message History`
     - `Manage Messages` (Allows the bot to purge tokens typed in chat for security)
     - `Use Slash Commands`
   - Copy the generated URL and use it to invite the bot to your server.

### 4. Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` and fill in your credentials:

```ini
# Discord Bot Application Token (Required)
DISCORD_BOT_TOKEN=your_bot_token_here

# Discord Application Client ID (Optional, extracted automatically if omitted)
DISCORD_CLIENT_ID=your_client_id_here

# Maximum concurrent user quest tasks running at once (Default: 5)
MAX_CONCURRENT_USERS=5

# Optional: Webhook URL for global quest event logging
WEBHOOK_URL=

# Optional: YesCaptcha API key (for rare captcha challenges)
YES_CAPTCHA_API_KEY=
```

### 5. Run the Bot

To start the bot in development / standard mode:

```bash
npm run start
```

Upon starting, the bot will:
- Connect to Discord Gateway.
- Register global and guild-specific slash commands for instant client availability.
- Initialize the task manager and local data storage.

---

## Commands Reference

The bot supports both Slash Commands (`/...`) and Prefix Commands (`c?...`).

### User Commands

| Slash Command | Prefix Command | Description |
| :--- | :--- | :--- |
| `/quest start [token]` | `c?start` | Start auto-completing quests for your account. If an account is already linked, it starts immediately. |
| `/link [token]` | `c?link <token>` | Link your personal Discord account token. Quests can then be started with 1 click. |
| `/unlink` | `c?unlink` | Remove your linked account credentials from the bot. |
| `/quest status` | `c?status` | View real-time progress, time elapsed, and quest statuses. |
| `/quest stop` | `c?stop` | Terminate your active or queued quest execution session. |
| `/help` or `/quest help` | `c?help` | Display interactive documentation and token extraction instructions. |

### Administrator Commands

*Requires `Manage Server` or `Administrator` permissions.*

| Slash Command | Prefix Command | Description |
| :--- | :--- | :--- |
| `/setchannel <channel>` | `c?setchannel [#ch]` | Restrict all quest commands to the specified channel. |
| — | `c?setchannel` | Sets the current channel as the designated quest channel. |
| `/clearchannel` | `c?clearchannel` | Remove channel restriction, allowing commands across all channels. |
| — | `c?channel` | Check which channel is currently designated for quest commands. |
| `/quest panel` | `c?panel` | Deploy a persistent interactive quest station embed in the channel. |

---

## Channel Restriction System

When a designated quest channel is configured:
1. All non-admin quest commands (`c?help`, `c?link`, `c?start`, `c?status`, `c?stop`, etc.) and slash commands used outside the designated channel are rejected.
2. The bot responds with a closed-box notification:
   ```text
   ◈ NOTICE: If you want to use the quest bot, please use #designated-channel.
   ```
3. A **`[ GO TO CHANNEL ]`** link button is provided to navigate directly to the allowed channel.
4. Admins can continue managing configuration commands (`/setchannel`, `c?setchannel`, `c?clearchannel`) from any channel.

---

## Token Extraction Guide

To complete quests on behalf of your Discord account, the bot requires your user authorization token.

### Method 1: Network Tab (Recommended · 100% Reliable)

*Works on every desktop browser and Discord client without running scripts:*

1. Open Discord in your desktop browser (`discord.com/app`) or Discord app.
2. Press **`Ctrl + Shift + I`** (Windows/Linux) or **`Cmd + Option + I`** (macOS) to open Developer Tools.
3. Select the **Network** tab at the top.
4. In the filter box, type `/api` or `messages`.
5. Click on any channel or press **`Ctrl + R`** to reload.
6. Click any request that appears in the list (e.g. `messages`, `science`, `@me`).
7. In the right panel, select **Headers** and scroll down to **Request Headers**.
8. Copy the value next to **`Authorization`**.

### Method 2: Console Runtime

1. In Developer Tools, switch to the **Console** tab.
2. Paste and run the following script:
   ```javascript
   window.webpackChunkdiscord_app.push([[Symbol()],{},e=>{for(let c in e.c){let x=e.c[c]?.exports;if(x?.default?.getToken){console.log(x.default.getToken());return;}if(x?.getToken){console.log(x.getToken());return;}}}]);
   ```
3. Copy the clean token string printed in the console.

To link your token:
```text
c?link <your_token>
```
or use `/link` with the optional `token` parameter.

---

## Production Deployment

### Running with PM2

[PM2](https://pm2.keymetrics.io/) is recommended for production 24/7 uptime:

```bash
# Install PM2 globally
npm install -g pm2

# Start the bot daemon
pm2 start npm --name "aerix-quest-bot" -- run start

# Save PM2 process list to restart on system reboot
pm2 save
pm2 startup
```

Useful PM2 commands:
- `pm2 logs aerix-quest-bot` - View live logs
- `pm2 restart aerix-quest-bot` - Restart the bot
- `pm2 status` - View resource usage

### Running with Systemd

Create a service file at `/etc/systemd/system/aerix-quest.service`:

```ini
[Unit]
Description=Aerix Quest Discord Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/path/to/aerix-quest-bot
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=10
EnvironmentFile=/path/to/aerix-quest-bot/.env

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable aerix-quest
sudo systemctl start aerix-quest
```

---

## Security & Architecture Notes

- **Credential Purging**: Any user tokens sent as text messages in guild channels (e.g. `c?link <token>`) are automatically deleted by the bot within milliseconds to prevent exposure in chat logs.
- **Local Storage**: User tokens and guild settings are stored locally in the `data/` directory (`linked_accounts.json` and `guild_settings.json`). This directory is strictly ignored by `.gitignore` to prevent leaking credentials to version control.
- **Concurrency Isolation**: Each user quest execution runs inside an isolated worker instance with independent progress states and cancellation controllers.
- **Token Scrubbing**: Once a task terminates (whether completed, stopped, or failed), session tokens in memory are immediately dereferenced and garbage collected.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
