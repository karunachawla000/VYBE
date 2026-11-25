# VYBE - Peer-to-Peer Study Room

## Developer

- **Name:** Karuna Chawla
- **SAP ID:** 590027865
- **GitHub:** [karunachawla000](https://github.com/karunachawla000)

## Live App

https://karunachawla000.github.io/VYBE/VYBE/

## What is VYBE?

VYBE is a study-room chat application. Two students connect directly in their browsers using WebRTC and exchange messages without a chat server or database.

## How to use

1. Open the live app on two devices.
2. On the first device, enter a name and create a study room.
3. Share the invite link or QR code.
4. The second device opens the invite and creates a reply code.
5. Send the reply code back to the first device.
6. Paste the reply code and connect.
7. Chat after the status says **Connected**.

The invite and reply are manual WebRTC signalling. After connection, messages travel directly between the browsers.

## Technologies and services

- HTML5, CSS3 and Vanilla JavaScript
- WebRTC: `RTCPeerConnection` and `RTCDataChannel`
- Browser LocalStorage
- Google public STUN server for network discovery
- Bundled QR code JavaScript library
- GitHub Pages for hosting

No backend or database is used for chat messages.

## Assignment problems solved

### Data lost after refresh

Messages are saved in LocalStorage and loaded again when the room is opened.

### Duplicate messages

Every message has a unique ID. Messages with an ID already received are ignored.

### Messages shown in the wrong order

Messages use sequence numbers and deterministic sorting instead of depending only on device time.

### Malicious input

Incoming packets are validated, message length is limited, and chat text is displayed with `textContent` so HTML and scripts do not run.

### Late joiners missing history

When a peer connects, saved messages are exchanged through the WebRTC DataChannel and merged without duplicates.

## Development challenges and solutions

### Challenge 1: Invite code was too long

- **Problem:** A complete WebRTC description is difficult to share in a QR code.
- **Why:** SDP contains more information than this data-only app needs.
- **Solution:** The app keeps only the required ICE, fingerprint and candidate information and rebuilds the SDP.

### Challenge 2: ICE candidates were missing

- **Problem:** Some invites could not connect.
- **Why:** WebRTC collects network candidates after the offer is created.
- **Solution:** The app waits for ICE gathering before showing the invite.

### Challenge 3: Connection status was confusing

- **Problem:** A browser could report a connection before chat was usable.
- **Why:** WebRTC connection state and DataChannel state are different.
- **Solution:** VYBE shows Connected only after the DataChannel `onopen` event.

### Challenge 4: Duplicate and unsorted history

- **Problem:** Reconnecting could add the same message again and show different orders.
- **Why:** Both peers can send history and their clocks can differ.
- **Solution:** Unique IDs remove duplicates, while sequence numbers provide stable ordering.

### Challenge 5: Different networks may block WebRTC

- **Problem:** Direct connections can fail on strict Wi-Fi or mobile networks.
- **Why:** Firewalls and NAT can block peer-to-peer traffic.
- **Solution:** VYBE uses STUN and shows a clear failure message. A TURN relay is a future improvement.

## Project files

- `index.html` - page structure
- `style.css` - layout and responsive design
- `script.js` - user interface and navigation
- `js/webrtc.js` - WebRTC connection and signalling codes
- `js/chat.js` - messages, storage, validation and history sync
- `js/qrcode.js` - QR code generation

## Testing

- Tested on two devices using a real WebRTC DataChannel.
- Tested invite and reply codes, chat in both directions, refresh persistence, history sync, duplicate prevention and unsafe text input.
- Tested the live GitHub Pages URL.

## Limitations

- The app supports two users per room.
- A new invite and reply are needed for a new connection.
- Some restrictive networks may require a TURN relay.
- Chat history is stored only on each user's own device.

## Running locally

From the folder containing `index.html`, run:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080/`.

