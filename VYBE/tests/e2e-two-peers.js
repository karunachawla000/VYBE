/* Optional end-to-end test: two separate browser profiles (separate LocalStorage)
   on ONE computer, connected with a real WebRTC DataChannel.
   Needs Playwright:  npm i -D playwright   and a static server:  python3 -m http.server 8080
   Run:  node tests/e2e-two-peers.js
   NOTE: this proves the code works; it does NOT replace testing on two real devices. */
const { chromium } = require('playwright');
const URL = process.env.VYBE_URL || 'http://localhost:8080/';
const results = [];
function check(name, ok, extra) { results.push([name, ok]); console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  [' + extra + ']' : '')); }

(async () => {
  // mDNS hiding is turned off only so two profiles on one machine can see each other.
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const hook = () => { const o = RTCPeerConnection.prototype.createDataChannel; RTCPeerConnection.prototype.createDataChannel = function () { const c = o.apply(this, arguments); window.__dc = c; return c; }; const od = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'ondatachannel'); };
  await ctxA.addInitScript(hook); await ctxB.addInitScript(hook);
  const A = await ctxA.newPage(), B = await ctxB.newPage();
  [A, B].forEach((p) => p.on('dialog', (d) => d.accept()));
  const fs = require('fs'); fs.mkdirSync('screenshots', { recursive: true });
  const errors = [];
  [A, B].forEach((p, i) => p.on('pageerror', (e) => errors.push((i ? 'B: ' : 'A: ') + e.message)));
  await A.goto(URL); await B.goto(URL);
  await A.screenshot({ path: 'screenshots/00-landing.png' });

  // landing
  check('landing shows tagline', (await A.textContent('h1')).includes('Your VYBE'));
  await A.click('.nav-cta');
  check('Start Studying opens dashboard', await A.waitForSelector('#view-dashboard:not([hidden])', { timeout: 5000 }).then(() => true).catch(() => false));

  // names
  await A.fill('#nameInput', 'Asha'); await A.click('#nameForm button');
  await B.goto(URL + '#/dashboard'); await B.fill('#nameInput', 'Ravi'); await B.click('#nameForm button');

  // invalid codes
  await B.click('#btnDashJoin');
  await B.fill('#offerInput', 'hello world'); await B.click('#btnGenerateAnswer');
  check('invalid code shows error', (await B.textContent('#joinError')).includes('not a VYBE'));
  await B.fill('#offerInput', 'VYBE2:@@@@'); await B.click('#btnGenerateAnswer');
  check('damaged code shows error', (await B.textContent('#joinError')).includes('damaged'));

  // A creates
  await A.click('#btnDashCreate');
  await A.fill('#roomNameInput', 'DSA revision'); await A.click('#btnGenerateOffer');
  await A.waitForSelector('#offerBox:not([hidden])', { timeout: 20000 });
  const offer = await A.inputValue('#offerCode');
  check('invite link generated (short)', offer.startsWith(URL + '#/join/VYBE2:') && offer.length < 500, offer.length + ' chars total');
  check('QR canvas is drawn', await A.$eval('#offerQr', (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) dark++; return dark > 500; }));
  await (await A.$('#offerQr')).screenshot({ path: 'screenshots/qr-invite.png' });
  check('status = waiting for answer', (await A.textContent('#view-connect .pill-text')).includes('Waiting for answer'));

  // answer pasted in wrong place
  // Friend opens the invite LINK: the reply must appear by itself (no clicks).
  await B.goto(offer);
  await B.waitForSelector('#answerBox:not([hidden])', { timeout: 20000 });
  const answer = await B.inputValue('#answerCode');
  check('opening the link auto-generates the reply', answer.startsWith('VYBE2:'), answer.length + ' chars');
  check('reply QR is drawn', await B.$eval('#answerQr', (c) => c.width > 100));
  await (await B.$('#answerQr')).screenshot({ path: 'screenshots/qr-reply.png' });
  await B.screenshot({ path: 'screenshots/01b-join-reply.png', fullPage: true });
  // Same browser profile must be refused
  const C = await ctxA.newPage(); await C.goto(offer);
  check('opening your OWN invite in the same browser is refused', await C.waitForFunction(() => document.getElementById('joinError').textContent.includes('same browser'), null, { timeout: 8000 }).then(() => true).catch(() => false));
  await C.close();
  await A.fill('#answerInput', offer); await A.click('#btnConnect');
  check('invite pasted as reply is rejected', (await A.textContent('#connectError')).includes('INVITE'));
  check('NOT shown as connected yet', !(await A.textContent('#view-connect .pill-text')).includes('Connected'));

  await A.screenshot({ path: 'screenshots/01-connect.png', fullPage: true });
  // real connect
  await A.fill('#answerInput', answer); await A.click('#btnConnect');
  await A.waitForSelector('#view-room:not([hidden])', { timeout: 30000 });
  await B.waitForSelector('#view-room:not([hidden])', { timeout: 30000 });
  check('both sides entered the room after DataChannel opened', true);
  check('A pill = Connected', (await A.textContent('#view-room .pill-text')) === 'Connected');
  check('B pill = Connected', (await B.textContent('#view-room .pill-text')) === 'Connected');
  check('B got room name from host', (await B.textContent('#roomName')) === 'DSA revision');
  await A.waitForFunction(() => document.getElementById('peerLine').textContent.includes('Ravi'));
  check('A sees peer name Ravi', true);
  await A.waitForTimeout(1500);
  console.log('        route A: ' + (await A.textContent('#infoPath')));

  // messaging
  await A.fill('#messageInput', 'Hello from A'); await A.press('#messageInput', 'Enter');
  await B.waitForSelector('.msg.theirs .bubble');
  check('B received A message', (await B.textContent('.msg.theirs .bubble')) === 'Hello from A');
  await B.fill('#messageInput', 'Hi from B'); await B.click('#btnSend');
  await A.waitForSelector('.msg.theirs .bubble');
  check('A received B message', (await A.textContent('.msg.theirs .bubble')) === 'Hi from B');
  check('A own message styled as mine', await A.isVisible('.msg.mine'));

  // XSS stays text
  await A.fill('#messageInput', '<img src=x onerror="window.__pwned=1"><b>bold</b>'); await A.press('#messageInput', 'Enter');
  await B.waitForFunction(() => document.querySelectorAll('.msg.theirs').length === 2);
  check('HTML shown as text, not run', (await B.evaluate(() => !window.__pwned && document.querySelectorAll('#messages img, #messages b').length === 0)));

  // ordering under rapid sends
  for (let i = 1; i <= 5; i++) { await A.fill('#messageInput', 'rapid ' + i); await A.press('#messageInput', 'Enter'); }
  await B.waitForFunction(() => document.querySelectorAll('.msg.theirs').length === 7);
  const orderA = await A.$$eval('.bubble', (n) => n.map((x) => x.textContent));
  const orderB = await B.$$eval('.bubble', (n) => n.map((x) => x.textContent));
  check('both sides show identical order', JSON.stringify(orderA) === JSON.stringify(orderB));

  // ---- hostile data over the REAL channel (A is the host, so A owns window.__dc) ----
  const idOf = () => 'inj' + Math.random().toString(36).slice(2, 12);
  const rejectedBefore = Number(await B.textContent('#infoRejected'));
  const aId = await A.evaluate(() => JSON.parse(localStorage.getItem('vybe.user')).id);
  const bId = await B.evaluate(() => JSON.parse(localStorage.getItem('vybe.user')).id);
  const good = { id: idOf(), senderId: aId, content: 'unique-once', timestamp: Date.now(), seq: 50, type: 'chat' };
  await A.evaluate((arr) => arr.forEach((x) => window.__dc.send(x)), [
    'not json at all',
    '{"type":"chat"}',
    JSON.stringify({ type: 'chat', id: idOf(), senderId: aId, content: 'x'.repeat(5000), timestamp: Date.now(), seq: 60 }),
    JSON.stringify({ type: 'chat', id: idOf(), senderId: aId, content: 'ok', timestamp: 'yesterday', seq: 61 }),
    JSON.stringify({ type: 'chat', id: idOf(), senderId: bId, content: 'I am B (spoof)', timestamp: Date.now(), seq: 62 }),
    JSON.stringify({ type: 'shell', cmd: 'rm -rf' }),
    JSON.stringify(good), JSON.stringify(good), JSON.stringify(good)   // same message 3 times
  ]);
  await B.waitForFunction(() => [...document.querySelectorAll('.bubble')].some((b) => b.textContent === 'unique-once'));
  await B.waitForTimeout(500);
  const rejectedAfter = Number(await B.textContent('#infoRejected'));
  check('6 invalid packets rejected', rejectedAfter - rejectedBefore === 6, 'rejected +' + (rejectedAfter - rejectedBefore));
  check('duplicate shown only once', (await B.$$eval('.bubble', (n) => n.filter((x) => x.textContent === 'unique-once').length)) === 1);
  check('2 duplicates counted as blocked', (await B.textContent('#infoDup')) === '2');
  await B.screenshot({ path: 'screenshots/03-study-room-desktop.png' });
  await A.screenshot({ path: 'screenshots/04-study-room-host.png' });

  // ---- persistence after refresh ----
  await B.reload();
  await B.goto(URL + '#/dashboard');
  check('B dashboard lists saved chat', (await B.textContent('#recentRooms')).includes('DSA revision'));
  await B.screenshot({ path: 'screenshots/02-dashboard.png' });
  await B.click('#recentRooms button');
  await B.waitForSelector('#view-room:not([hidden])');
  const afterRefresh = await B.$$eval('.bubble', (n) => n.map((x) => x.textContent));
  check('B history survives refresh', afterRefresh.length === 9 && afterRefresh[0] === 'Hello from A', afterRefresh.length + ' msgs');
  check('B is offline after refresh (not faking connected)', (await B.textContent('#view-room .pill-text')) !== 'Connected');
  check('A notices disconnect', await A.waitForFunction(() => document.querySelector('#view-room .pill-text').textContent === 'Disconnected', null, { timeout: 30000 }).then(() => true).catch(() => false));
  check('A input disabled when disconnected', await A.isDisabled('#messageInput'));

  // ---- history sync: B wipes its copy, then reconnects ----
  await B.click('#btnClear');
  check('B local chat cleared', (await B.$$('.bubble')).length === 0);
  await A.click('#btnReconnect');                       // A creates a new offer for the SAME room
  await A.click('#btnGenerateOffer');
  await A.waitForSelector('#offerBox:not([hidden])', { timeout: 20000 });
  const offer2 = await A.inputValue('#offerCode');
  await B.click('#btnReconnect');                       // B joins
  await B.click('#tabJoin');
  await B.fill('#offerInput', offer2); await B.click('#btnGenerateAnswer');
  await B.waitForSelector('#answerBox:not([hidden])', { timeout: 20000 });
  await A.fill('#answerInput', await B.inputValue('#answerCode')); await A.dispatchEvent('#answerInput', 'paste');   // paste alone must connect
  await B.waitForSelector('#view-room:not([hidden]) .pill[data-tone="good"]', { timeout: 30000 });
  await B.waitForFunction(() => document.querySelectorAll('.bubble').length >= 8, null, { timeout: 15000 }).catch(() => {});
  await B.waitForTimeout(800);
  const synced = await B.$$eval('.bubble', (n) => n.map((x) => x.textContent));
  const aMsgs = await A.$$eval('.bubble', (n) => n.map((x) => x.textContent));
  check('reconnected on same room', (await B.textContent('#roomName')) === 'DSA revision');
  // A never stored 'unique-once' (it was injected raw), so A's copy has 8 messages
  check('history synced back to B (A had 8)', synced.length === 8 && synced[0] === 'Hello from A', synced.length + ' msgs');
  check('A and B identical after sync', JSON.stringify(synced) === JSON.stringify(aMsgs));
  check('no duplicates after sync', new Set(synced.map((x, i) => x + i)).size === synced.length && (await B.textContent('#infoSync')).startsWith('Done'), await B.textContent('#infoSync'));
  await B.fill('#messageInput', 'after reconnect'); await B.press('#messageInput', 'Enter');
  await A.waitForFunction(() => [...document.querySelectorAll('.bubble')].some((b) => b.textContent === 'after reconnect'));
  check('messaging works after reconnect', true);

  // ---- leave ----
  await B.click('#btnLeave');
  check('B leave returns to dashboard', await B.waitForSelector('#view-dashboard:not([hidden])', { timeout: 5000 }).then(() => true).catch(() => false));
  check('A sees peer disconnect after leave', await A.waitForFunction(() => document.querySelector('#view-room .pill-text').textContent === 'Disconnected', null, { timeout: 30000 }).then(() => true).catch(() => false));

  // ---- mobile layout ----
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const M = await ctxM.newPage(); await M.goto(URL);
  await M.screenshot({ path: 'screenshots/05-landing-mobile.png' });
  const overflow = await M.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('mobile landing has no horizontal scroll', !overflow);
  await M.goto(URL + '#/dashboard');
  check('mobile dashboard has no horizontal scroll', !(await M.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));

  await browser.close();
  console.log('\n' + results.filter((r) => r[1]).length + '/' + results.length + ' checks passed');
  if (errors.length) console.log('Page errors:', errors);
  process.exit(results.every((r) => r[1]) && !errors.length ? 0 : 1);
})().catch((e) => { console.error('TEST CRASHED', e); process.exit(2); });
