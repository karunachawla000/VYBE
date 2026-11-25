/* ==========================================================================
   webrtc.js  -  VYBE peer-to-peer connection (WebRTC + RTCDataChannel)
   --------------------------------------------------------------------------
   This file knows NOTHING about the page (DOM) or about chat messages.
   It only creates a direct connection between two browsers and lets you
   send / receive text through it.

   HOW THE CONNECTION IS MADE (manual signalling, no server):

     Student A ("host")                          Student B ("guest")
     ------------------                          -------------------
     createOffer()  ---- offer code (copy/paste) ---->  acceptOffer()
                    <--- answer code (copy/paste) ----
     acceptAnswer()
                  ===== DataChannel opens: direct P2P =====

   The "offer" and "answer" are SDP descriptions: text that tells the other
   browser how it can be reached (IP addresses / ports found with ICE + STUN).
   Normally a signalling SERVER carries them. Here the two students carry
   them by hand, so no server is needed at all.

   IMPORTANT: "connected" is only reported when the DataChannel is really
   open. We never fake a connection.
   ========================================================================== */

const VybeRTC = (function () {
  'use strict';

  /* ---------------------------------------------------------------------
     Settings
     --------------------------------------------------------------------- */
  // Public STUN servers. STUN only helps a browser discover its own public
  // address. It does NOT carry any chat messages.
  // NOTE: no TURN (relay) server is configured, so some strict networks
  // (some college Wi-Fi, mobile carriers, corporate firewalls) may not connect.
  const RTC_CONFIG = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    ]
  };

  const CHANNEL_NAME = 'vybe-chat';
  const ICE_GATHER_TIMEOUT_MS = 6000;   // stop waiting for candidates after this
  const CONNECT_TIMEOUT_MS = 25000;     // give up if the channel never opens
  const MAX_CODE_LENGTH = 8000;         // reject absurdly long pasted codes
  const CODE_PREFIX = 'VYBE2:';         // every connection code starts with this
  const MAX_BUFFERED_BYTES = 1000000;   // do not send if the channel is backed up

  /* ---------------------------------------------------------------------
     Connection codes (short!)
     ---------------------------------------------------------------------
     A full WebRTC description (SDP) is about 1000 characters, mostly
     boilerplate that is the same every time. A data-channel connection only
     really needs:
        - ICE username + password   (to prove who we are to the other side)
        - certificate fingerprint   (so the connection can be encrypted)
        - a few network candidates  (where to reach us)
     So the code holds only those, and the receiving browser REBUILDS the full
     SDP from a fixed template. Result: roughly 300-400 characters.

     A code looks like:  VYBE2:eyJ2IjoyLC...   (Base64 of a small JSON array)
     It can also sit at the end of a link:  https://site/#/join/VYBE2:eyJ2...
     --------------------------------------------------------------------- */
  const MAX_CANDIDATES = 5;

  // Text <-> Base64 (works with any language/emoji, not only English letters).
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary);
  }
  function fromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  // Base64 that is safe inside a link (uses - and _ instead of + and /).
  function toBase64Url(text) {
    return toBase64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromBase64Url(text) {
    let b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return fromBase64(b64);
  }
  function hexToBase64Url(hexWithColons) {
    const bytes = hexWithColons.split(':').map(function (h) { return parseInt(h, 16); });
    let binary = '';
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function base64UrlToHex(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const parts = [];
    for (let i = 0; i < binary.length; i++) {
      parts.push(('0' + binary.charCodeAt(i).toString(16)).slice(-2).toUpperCase());
    }
    return parts.join(':');
  }

  // Squeeze a full SDP into the few fields we need. Returns an object or null.
  function compactSdp(sdp) {
    const ufrag = (sdp.match(/^a=ice-ufrag:(\S+)/m) || [])[1];
    const pwd = (sdp.match(/^a=ice-pwd:(\S+)/m) || [])[1];
    const fp = (sdp.match(/^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/m) || [])[1];
    if (!ufrag || !pwd || !fp) return null;

    // Candidates: UDP only, no link-local IPv6. Keep a few, best first.
    const found = [];
    const re = /^a=candidate:\S+ 1 udp (\d+) (\S+) (\d+) typ (host|srflx|relay)/gm;
    let m;
    while ((m = re.exec(sdp)) !== null) {
      if (/^fe80:/i.test(m[2])) continue;
      found.push({ prio: Number(m[1]), ip: m[2], port: m[3], type: m[4] });
    }
    found.sort(function (a, b) { return b.prio - a.prio; });
    const candidates = found.slice(0, MAX_CANDIDATES).map(function (c) {
      return c.type[0] + '|' + c.ip + '|' + c.port + '|' + c.prio.toString(36);
    });
    return { ufrag: ufrag, pwd: pwd, fp: hexToBase64Url(fp), candidates: candidates };
  }

  // Rebuild a full SDP from the small fields. role: 'offer' or 'answer'.
  function expandSdp(parts, type) {
    const lines = [
      'v=0',
      'o=- ' + Math.floor(Math.random() * 1e15) + ' 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=ice-ufrag:' + parts.ufrag,
      'a=ice-pwd:' + parts.pwd,
      'a=fingerprint:sha-256 ' + base64UrlToHex(parts.fp),
      'a=setup:' + (type === 'offer' ? 'actpass' : 'active'),
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144'
    ];
    const typeNames = { h: 'host', s: 'srflx', r: 'relay' };
    parts.candidates.forEach(function (c, i) {
      const f = c.split('|');
      lines.push('a=candidate:' + (i + 1) + ' 1 udp ' + parseInt(f[3], 36) + ' ' + f[1] + ' ' + f[2] + ' typ ' + typeNames[f[0]]);
    });
    lines.push('a=end-of-candidates');
    return lines.join('\r\n') + '\r\n';
  }

  // Build a code from an SDP description.
  // room = { id, name }, sender = { id, name }. Only the first 8 characters of
  // the sender ID are included (the full ID is sent later, inside the channel).
  function encodeCode(type, sdp, room, sender) {
    const parts = compactSdp(sdp);
    if (!parts) throw new Error('This browser produced connection details VYBE cannot use.');
    const payload = [
      2, type === 'offer' ? 'o' : 'a',
      parts.ufrag, parts.pwd, parts.fp, parts.candidates,
      room.id, room.name,
      sender.id.slice(0, 8), sender.name
    ];
    return CODE_PREFIX + toBase64Url(JSON.stringify(payload));
  }

  const IP_OR_HOST = /^[A-Za-z0-9.:\-]{1,80}$/;   // IPv4, IPv6, or an mDNS name like xxxx.local

  // Check a pasted code OR link. NEVER trusts what the user pasted.
  // expectedType is 'offer' or 'answer'.
  // Returns { ok: true, sdp, room, from } or { ok: false, error }.
  function decodeCode(rawText, expectedType) {
    if (typeof rawText !== 'string' || rawText.trim() === '') {
      return { ok: false, error: 'Please paste an invite link or code first.' };
    }
    // Chat apps add spaces and line breaks. Remove them.
    const text = rawText.replace(/\s+/g, '');
    if (text.length > MAX_CODE_LENGTH) {
      return { ok: false, error: 'That text is too long to be a VYBE code.' };
    }
    if (text.indexOf('VYBE1:') !== -1) {
      return { ok: false, error: 'This code was made by an older version of VYBE. Ask your friend to create a new invite.' };
    }
    const at = text.indexOf(CODE_PREFIX);
    if (at === -1) {
      return { ok: false, error: 'This is not a VYBE code. A valid code or link contains "' + CODE_PREFIX + '". Copy the whole thing again.' };
    }
    const match = text.slice(at).match(/^VYBE2:([A-Za-z0-9_-]+)/);

    let data;
    try {
      data = JSON.parse(fromBase64Url(match[1]));
    } catch (err) {
      return { ok: false, error: 'The code looks damaged or incomplete. Make sure you copied all of it.' };
    }

    if (!Array.isArray(data) || data.length !== 10 || data[0] !== 2) {
      return { ok: false, error: 'This code is not in the right format.' };
    }
    const t = data[1] === 'o' ? 'offer' : data[1] === 'a' ? 'answer' : null;
    if (!t) return { ok: false, error: 'This code has an unknown type.' };
    if (t !== expectedType) {
      return {
        ok: false,
        error: expectedType === 'offer'
          ? 'This is a REPLY code. Here you need the INVITE from the student who created the room.'
          : 'This is an INVITE. Here you need the REPLY code from the student who joined.'
      };
    }

    const ufrag = data[2], pwd = data[3], fp = data[4], cands = data[5];
    const okText = function (v, min, max) { return typeof v === 'string' && v.length >= min && v.length <= max; };
    if (!okText(ufrag, 3, 256) || !/^[A-Za-z0-9+\/]+$/.test(ufrag) ||
        !okText(pwd, 8, 256) || !/^[A-Za-z0-9+\/]+$/.test(pwd) ||
        !okText(fp, 40, 50) || !/^[A-Za-z0-9_-]+$/.test(fp)) {
      return { ok: false, error: 'The connection details inside the code are invalid.' };
    }
    if (!Array.isArray(cands) || cands.length === 0 || cands.length > MAX_CANDIDATES) {
      return { ok: false, error: 'The code has no usable network addresses.' };
    }
    for (let i = 0; i < cands.length; i++) {
      const f = typeof cands[i] === 'string' ? cands[i].split('|') : [];
      if (f.length !== 4 || 'hsr'.indexOf(f[0]) === -1 || f[0].length !== 1 || !IP_OR_HOST.test(f[1]) ||
          !/^\d{1,5}$/.test(f[2]) || !/^[0-9a-z]{1,8}$/.test(f[3])) {
        return { ok: false, error: 'The network addresses inside the code are invalid.' };
      }
    }

    let sdp;
    try {
      sdp = expandSdp({ ufrag: ufrag, pwd: pwd, fp: fp, candidates: cands }, expectedType);
    } catch (err) {
      return { ok: false, error: 'The connection details inside the code are invalid.' };
    }
    // Room + sender details are checked again by the app (VybeChat) before use.
    return { ok: true, sdp: sdp, room: { id: data[6], name: data[7] }, from: { i: data[8], n: data[9] } };
  }

  /* ---------------------------------------------------------------------
     Wait until the browser has finished collecting ICE candidates.
     We must do this BEFORE showing the code, because we have no server to
     send candidates later ("non-trickle ICE"). If the code was created too
     early it would not contain our network addresses and could not connect.
     --------------------------------------------------------------------- */
  function waitForIceGathering(pc, timeoutMs) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') {
        resolve({ complete: true });
        return;
      }
      let finished = false;
      function done(result) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve(result);
      }
      function onChange() {
        if (pc.iceGatheringState === 'complete') done({ complete: true });
      }
      const timer = setTimeout(function () { done({ complete: false }); }, timeoutMs);
      pc.addEventListener('icegatheringstatechange', onChange);
    });
  }

  function countCandidates(sdp) {
    const matches = sdp.match(/^a=candidate:/gm);
    return matches ? matches.length : 0;
  }

  /* ---------------------------------------------------------------------
     The Connection class: one RTCPeerConnection + one RTCDataChannel.
     Create a NEW Connection object for every connection attempt.

     handlers = {
       onState(state, detail)  - connection state changed
       onOpen()                - DataChannel is open (really connected)
       onMessage(text)         - text received from the peer
       onClose()               - DataChannel closed after being open
       onIceState(text)        - ICE state text (for the info panel)
     }

     States:  idle -> gathering -> waiting-for-answer (host)
                              \-> waiting-for-host   (guest)
              -> connecting -> connected -> disconnected
              or -> failed
     --------------------------------------------------------------------- */
  class Connection {
    constructor(handlers) {
      this.handlers = handlers || {};
      this.pc = null;
      this.channel = null;
      this.state = 'idle';
      this.role = null;            // 'host' or 'guest'
      this.closed = false;
      this.wasOpen = false;
      this.connectTimer = null;
      this.iceGatheringComplete = null;
    }

    /* ---- state handling ---- */
    _setState(state, detail) {
      if (this.closed && state !== 'closed') return;
      // Once failed, a later "disconnected" must not hide the failure.
      if (this.state === 'failed' && state === 'disconnected') return;
      if (this.state === state && !detail) return;
      this.state = state;
      if (this.handlers.onState) this.handlers.onState(state, detail || '');
    }

    _startConnectTimer() {
      if (this.connectTimer || this.closed) return;
      const self = this;
      this.connectTimer = setTimeout(function () {
        self.connectTimer = null;
        if (!self.wasOpen && !self.closed) {
          self._setState('failed',
            'The direct connection could not be opened in time. The two devices may be behind restrictive networks or firewalls. ' +
            'Try again, use the same Wi-Fi, or try another network. (Such networks usually need a TURN relay server, which VYBE does not use.)');
        }
      }, CONNECT_TIMEOUT_MS);
    }

    _clearConnectTimer() {
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
    }

    /* ---- creating the RTCPeerConnection ---- */
    _createPeerConnection() {
      if (typeof RTCPeerConnection === 'undefined') {
        throw new Error('This browser does not support WebRTC. Please use a recent version of Chrome, Edge, Firefox or Safari.');
      }
      const self = this;
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;

      pc.onconnectionstatechange = function () {
        if (self.closed || self.pc !== pc) return;
        const s = pc.connectionState;
        if (s === 'connecting') {
          self._startConnectTimer();
          if (!self.wasOpen) self._setState('connecting');
        } else if (s === 'failed') {
          self._clearConnectTimer();
          self._setState('failed',
            self.wasOpen
              ? 'The connection to your peer was lost.'
              : 'Could not establish a direct connection. The devices may be on networks that block peer-to-peer traffic. Restrictive networks usually need a TURN relay server, which VYBE does not use.');
        } else if (s === 'disconnected' && self.wasOpen) {
          // Often temporary (e.g. Wi-Fi blip). We still show it honestly.
          self._setState('disconnected', 'The connection was interrupted. It may recover by itself; if not, press Reconnect.');
        } else if (s === 'closed' && self.wasOpen) {
          self._setState('disconnected', 'The connection was closed.');
        }
      };

      pc.oniceconnectionstatechange = function () {
        if (self.pc !== pc) return;
        if (self.handlers.onIceState) self.handlers.onIceState(pc.iceConnectionState);
      };

      return pc;
    }

    /* ---- wiring the DataChannel ---- */
    _wireChannel(channel) {
      const self = this;
      this.channel = channel;

      // "connected" ONLY when the channel is really open.
      channel.onopen = function () {
        if (self.closed || self.channel !== channel) return;
        self.wasOpen = true;
        self._clearConnectTimer();
        self._setState('connected');
        if (self.handlers.onOpen) self.handlers.onOpen();
      };

      channel.onclose = function () {
        if (self.closed || self.channel !== channel) return;
        if (self.wasOpen) {
          self._setState('disconnected', 'Your peer closed the connection or it was lost.');
          if (self.handlers.onClose) self.handlers.onClose();
        }
      };

      channel.onerror = function () {
        // Details are not exposed by browsers; the close/failed events follow.
      };

      channel.onmessage = function (event) {
        if (self.closed || self.channel !== channel) return;
        if (self.handlers.onMessage) self.handlers.onMessage(event.data);
      };
    }

    /* ---- HOST: step 1 - create the offer ---- */
    async createOffer() {
      this.role = 'host';
      this._setState('gathering');
      const pc = this._createPeerConnection();

      // The host creates the DataChannel. The guest receives it in ondatachannel.
      const channel = pc.createDataChannel(CHANNEL_NAME, { ordered: true });
      this._wireChannel(channel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for all ICE candidates before the code is shown.
      const gathering = await waitForIceGathering(pc, ICE_GATHER_TIMEOUT_MS);
      if (this.closed) throw new Error('Cancelled.');

      const sdp = pc.localDescription.sdp;
      if (countCandidates(sdp) === 0) {
        throw new Error('No network connection was found. Check that you are online and try again.');
      }
      this.iceGatheringComplete = gathering.complete;
      this._setState('waiting-for-answer');
      return { sdp: sdp, iceComplete: gathering.complete };
    }

    /* ---- GUEST: step 1 - accept the offer and create the answer ---- */
    async acceptOffer(offerSdp) {
      this.role = 'guest';
      this._setState('gathering');
      const pc = this._createPeerConnection();
      const self = this;

      pc.ondatachannel = function (event) {
        if (self.closed || self.pc !== pc) return;
        if (event.channel.label !== CHANNEL_NAME) return; // ignore unknown channels
        self._wireChannel(event.channel);
      };

      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      } catch (err) {
        throw new Error('The offer code could not be used. Ask your friend to create a new one.');
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const gathering = await waitForIceGathering(pc, ICE_GATHER_TIMEOUT_MS);
      if (this.closed) throw new Error('Cancelled.');

      const sdp = pc.localDescription.sdp;
      if (countCandidates(sdp) === 0) {
        throw new Error('No network connection was found. Check that you are online and try again.');
      }
      this.iceGatheringComplete = gathering.complete;
      this._setState('waiting-for-host');
      return { sdp: sdp, iceComplete: gathering.complete };
    }

    /* ---- HOST: step 2 - accept the answer ---- */
    async acceptAnswer(answerSdp) {
      if (this.role !== 'host' || !this.pc) {
        throw new Error('Create an offer first.');
      }
      if (this.pc.signalingState !== 'have-local-offer') {
        throw new Error('This offer was already used. Create a new offer for a new connection.');
      }
      try {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      } catch (err) {
        throw new Error('The answer code does not match your offer. Make sure it came from the student who used YOUR latest offer code.');
      }
      this._setState('connecting');
      this._startConnectTimer();
    }

    /* ---- sending ---- */
    isOpen() {
      return !this.closed && this.channel !== null && this.channel.readyState === 'open';
    }

    // Returns true only if the text was handed to an open DataChannel.
    send(text) {
      if (!this.isOpen()) return false;
      if (this.channel.bufferedAmount > MAX_BUFFERED_BYTES) return false;
      try {
        this.channel.send(text);
        return true;
      } catch (err) {
        return false;
      }
    }

    /* ---- information for the "Connection info" panel ---- */
    async getConnectionPath() {
      if (!this.pc || !this.isOpen()) return null;
      try {
        const stats = await this.pc.getStats();
        let pairId = null;
        stats.forEach(function (report) {
          if (report.type === 'transport' && report.selectedCandidatePairId) pairId = report.selectedCandidatePairId;
        });
        let pair = null;
        stats.forEach(function (report) {
          if (report.type === 'candidate-pair' && (report.id === pairId || (!pairId && report.nominated && report.state === 'succeeded'))) pair = report;
        });
        if (!pair) return null;
        const local = stats.get(pair.localCandidateId);
        const remote = stats.get(pair.remoteCandidateId);
        return {
          local: local ? local.candidateType : 'unknown',
          remote: remote ? remote.candidateType : 'unknown'
        };
      } catch (err) {
        return null;
      }
    }

    /* ---- cleaning up ---- */
    // Closes everything. Safe to call more than once.
    close() {
      if (this.closed) return;
      this.closed = true;
      this._clearConnectTimer();
      try { if (this.channel) { this.channel.onopen = this.channel.onclose = this.channel.onmessage = this.channel.onerror = null; this.channel.close(); } } catch (err) { /* ignore */ }
      try {
        if (this.pc) {
          this.pc.onconnectionstatechange = null;
          this.pc.oniceconnectionstatechange = null;
          this.pc.ondatachannel = null;
          this.pc.close();
        }
      } catch (err) { /* ignore */ }
      this.channel = null;
      this.pc = null;
    }
  }

  return {
    RTC_CONFIG: RTC_CONFIG,
    CODE_PREFIX: CODE_PREFIX,
    compactSdp: compactSdp,
    expandSdp: expandSdp,
    encodeCode: encodeCode,
    decodeCode: decodeCode,
    Connection: Connection
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VybeRTC;
}
