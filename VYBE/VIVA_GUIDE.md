# VYBE — Code Walkthrough and Viva Guide

## Part 1: What each file does (in plain words)

### `index.html`
One page with five "views" (landing, dashboard, connect, room, about). Only one is visible at a time; `script.js` shows/hides them using the URL hash (`#/dashboard`, `#/room`…). It also loads the scripts **in this order**: `js/ice-config.js`, `js/webrtc.js`, `js/chat.js`, `js/qrcode.js`, `script.js`.

### `js/ice-config.js` — network settings (STUN + optional TURN)
The only file that holds TURN details. Empty by default; placeholder entries are ignored on purpose. See the README for the security trade-off.

### `style.css`
All colours are CSS variables at the top (`--cream`, `--orange`, `--brown` …). Layout uses CSS Grid and Flexbox. `@media (max-width: …)` blocks make it work on phones.

### `js/webrtc.js` — the connection (knows nothing about the page or chat)
- `compactSdp / expandSdp` — shrink the ~1000-character WebRTC description (SDP) to the few fields that matter (ICE login, fingerprint, up to 8 addresses: 2 relay, 2 public, 3 local, 2 TCP). Addresses are chosen per kind, because relay addresses have the lowest priority and a plain "best 5" would drop them and rebuild a full SDP on the other side.
- `encodeCode / decodeCode` — turn that into a short text starting with `VYBE3:` (Base64URL of a small JSON array) and safely check a pasted code or link (empty? wrong prefix? damaged? invite instead of reply? hostile fields?).
- `waitForIceGathering` — waits until the browser has found all its network addresses before the code is shown.
- `class Connection`
  - `createOffer()` — **host** creates the `RTCPeerConnection` and the DataChannel, makes an offer.
  - `acceptOffer(sdp)` — **guest** reads the offer, makes an answer.
  - `acceptAnswer(sdp)` — **host** reads the answer. Now ICE tries to connect.
  - `channel.onopen` — the *only* place that says "connected".
  - `send(text)` — sends only if the channel is really open.
  - `close()` — cleans everything up.

### `js/chat.js` — the data (knows nothing about WebRTC or the page)
- `validateMessage`, `parsePacket` — check everything that arrives (**Problem: malicious input**).
- `insert` — adds a message unless its ID is already known (**Problem: duplicates**).
- `compareMessages` — ordering by sequence number, then tie-breakers (**Problem: wrong order**).
- `openRoom / saveCurrent` — LocalStorage (**Problem: lost on refresh**).
- `getHistoryBatches / mergeMessages` — history sync (**bonus**).

### `script.js` — the glue
- `onGenerateOffer`, `onConnectClick`, `onGenerateAnswer` — create invite, connect with the reply, create the reply. `startJoinFromInvite` runs when someone opens an invite link. `drawQr` uses `js/qrcode.js`.
- `onChannelOpen` — runs when the DataChannel opens: opens the room, sends `hello` and `history-request`.
- `onChannelMessage` — every packet from the peer goes through `VybeChat.parsePacket` first, then a `switch` on its type.
- `renderMessages` — draws the chat using `textContent`.
- `sendMessage` — sends first; saves only if the send worked.

## Part 2: Follow one message

1. You type "Hello" and press Enter → `sendMessage()`.
2. `createLocalMessage` builds `{id, senderId, content, timestamp, seq, type}`; `seq = clock + 1`.
3. `JSON.stringify` → `channel.send(...)` (goes straight to the peer's browser).
4. If sending worked, the message is added to your list and saved to LocalStorage.
5. On the peer: `channel.onmessage` → `parsePacket` (validate) → `addMessage` (duplicate check, clock update, sort, save) → `renderMessages` (`textContent`).

## Part 3: Viva questions and model answers

**What is WebRTC?**
A browser technology that lets two browsers connect directly and exchange audio, video or data without a server in between for the data itself.

**What is an `RTCPeerConnection`?**
The object that represents the connection to the other browser. It handles finding a network path (ICE), encryption (DTLS) and keeps the connection alive.

**What is an `RTCDataChannel`?**
A channel inside the peer connection for sending arbitrary data such as text. We use it for chat. It is ordered and reliable by default, like TCP.

**What is signalling and why did you do it manually?**
Before connecting, the two browsers must exchange connection details (the SDP offer and answer). A signalling server usually carries them. The assignment forbids servers that store or forward user data and we want no backend, so the users carry the codes by copy-paste. After the connection opens, signalling is not used again.

**What are offer and answer? What do you call them in the app?**
SDP text descriptions. The offer says "this is how you can reach me and what I support". The answer is the reply from the other side. In the app they are the *invite* (link/QR) and the *reply*.

**Why is your code short, and is it safe to rebuild SDP from it?**
A full SDP is mostly boilerplate. We send only the ICE username/password, certificate fingerprint and a few UDP addresses, and rebuild the rest from a fixed template. Every field is checked against a strict pattern first, so a pasted code cannot inject extra SDP lines.

**Why can't one QR scan connect you completely?**
A connection needs information in both directions (offer then answer). With no server, the answer has to be carried back by the users (paste or scan). A signalling server would remove that step, but we chose not to use one.

**What is ICE, and why do you wait for ICE gathering?**
ICE finds the best network path between two devices by trying candidate addresses. Normally candidates are sent one by one through the signalling server (trickle ICE). We have no server, so we wait until all candidates are collected and put them into the code.

**What is STUN? What is TURN?**
STUN tells a device its public IP and port (as seen from the internet), which allows direct connections through most home routers. TURN is a relay server that forwards data when a direct path is impossible (strict firewalls). VYBE always uses STUN. TURN is supported but only active if the developer adds their own TURN credentials in `js/ice-config.js`; none are included, so some networks can fail. We say so in the app and README.

**Is the chat really not going through a server?**
Right. After the DataChannel opens, data goes device to device. The only servers involved are GitHub Pages (serves the files) and Google's STUN server (address discovery). You can see the route type in the Connection info panel ("Direct" vs "Relayed").

**Is it encrypted?**
WebRTC DataChannels are encrypted with DTLS by the browser automatically. LocalStorage copies are *not* encrypted.

**What is LocalStorage? Is it a database?**
A small key-value store inside each browser (~5 MB). Each person only has their *own* copy; there is no shared or central database. If the user clears site data, it is gone.

**Explain the four problems you solved.**
1. *Data lost on refresh* → chat is saved in LocalStorage and reloaded.
2. *Duplicates* → each message has a unique ID; we check the ID before adding.
3. *Wrong order* → sequence numbers from a logical clock plus fixed tie-breakers, so we do not depend on device clocks. If I receive seq 7, my next message is at least seq 8.
4. *Malicious input* → validate JSON, types, lengths and IDs, drop unknown fields, and display with `textContent`, so HTML cannot run.
Bonus: *late joiners* → request and send history through the DataChannel, merged by ID.

**Why `textContent` and not `innerHTML`?**
`innerHTML` parses text as HTML, so `<img onerror=…>` would run script (XSS). `textContent` always treats it as plain text.

**What is a logical (Lamport) clock?**
A counter instead of real time. On send: `seq = clock + 1`. On receive: `clock = max(clock, seq)`. It guarantees a reply gets a higher number than the message it replies to, even if the clocks are wrong.

**What if two people send at the same instant with the same `seq`?**
The tie-break rules (timestamp, senderId, message ID) are the same on both devices, so both devices show the same order.

**Why can history sync not recover everything?**
Only an online peer can send history. If nobody who has a message is online, it cannot be recovered.

**What are the limitations?**
No TURN credentials are included (STUN only until you add them), so some networks block it; two peers per room; manual copy-paste; no identity verification; LocalStorage can be cleared; "clear chat" deletes only your own copy.

**How do you know "Connected" is real?**
The status changes only inside `channel.onopen`, which the browser fires when the DataChannel is truly open. Before that we show Preparing / Waiting / Connecting.

**What would you add next?**
A TURN server for restricted networks, QR codes instead of long text, more than two people, and message signing to prove identity.

## Part 4: Demo script for the evaluation (about 3 minutes)

1. Show the live GitHub Pages URL on your laptop and a phone.
2. Laptop: Create room → *Create invite*. Phone scans the QR with its camera (or open the link from WhatsApp).
3. Phone: the page opens and shows the reply (QR + code) by itself. Send the code back to the laptop.
4. Laptop: paste the reply. It connects without pressing anything. Point out: the status changes to *Connected* only now.
5. Send messages both ways. Open *Connection info*: route, duplicates blocked, rejected data.
6. Refresh the phone; open the saved chat from the dashboard (persistence).
7. Clear chat on the phone, reconnect, show history syncing back from the laptop.
8. Explain what STUN does and why strict Wi-Fi may fail.
