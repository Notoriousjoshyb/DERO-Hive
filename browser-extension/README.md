# DERO Hive Browser Companion

A standalone Chrome/Edge side-panel extension that puts the current web page into a DERO Hive prompt and streams the model's reply straight back into the browser. It is DERO Hive software, not a Hermes extension and does not require Hermes.

## Install locally

1. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Choose this `browser-extension` folder.
5. Pin **DERO Hive Browser Companion**, open any normal website, then click the extension icon or press **Alt+H**.
6. Open **Hive Companion** in DERO Hive and copy its one-time code into the extension's **Companion settings**, then click **Pair**.
7. Press **Refresh** in the side panel (or **✂ Snip** to drag-select part of a page), add a task or dictate it, then click **Send to Hive**.

## Direct DERO Hive connection

Pairing requires the one-time code displayed by Hive Companion. After the user enters it in the extension settings, Hive issues a random client credential bound to that extension's origin. The extension keeps the credential in local extension storage; Hive persists only its cryptographic hash and the paired origin, so reconnecting works after an app restart without exposing the credential in Hive's database.

While connected:

- **Live streaming** — replies stream token-by-token into the side panel over Server-Sent Events, with the model's thinking in a collapsed section, tool activity chips, and the answer rendered as Markdown in its own card. The timeline auto-scrolls while streaming.
- **Two-way model sync** — changing the provider/model in the extension switches it in DERO Hive's composer, and vice versa.
- **Voice dictation** — recorded audio is transcribed by DERO Hive's bundled local Whisper (fully offline). The first use opens a one-time microphone-permission tab.
- **Single agent guarantee** — requests from the extension always run as a single agent in DERO Hive, never a swarm, and never steal focus from your browser.

The bridge listens only on `127.0.0.1` for the lifetime of the app. Every route checks the loopback host, paired extension origin, and bearer credential. Use **Reset browser pairing** in Hive Companion to revoke the saved credential and generate a new one-time code.

## Features

- Page / drag-to-snip selection / open-tabs context scopes with a transparent "What Hive sees" receipt
- Browser sessions with rename, delete, and **Clear chat**
- Quick commands (Summarize, Explain, Actions, Rewrite) and Ctrl+Enter to send
- Seven themes (Hive, Forest, Midnight, Ember, Mono, Cyberpunk, Light)
- Sensitive-site guard that blocks capture on banking/payment/health domains (toggleable)
- Copy-reply buttons and redacted diagnostics

## Privacy and permissions

The extension uses `activeTab` and `scripting` only after you invoke it on the active tab. The `tabs` permission is used only to list the titles and URLs of open HTTP(S) tabs when you select **Tabs** context. Its only network traffic is the authenticated local DERO Hive bridge at `127.0.0.1:43120`; it has no remote service, cookies/history/bookmarks/download access, and does not control web pages. Captured context and browser sessions are kept in local extension storage. Page text is always wrapped as untrusted reference material before it reaches the model.
