# VYBE — Peer-to-Peer Study Room

> **Your Space. Your People. Your VYBE.**

A decentralised study room where two students connect **browser to browser** with WebRTC and chat through an `RTCDataChannel`. **No central database and no message-storage server is used.** Messages are never sent to, stored on, or forwarded by any server.

| | |
|---|---|
| **Live app** | `https://<github-username>.github.io/P2P_App/submissions/<group-name>/` ← *fill in after deploying* |
| **Course** | B.Tech CSE, UPES — Group Assignment: Decentralised (P2P) Web Application |
| **Group name** | `<group-name>` ← *fill in* |

## Team members and contributions

> ⚠️ **Fill this in yourselves.** Every member must have commits under their own GitHub account (checked from Git history).

| Member | SAP ID | GitHub username | What this member did |
|---|---|---|---|
| *(name)* | *(SAP ID)* | *(username)* | *(e.g. WebRTC connection code, README, testing …)* |
| *(name)* | *(SAP ID)* | *(username)* | |
| *(name)* | *(SAP ID)* | *(username)* | |
| *(name)* | *(SAP ID)* | *(username)* | |

## 1. Project overview

VYBE lets two students create a study room and chat in real time without any chat server. Because there is no signalling server either, the two browsers exchange their connection details through a short **invite** (a link and QR code) and a short **reply** (a code and QR code). These replace the WebRTC *offer* and *answer*. Once the WebRTC DataChannel opens, all messages travel directly between the two devices.

## 2. Problem statement

Most chat apps route every message through a company server that stores and forwards it. That means a central point of failure, cost, and privacy exposure. The assignment asks us to build an app where users' devices exchange data **directly** and to solve the real problems that decentralised systems create (lost history, duplicates, ordering, malicious input, late joiners).

## 3. Objectives

- Establish a real WebRTC peer-to-peer connection with no custom backend.
- Exchange chat messages through an `RTCDataChannel`.
- Solve at least four decentralised-system problems (we solved four plus a bonus).
- Host as a static website on GitHub Pages.
- Provide a clean, responsive UI and understandable code.

## 4. Features

- Create a room and get a **shareable invite link and QR code** (about 300 characters, not 1000+). Opening the link or scanning the QR joins automatically and prepares the reply.
- Reply code + QR; the host **connects automatically on paste** (or by scanning where the browser supports it)
- Copy, Paste, Share and Scan buttons
- Honest connection states: *Preparing, Waiting for answer, Connecting, Connected, Disconnected, Failed*. **"Connected" appears only once the DataChannel is really open.**
- Real-time chat: Enter to send, timestamps, sender/receiver bubbles, day dividers
- Chat history saved locally; offline view of saved chats from the dashboard
- Duplicate prevention, consistent ordering, input validation
- History synchronisation with the connected peer
- Connection info panel (role, peer, route type, ICE state, counters)
- Clear chat (local copy only), leave room, reconnect
- Responsive layout (desktop, laptop, phone)

## 5. Technologies used

HTML5, CSS3, vanilla JavaScript, WebRTC (`RTCPeerConnection`, `RTCDataChannel`), LocalStorage, GitHub Pages.

**Services and libraries credited:**

- **Google public STUN servers** (`stun:stun.l.google.com:19302`, `stun1.l.google.com:19302`) — only to discover each device's public address. No chat data goes through STUN.
- **QR code generator** — bundled copy of *QRCode for JavaScript* by Kazuhiko Arase (MIT license, http://www.d-project.com/), taken from the `qrcode-terminal` npm package. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
- **Google Fonts** — *Bricolage Grotesque* and *DM Sans* (cosmetic; the app falls back to system fonts offline).
- No frameworks, no npm packages in the app itself. (Playwright is used only for the optional automated test.)

## 6. How peer-to-peer communication works

In a normal chat, `You → Server → Friend`. In peer-to-peer, `You ↔ Friend`: each browser talks directly to the other. Before they can, they must learn each other's network addresses and capabilities. That exchange is called **signalling**. Usually a server does it. VYBE does it **manually** with two pasted codes, so no server is needed at all. After the connection exists, the signalling step is finished and never used again.

## 7. WebRTC architecture

```
   Student A (host)                                   Student B (guest)
 ┌──────────────────┐                              ┌──────────────────┐
 │ RTCPeerConnection│                              │ RTCPeerConnection│
 │  createDataChannel                              │  ondatachannel   │
 └────────┬─────────┘                              └─────────┬────────┘
          │  1. createOffer + wait for ICE gathering          │
          │  ── INVITE (link or QR → opened by friend) ───────▶│ 2. setRemoteDescription
          │                                                    │    createAnswer + wait for ICE
          │◀─ REPLY (code or QR → pasted/scanned by host) ─────│
          │  3. setRemoteDescription(answer)                   │
          │                                                    │
          │◀════════ ICE finds a path (STUN helps) ═══════════▶│
          │◀════════ RTCDataChannel OPEN = connected ═════════▶│
          │            chat / hello / history packets          │
```

Files: `js/webrtc.js` (connection only), `js/chat.js` (messages, storage, validation — no DOM, no WebRTC), `script.js` (user interface that glues them together).

## 8. Connection establishment steps (for a beginner)

1. **Student A**: Dashboard → *Create Study Room* → type a room name → *Create invite*. Wait a few seconds. A QR code and a link appear.
2. A shows the QR to B, or sends the link (WhatsApp, e-mail, anything).
3. **Student B** (another device): scans the QR with the phone camera, or taps the link. VYBE opens, reads the invite and **creates the reply automatically** (QR + code).
4. B sends the reply code back to A (copy/share), or shows its QR to A.
5. **A**: pastes the reply into step 3. It **connects by itself on paste** (or press *Connect*; or *Scan QR* where supported).
6. Both browsers open the study room automatically **when the DataChannel opens**.

**Why can't it be one-step?** A WebRTC connection needs information to travel *both ways* (A→B and B→A). Without any server, the second leg (the reply) has to be carried by the users. A truly one-scan connection would need a signalling server (e.g. a public relay used only to pass these small connection messages). That was deliberately not used here to keep the project server-free; it is listed under *Possible future work*.

If a code is wrong, damaged, of the wrong type, or created in the same browser, VYBE shows a clear message instead of failing silently.

### How the codes are kept short

A raw WebRTC description (SDP) is about 1000 characters, mostly boilerplate. A data-channel-only connection really needs just the ICE username/password, the certificate fingerprint and a few network candidates. `compactSdp()` keeps only those (UDP candidates, at most 5) and `expandSdp()` rebuilds a full SDP on the other side. Result: about 300 characters, small enough for a QR code. Every field of a pasted code is checked against strict patterns before it is placed into an SDP (so a malicious code cannot inject extra SDP lines).

## 9. Problems solved and how

Assignment problem numbers are from Section 3 of the assignment PDF.

| # | Problem | Our solution | Where |
|---|---|---|---|
| 2 | **Data lost on refresh** | Every message is saved to the browser's LocalStorage; chat is reloaded (and re-validated) on open. LocalStorage is only *this user's own copy* — not a shared database. | `chat.js` → `openRoom`, `saveCurrent` |
| 4 | **Duplicate messages** | Every message gets a unique ID (`crypto.randomUUID`). Before adding any live or synced message the ID is checked against a `Set`. Duplicates are counted and dropped. | `chat.js` → `insert` |
| 3 | **Messages in the wrong order** | Each message carries a **sequence number** from a logical clock: send → `seq = clock + 1`; receive → `clock = max(clock, seq)`. Sorting is by `seq`, then timestamp, sender ID, message ID — the same on every device, so we do not trust device clocks alone. | `chat.js` → `compareMessages` |
| 9 | **Malicious input** | Every packet is parsed defensively: size limit, JSON check, allowed packet types, strict field validation, 1000-character limit, control/bidi characters stripped, extra fields discarded, spoofed sender rejected. Text is drawn with `textContent`, **never** `innerHTML`, so peer HTML/JS cannot run. | `chat.js` → `parsePacket`, `validateMessage`; `script.js` → `renderMessages` |
| 1 *(bonus)* | **Late joiners see no history** | On connect each side sends `history-request`; the other replies with its saved messages in batches of 20 over the DataChannel. Messages are merged by ID, then re-sorted. | `script.js` → `sendHistory`; `chat.js` → `mergeMessages` |
| 5 *(partly)* | **Peers cannot connect** | We do **not** solve this fully. We show plain-language failure messages and advice (same Wi-Fi / hotspot). A TURN relay would be needed. | `webrtc.js`, UI notice |

**Message format** (every chat message):

```json
{ "id": "uuid", "senderId": "uuid", "content": "text", "timestamp": 1732450000000, "seq": 12, "type": "chat" }
```

## 10. Installation and setup

There is nothing to install. It is a static site: `index.html`, `style.css`, `script.js`, `js/webrtc.js`, `js/chat.js`, `assets/logo.svg`.

## 11. How to run locally

WebRTC and clipboard features need `http://localhost` or `https://` (not a plain `file://` double-click).

```bash
cd VYBE
python3 -m http.server 8080
# open http://localhost:8080
```

For a phone to open a locally created invite, use the computer's LAN address (for example `http://192.168.1.20:8080/`), allow port 8080 through the firewall, and keep both devices on the same Wi-Fi. The recommended two-device test is the live GitHub Pages URL. An invite made from `file://`, `localhost`, or a temporary preview URL cannot be opened by another device.

To try it on one computer, open two **different browser profiles** (e.g. a normal window and a private/incognito window). Two tabs of the *same* profile share LocalStorage and VYBE blocks that on purpose. For the real test use **two devices**.

## 12. GitHub Pages deployment and submission

Replace `<username>`, `<group-name>` with your own values.

1. **Fork** `https://github.com/Yogeshrathia07/P2P_App` (only one member). Add the other three as collaborators: *Settings → Collaborators*.
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<username>/P2P_App.git
   cd P2P_App
   ```
3. **Add the project folder** (copy the contents of this `VYBE/` folder):
   ```bash
   mkdir -p submissions/<group-name>
   cp -r /path/to/VYBE/* submissions/<group-name>/
   ```
   Do **not** change any file outside `submissions/<group-name>/`.
4. **Each member commits with their own account** (so the history shows everyone):
   ```bash
   git add submissions/<group-name>
   git commit -m "Describe your change"
   git push
   ```
5. **Enable GitHub Pages** on the fork: *Settings → Pages → Deploy from a branch → `main` → `/ (root)` → Save*. The app appears at
   `https://<username>.github.io/P2P_App/submissions/<group-name>/` (wait 1–2 minutes).
6. **Open the pull request**: on your fork *Contribute → Open pull request*, base repository `Yogeshrathia07/P2P_App`, branch `main`.
   Title: `<group-name>: VYBE — Peer-to-Peer Study Room`. In the description write the members' names, SAP IDs and the live link.
7. Keep pushing to the same fork until the deadline; the PR updates automatically. Commits after the deadline are not considered.

> Test the **live GitHub Pages URL** on two real devices before submitting.

## 13. Testing

### 13a. Tests that were actually run (automated, on one computer)

Run during development in a headless Chromium browser. These used **two separate browser profiles** (separate LocalStorage) on the *same machine and network*, connected through a real `RTCPeerConnection` / `RTCDataChannel`.

| Check | Result |
|---|---|
| Unit tests of `chat.js` / code parsing (`node tests/chat.test.js`): validation, duplicates, ordering, persistence, history batches, compact-code round trip, SDP-injection attempts | **45 / 45 passed** |
| End-to-end two-profile test (`node tests/e2e-two-peers.js`) | **40 / 40 passed** |
| — landing → dashboard navigation | passed |
| — invalid / damaged code and invite-vs-reply mix-up show errors | passed |
| — invite link ~300 chars; QR drawn; QR decoded back to the exact link with an independent decoder (OpenCV) | passed |
| — opening the invite link creates the reply with no clicks; pasting the reply connects with no click; opening your own invite in the same browser is refused | passed |
| — status is *not* "Connected" before the channel opens | passed |
| — both profiles reach the room via a real DataChannel; room name and peer name arrive | passed |
| — messages delivered both directions; Enter and Send button | passed |
| — HTML in a message is shown as text, not executed | passed |
| — 6 kinds of hostile packets injected over the live channel are rejected; same message sent 3× appears once | passed |
| — identical message order on both sides after rapid sending | passed |
| — chat survives a page refresh; refreshed side shows *offline*, not *connected* | passed |
| — peer detects disconnect; input disabled while disconnected | passed |
| — reconnect to the same room + history sync restores messages with no duplicates | passed |
| — Leave room; no horizontal scrolling at 390 px width | passed |

Screenshots from this run are in `screenshots/`.

### 13b. Tests that still need YOU (not done — do not mark as passed until you do them)

The automated run **cannot** prove these. Fill the "Result / date / device" column honestly.

| Test | Result / date / devices |
|---|---|
| Connect two **different physical devices** on the **live GitHub Pages URL** | ☐ *(not yet tested)* |
| **Scan the invite QR with a real phone camera** (Android and iPhone) and check the link opens VYBE | ☐ *(only machine-decoded so far)* |
| In-app *Scan QR* button (needs the browser's BarcodeDetector + camera; appears only where supported, e.g. Chrome on Android) | ☐ *(not tested; code-path only)* |
| *Share...* button on a phone | ☐ *(not tested)* |
| Invite link sent through WhatsApp / e-mail still opens and connects (apps may rewrite links) | ☐ |
| Connect over **different networks** (e.g. laptop on Wi-Fi + phone on mobile data) | ☐ |
| Connect on **campus Wi-Fi** (may fail without TURN — record what happens) | ☐ |
| Copy/paste buttons on a real phone (clipboard permission prompts differ per browser) | ☐ |
| Mobile layout of the study room on a real phone (Chrome / Safari) | ☐ |
| Safari / Firefox behaviour | ☐ |
| Two messages sent at the exact same moment from both devices | ☐ |
| Real reconnect after Wi-Fi drop or phone sleep | ☐ |
| Long chat (hundreds of messages) history sync on a real phone | ☐ |

## 14. Limitations

- **Direct connections do not work on every network.** VYBE uses only STUN. Symmetric NAT, strict campus/office firewalls and some mobile carriers need a **TURN relay**, which is not included. If it fails, try the same Wi-Fi or a phone hotspot.
- **Two people per room** (one connection). Group rooms would need many connections (assignment problem 7) and are not implemented.
- **Manual signalling**: the reply must travel back to the host (scan or paste). One-scan connection is impossible without a signalling server.
- A code is single-use. For every new connection a fresh invite/reply pair is needed.
- Invites contain your network addresses (including your public IP via STUN). Share them only with people you trust.
- On some browsers local addresses are hidden behind random `.local` names that only resolve on the same network; across networks the connection then depends on the public (STUN) address.
- **History sync only works while a peer holding the messages is online.** Offline devices cannot provide history.
- "Clear my chat" removes only *your* copy. If you reconnect, your peer can send theirs back (a known decentralised problem: deleting data everywhere is impossible — assignment problem 12, not solved).
- **No identity verification.** Anyone can type any display name (assignment problem 8, not solved).
- LocalStorage is limited (~5 MB) and is deleted if the user clears site data. Only the latest 1000 messages per room are kept.
- Not a file-sharing app: text only.

## 15. Five development challenges — **YOU must complete these**

> ⚠️ The assignment requires **at least five problems you actually faced**. We must not invent them. Below, each challenge has the **technical background** and the **solution that is in the code** pre-filled so you understand it. The **"What I tried"** parts and any real story are yours — write what truly happened to your group while building and testing. **Delete or replace any challenge your group did not really face.**

### Challenge 1 — Connection code showed no network addresses / was created too early
- **Problem faced:** *(describe what you actually saw, e.g. connection never opened)*
- **Why it happens (background):** WebRTC collects ICE candidates (possible network paths) *after* `setLocalDescription`. Without a signalling server we cannot send them later ("trickle ICE"), so the code must already contain all of them. The raw description is also over 1000 characters, too long to scan or share comfortably.
- **What I tried:** *(fill in)*
- **Solution in the code:** `waitForIceGathering()` in `js/webrtc.js` waits for `iceGatheringState === 'complete'` (6 s timeout) before showing the code, and refuses to continue if there are zero candidates. `compactSdp()` / `expandSdp()` shrink the code to about 300 characters.

### Challenge 2 — "Connected" shown too early / connection state confusion
- **Problem faced:** *(fill in)*
- **Why it happens (background):** `connectionState` can say `connected` before the DataChannel is usable, and can flip to `disconnected` temporarily on a Wi-Fi blip.
- **What I tried:** *(fill in)*
- **Solution in the code:** the UI treats the connection as connected only in `channel.onopen`; failure and disconnect have separate messages and a 25 s connect timeout.

### Challenge 3 — Connection failing on some networks
- **Problem faced:** *(fill in: which network, what happened — real devices needed)*
- **Why it happens (background):** NAT/firewalls block direct UDP paths; STUN cannot fix symmetric NAT.
- **What I tried:** *(fill in, e.g. hotspot, same Wi-Fi)*
- **Solution in the code / honest outcome:** friendly failure message and documentation of the TURN limitation; no false claim that it works everywhere.

### Challenge 4 — Duplicates and wrong order after history sync
- **Problem faced:** *(fill in)*
- **Why it happens (background):** both peers send history to each other, so the same message arrives again; device clocks differ, so timestamp-only sorting is unreliable.
- **What I tried:** *(fill in)*
- **Solution in the code:** unique IDs + `Set` check, logical sequence numbers and a deterministic tie-break (`compareMessages`).

### Challenge 5 — Safely displaying text from a peer
- **Problem faced:** *(fill in)*
- **Why it happens (background):** a peer can send `<img onerror=…>` or giant/odd JSON; `innerHTML` would execute it.
- **What I tried:** *(fill in)*
- **Solution in the code:** strict `parsePacket`/`validateMessage` and `textContent` rendering.

## 16. Project structure

```
VYBE/
├── index.html          all pages (landing, dashboard, connect, room, about)
├── style.css           design system and responsive layout
├── script.js           UI logic: routing, forms, events, rendering
├── js/webrtc.js        WebRTC offer/answer + DataChannel (no DOM)
├── js/chat.js          messages, LocalStorage, validation, ordering (no DOM)
├── js/qrcode.js        bundled QR generator (MIT, credited below)
├── assets/logo.svg     logo mark
├── tests/              chat.test.js (Node) and e2e-two-peers.js (Playwright)
├── screenshots/        screenshots from the automated run
├── VIVA_GUIDE.md       code walkthrough and viva questions
└── README.md
```

## 17. Possible future work

- A tiny public signalling relay (used only to pass the two small connection messages, never chat data) would give true one-scan connection. Not used here to keep the project server-free.
- TURN relay for restrictive networks.
- More than two people per room.

## 18. Does it use a server?

- **Messages:** no server stores or forwards them. They travel through the DataChannel.
- **Database:** none. LocalStorage is a per-browser copy.
- **Static hosting:** GitHub Pages only serves the HTML/CSS/JS files.
- **STUN:** Google's public STUN server is contacted to learn each device's public address. It never sees chat data.
