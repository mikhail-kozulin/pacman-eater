(() => {
  if (window.__pacmanEaterRunning) return;
  window.__pacmanEaterRunning = true;

  const BASE_RADIUS = 12;        // меньше старт (было 20)
  const SPEED = 8.0;             // ×2 в СОЛО (в паре остаётся 4.0)
  const PAIR_SPEED = 4.0;        // парный режим — спокойнее, обоим игрокам
  const BOT_SPEED = 6.0;         // AI-бот ×2 в соло (было 3.0)
  const CAT_SPEED = 4.5;         // в ~3 раза быстрее (хаоса больше)
  const SCAN_INTERVAL = 250;
  const GAME_DURATION = 120_000;
  const SCORE_DIVISOR = 2000;   // в 20 раз медленнее чем раньше (было 100)
  const SCORE_TO_WIN = 400;       // ×2 (было 200)
  const COUNTDOWN_SEC = 3;
  const STAMP_DIST = 50;         // лапки реже, чтоб не сливались
  const GROWTH_FACTOR = 6.0;     // ×2 от прошлого (было 3.0)
  const POOP_RADIUS = 12;
  const POOP_MIN_INTERVAL = 5000;
  const POOP_MAX_INTERVAL = 9000;
  const RESPAWN_MS = 3000;
  const CHERRY_RADIUS = 14;
  const CHERRY_BONUS = 20;             // отображаемых очков за вишенку
  const CHERRY_SPAWN_MIN = 4000;
  const CHERRY_SPAWN_MAX = 9000;
  const MAX_CHERRIES = 4;

  // ─── Фоновый 2: маленькие пакманы делятся ───
  const BG2_START_RADIUS = 6;            // очень маленький старт
  const BG2_BASE_SPEED = 2.0;
  const BG2_SPLIT_PIXELS = 4000;         // съел столько пикселей → делится
  const BG2_MAX_BOTS = 24;
  const BG2_PALETTE = [
    ['#FFCC00', '#FFEE77'], ['#FF4444', '#FF99BB'],
    ['#4488FF', '#99CCFF'], ['#44FF88', '#99FFBB'],
    ['#FF88FF', '#FFBBFF'], ['#FF8844', '#FFBB99'],
    ['#88FFFF', '#BBFFFF'], ['#FFFF88', '#FFFFBB'],
  ];

  let bgCanvas, bgCtx;
  let pawCanvas, pawCtx;
  let fxCanvas, fxCtx;
  let root, hud, screenshotImg;
  let hudElP, hudElB, hudElT;  // прямые ссылки на HUD, без getElementById
  let player, bot, cat;
  let poops = [];
  let autoBots = [];   // только для режима background2
  let keys = {};
  let scorePlayer = 0, scoreBot = 0;
  let areaEaten = 0, totalArea = 0;
  let running = false;
  let movingAllowed = false;
  let startedAt = 0;
  let rafId = null;

  let currentMode = 'single';

  // ═════════ 🔊 8-BIT АУДИО (без файлов, чистый WebAudio) ═════════
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  function beep(freq, duration, type = 'square', volume = 0.08) {
    const ctx = getAudio(); if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = volume;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }
  function slide(fromFreq, toFreq, duration, type = 'sawtooth', volume = 0.15) {
    const ctx = getAudio(); if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(fromFreq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(toFreq, ctx.currentTime + duration);
      gain.gain.value = volume;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }
  function playSound(name) {
    try {
      switch (name) {
        case 'eat': beep(180 + Math.random() * 80, 0.04, 'square', 0.04); break;
        case 'cherry':
          beep(880, 0.08, 'square', 0.18);
          setTimeout(() => beep(1320, 0.12, 'square', 0.18), 80);
          break;
        case 'death': slide(440, 80, 0.4, 'sawtooth', 0.18); break;
        case 'win':
          [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'square', 0.18), i * 110));
          break;
        case 'lose':
          [523, 415, 330, 220].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'square', 0.15), i * 130));
          break;
        case 'countdown': beep(880, 0.08, 'square', 0.12); break;
        case 'go': [880, 1100, 1320].forEach((f, i) => setTimeout(() => beep(f, 0.1, 'square', 0.15), i * 60)); break;
      }
    } catch (e) {}
  }
  // 8-битная фоновая мелодия — простой классический мотив, тихо
  const MELODY = [
    { f: 659, d: 0.12 }, { f: 784, d: 0.12 }, { f: 659, d: 0.12 }, { f: 523, d: 0.18 },
    { f: 440, d: 0.12 }, { f: 523, d: 0.12 }, { f: 440, d: 0.12 }, { f: 349, d: 0.20 },
    { f: 659, d: 0.12 }, { f: 784, d: 0.12 }, { f: 880, d: 0.12 }, { f: 784, d: 0.18 },
    { f: 698, d: 0.12 }, { f: 587, d: 0.12 }, { f: 523, d: 0.12 }, { f: 392, d: 0.25 },
    { f: 0,   d: 0.30 },
  ];
  let musicPlaying = false;
  let musicTimer = null;
  function startMusic() {
    if (musicPlaying) return;
    musicPlaying = true;
    const playLoop = () => {
      if (!musicPlaying) return;
      let t = 0;
      for (const note of MELODY) {
        if (note.f > 0) {
          setTimeout(() => { if (musicPlaying) beep(note.f, note.d * 0.9, 'square', 0.03); }, t);
        }
        t += note.d * 1000;
      }
      musicTimer = setTimeout(playLoop, t);
    };
    playLoop();
  }
  function stopMusic() {
    musicPlaying = false;
    if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
  }

  function catTaunt() {
    try {
      if (!('speechSynthesis' in window)) return;
      const phrases = ['Попался!', 'Хи-хи!', 'Ой-ой!', 'Куда ты?', 'Лови!', 'Ах ты!', 'Мяу!'];
      const u = new SpeechSynthesisUtterance(phrases[Math.floor(Math.random() * phrases.length)]);
      u.lang = 'ru-RU'; u.pitch = 1.6; u.rate = 1.25; u.volume = 0.9;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ═════════ 💥 SCREEN SHAKE ═════════
  let shakeAmount = 0;
  function triggerShake(amount) { shakeAmount = Math.max(shakeAmount, amount); }
  function applyShake() {
    if (!root) return;
    if (shakeAmount > 0.2) {
      const dx = (Math.random() - 0.5) * shakeAmount;
      const dy = (Math.random() - 0.5) * shakeAmount;
      root.style.transform = `translate(${dx}px, ${dy}px)`;
      shakeAmount *= 0.82;
    } else if (shakeAmount > 0) {
      root.style.transform = '';
      shakeAmount = 0;
    }
  }

  // ═════════ 🍒 ВИШЕНКИ-БОНУСЫ ═════════
  let cherries = [];
  let nextCherryAt = 0;
  function cherryTick() {
    if (!running) return;
    const now = performance.now();
    if (now >= nextCherryAt && cherries.length < MAX_CHERRIES) {
      cherries.push({
        x: 40 + Math.random() * (bgCanvas.width - 80),
        y: 40 + Math.random() * (bgCanvas.height - 80),
        r: CHERRY_RADIUS, born: now
      });
      nextCherryAt = now + CHERRY_SPAWN_MIN + Math.random() * (CHERRY_SPAWN_MAX - CHERRY_SPAWN_MIN);
    }
    setTimeout(cherryTick, 600);
  }
  function drawCherries(c) {
    const t = performance.now();
    for (const ch of cherries) {
      const pulse = 1 + Math.sin((t - ch.born) / 200) * 0.1;
      drawCherry(c, ch.x, ch.y, ch.r * pulse);
    }
  }
  function drawCherry(c, x, y, r) {
    c.save();
    c.translate(x, y);
    c.strokeStyle = '#3a7d2c';
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, -r * 0.4);
    c.quadraticCurveTo(-r * 0.4, -r * 1.3, -r * 0.55, -r * 0.35);
    c.moveTo(0, -r * 0.4);
    c.quadraticCurveTo(r * 0.4, -r * 1.3, r * 0.55, -r * 0.35);
    c.stroke();
    for (const [cx, cy] of [[-r * 0.55, r * 0.1], [r * 0.55, r * 0.1]]) {
      c.fillStyle = '#e63946';
      c.beginPath(); c.arc(cx, cy, r * 0.6, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#000'; c.lineWidth = 2; c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.beginPath(); c.arc(cx - r * 0.2, cy - r * 0.2, r * 0.15, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  function checkCherryCollision(entity, isPlayer) {
    for (let i = cherries.length - 1; i >= 0; i--) {
      const ch = cherries[i];
      const dx = entity.x - ch.x, dy = entity.y - ch.y;
      const touchR = entity.radius + ch.r;
      if (dx*dx + dy*dy < touchR * touchR) {
        cherries.splice(i, 1);
        const raw = CHERRY_BONUS * SCORE_DIVISOR;
        if (isPlayer) scorePlayer += raw; else scoreBot += raw;
        entity.pixelsEatenTotal += 800;
        entity.radius = entity.baseR + Math.sqrt(entity.pixelsEatenTotal / 2000) * GROWTH_FACTOR;
        playSound('cherry');
        triggerShake(8);
      }
    }
  }

  function start(screenshotDataUrl, mode) {
    currentMode = mode;
    const W = window.innerWidth;
    const H = window.innerHeight;
    totalArea = W * H;

    root = document.createElement('div');
    root.id = '__pacman_eater_root';
    Object.assign(root.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      background: '#000', cursor: 'none'
    });
    document.documentElement.appendChild(root);

    bgCanvas = document.createElement('canvas');
    bgCanvas.width = W; bgCanvas.height = H;
    Object.assign(bgCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    root.appendChild(bgCanvas);
    bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true });

    pawCanvas = document.createElement('canvas');
    pawCanvas.width = W; pawCanvas.height = H;
    Object.assign(pawCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    root.appendChild(pawCanvas);
    pawCtx = pawCanvas.getContext('2d');

    fxCanvas = document.createElement('canvas');
    fxCanvas.width = W; fxCanvas.height = H;
    Object.assign(fxCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    root.appendChild(fxCanvas);
    fxCtx = fxCanvas.getContext('2d');

    hud = document.createElement('div');
    Object.assign(hud.style, {
      position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)',
      padding: '8px 16px', background: 'rgba(0,0,0,0.78)', color: '#fff',
      fontFamily: '-apple-system, sans-serif', fontSize: '14px', borderRadius: '8px',
      fontWeight: '600', display: 'flex', gap: '20px', alignItems: 'center',
      pointerEvents: 'none'
    });
    const isPair = (currentMode === 'pair');
    const isBg2 = (currentMode === 'background2');
    const p1Label = isPair ? '🟡 P1' : (isBg2 ? '🌌 съедено' : '🟡');
    const p2Label = isPair ? '🔴 P2' : (isBg2 ? '🤖 ботов' : '🤖');
    const ctrlHint = isPair ? 'P1: WASD &nbsp;·&nbsp; P2: ← ↑ → ↓' : (isBg2 ? 'самосплитятся' : 'WASD / ← ↑ → ↓');
    hud.innerHTML = `
      <span style="color:#FFCC00">${p1Label} <span data-pac="player">0</span></span>
      <span style="color:#FF4444">${p2Label} <span data-pac="bot">0</span></span>
      <span style="color:#aaa">цель <b style="color:#fff">${SCORE_TO_WIN}</b></span>
      <span style="color:#aaa">⏱ <span data-pac="time">120</span>с</span>
      <span style="color:#888;font-weight:400;font-size:11px">${ctrlHint} &nbsp;·&nbsp; Esc</span>
    `;
    root.appendChild(hud);
    // Прямые ссылки на элементы HUD — querySelector внутри hud, надёжнее чем getElementById
    hudElP = hud.querySelector('[data-pac="player"]');
    hudElB = hud.querySelector('[data-pac="bot"]');
    hudElT = hud.querySelector('[data-pac="time"]');
    console.log('[PAC] HUD refs:', { hudElP, hudElB, hudElT });

    screenshotImg = new Image();
    screenshotImg.onload = () => {
      bgCtx.drawImage(screenshotImg, 0, 0, W, H);
      if (currentMode === 'background2') {
        initBg2(W, H);
        // Минимум setup: Esc для выхода
        window.addEventListener('keydown', bg2Esc, true);
        runCountdown(() => {
          startedAt = performance.now();
          running = true;
          loopBg2();
          startMusic();
        });
        return;
      }
      initEntities(W, H);
      bindInput();
      runCountdown(() => {
        movingAllowed = true;
        startedAt = performance.now();
        running = true;
        loop();
        botBrainTick();
        catBrainTick();
        cherryTick();
        startMusic();
      });
    };
    screenshotImg.src = screenshotDataUrl;
  }

  function bg2Esc(e) {
    if (e.key === 'Escape') { stop(); e.preventDefault(); }
  }

  // ═════════ 🌌 ФОНОВЫЙ 2: маленькие пакманы делятся ═════════
  function makeAutoBot(x, y, color, pawColor) {
    const a = Math.random() * Math.PI * 2;
    return {
      x, y, startX: x, startY: y,
      dx: Math.cos(a) * BG2_BASE_SPEED, dy: Math.sin(a) * BG2_BASE_SPEED,
      angle: a, mouth: Math.random() * Math.PI * 2,
      lastStampX: x, lastStampY: y, footIndex: 0,
      color, pawColor,
      baseR: BG2_START_RADIUS, radius: BG2_START_RADIUS,
      pixelsEatenTotal: 0, sizePoints: 0,
      alive: true, respawnAt: 0,
      nextDirChange: performance.now() + 600 + Math.random() * 1200,
    };
  }

  function initBg2(W, H) {
    autoBots = [];
    const [c, p] = BG2_PALETTE[0];
    autoBots.push(makeAutoBot(W * 0.5, H * 0.5, c, p));
    console.log('[PAC2] init done, autoBots=', autoBots.length);
  }

  function updateAutoBot(b, W, H, now) {
    // Случайная смена направления
    if (now >= b.nextDirChange) {
      const a = Math.atan2(b.dy, b.dx) + (Math.random() - 0.5) * 1.8;
      b.dx = Math.cos(a) * BG2_BASE_SPEED;
      b.dy = Math.sin(a) * BG2_BASE_SPEED;
      b.angle = a;
      b.nextDirChange = now + 600 + Math.random() * 1400;
    }
    b.x += b.dx; b.y += b.dy;
    // Отскок от стен
    if (b.x < b.radius) { b.x = b.radius; b.dx = Math.abs(b.dx); b.angle = Math.atan2(b.dy, b.dx); }
    if (b.x > W - b.radius) { b.x = W - b.radius; b.dx = -Math.abs(b.dx); b.angle = Math.atan2(b.dy, b.dx); }
    if (b.y < b.radius) { b.y = b.radius; b.dy = Math.abs(b.dy); b.angle = Math.atan2(b.dy, b.dx); }
    if (b.y > H - b.radius) { b.y = H - b.radius; b.dy = -Math.abs(b.dy); b.angle = Math.atan2(b.dy, b.dx); }
    b.mouth = (b.mouth + 0.25) % (Math.PI * 2);
  }

  function maybeSplit(b, idx) {
    if (autoBots.length >= BG2_MAX_BOTS) return;
    if (b.pixelsEatenTotal < BG2_SPLIT_PIXELS) return;
    // СПЛИТ: родитель и ребёнок оба возвращаются к baseR
    b.pixelsEatenTotal = 0;
    b.radius = b.baseR;
    const [c, p] = BG2_PALETTE[autoBots.length % BG2_PALETTE.length];
    const offAng = Math.random() * Math.PI * 2;
    const off = b.baseR * 4;
    const child = makeAutoBot(
      Math.max(b.baseR + 1, Math.min(bgCanvas.width - b.baseR - 1, b.x + Math.cos(offAng) * off)),
      Math.max(b.baseR + 1, Math.min(bgCanvas.height - b.baseR - 1, b.y + Math.sin(offAng) * off)),
      c, p
    );
    autoBots.push(child);
    playSound('cherry');
    triggerShake(10);
  }

  let loopBg2Frame = 0;
  function loopBg2() {
    if (!running) return;
    try {
      loopBg2Frame++;
      if (loopBg2Frame === 1) console.log('[PAC2] loop frame 1');
      const W = bgCanvas.width, H = bgCanvas.height, now = performance.now();
      for (const b of autoBots) updateAutoBot(b, W, H, now);
      for (const b of autoBots) eat(b, true);  // всё в scorePlayer
      for (let i = autoBots.length - 1; i >= 0; i--) maybeSplit(autoBots[i], i);

      applyShake();

      fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
      drawCherries(fxCtx);
      for (const b of autoBots) {
        drawPacman(fxCtx, b.x, b.y, b.radius, b.angle, b.mouth, b.color);
      }
      updateBg2HUD();
    } catch (e) {
      console.error('[PAC2] crash on frame', loopBg2Frame, e);
    }
    rafId = requestAnimationFrame(loopBg2);
  }

  function updateBg2HUD() {
    if (hudElP) hudElP.textContent = fmt(displayScore(scorePlayer));
    if (hudElB) hudElB.textContent = autoBots.length;
    const elapsed = performance.now() - startedAt;
    const left = Math.max(0, Math.ceil((GAME_DURATION - elapsed) / 1000));
    if (hudElT) hudElT.textContent = left;
    if (elapsed >= GAME_DURATION) finish();
  }

  function runCountdown(onDone) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'absolute', inset: '0', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: '-apple-system, sans-serif', fontSize: '180px',
      fontWeight: '800', color: '#FFCC00',
      textShadow: '0 0 30px rgba(0,0,0,0.8)', pointerEvents: 'none',
      zIndex: '2147483647'
    });
    root.appendChild(overlay);

    let n = COUNTDOWN_SEC;
    const tick = () => {
      if (n > 0) {
        overlay.textContent = String(n);
        playSound('countdown');
        n--; setTimeout(tick, 1000);
      } else {
        overlay.textContent = 'GO!';
        overlay.style.color = '#4CFF4C';
        playSound('go');
        setTimeout(() => { overlay.remove(); onDone(); }, 500);
      }
    };
    tick();

    const previewLoop = () => {
      if (!root.contains(overlay) && movingAllowed) return;
      fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
      drawPacman(fxCtx, player.x, player.y, player.radius, player.angle, 0.3, player.color);
      drawPacman(fxCtx, bot.x, bot.y, bot.radius, bot.angle, 0.3, bot.color);
      drawCat(fxCtx, cat.x, cat.y, cat.radius, cat.angle);
      requestAnimationFrame(previewLoop);
    };
    previewLoop();
  }

  function makeEntity(x, y, color, pawColor) {
    return {
      x, y, startX: x, startY: y,
      dx: 0, dy: 0, angle: 0, mouth: 0,
      lastStampX: x, lastStampY: y, footIndex: 0,
      color, pawColor,
      baseR: BASE_RADIUS, radius: BASE_RADIUS,
      sizePoints: 0,
      pixelsEatenTotal: 0,   // для роста — количество съеденных пикселей (без веса по цвету)
      alive: true, respawnAt: 0,
    };
  }

  function initEntities(W, H) {
    // Цвета лапок СВЕТЛЫЕ — для контраста на чёрном TV-фоне после съедания
    player = makeEntity(W * 0.2, H * 0.5, '#FFCC00', '#FFEE77');  // ярко-жёлтые лапки
    bot    = makeEntity(W * 0.8, H * 0.5, '#FF4444', '#FF99BB');  // светло-розовые лапки
    bot.angle = Math.PI;
    // В парном режиме "bot" становится человеком №2 (на стрелках).
    // Доп. поле isHuman2 — на этом завязан updateBot (вместо AI читает клавиши).
    bot.isHuman2 = (currentMode === 'pair');

    // NPC-кот: серый, чёрные лапки, какает, нельзя его съесть
    // Стартует с РАНДОМНЫМ направлением чтоб не было статичен на старте
    const catA = Math.random() * Math.PI * 2;
    cat = {
      x: W * 0.5, y: H * 0.5,
      dx: Math.cos(catA) * CAT_SPEED,
      dy: Math.sin(catA) * CAT_SPEED,
      angle: catA,
      lastStampX: W * 0.5, lastStampY: H * 0.5, footIndex: 0,
      color: '#3A3A3A',
      pawColor: '#FFFFFF',  // БЕЛЫЕ лапки кошки — для контраста на чёрном фоне
      radius: 28,            // ×2 больше прежнего (было 14)
      nextDirChange: performance.now() + 800,
      nextPoop: performance.now() + POOP_MIN_INTERVAL,
    };
    poops = [];
    console.log('[PAC] init done. player=', player.x, player.y, 'bot=', bot.x, bot.y, 'cat=', cat.x, cat.y);
  }

  function bindInput() {
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
  }

  // WASD/ЦФЫВ — игрок 1, стрелки — игрок 2 (только в pair)
  // В соло — оба маппинга работают на player.
  const WASD_MAP = {
    'a': 'left', 'd': 'right', 'w': 'up', 's': 'down',
    'A': 'left', 'D': 'right', 'W': 'up', 'S': 'down',
    'ф': 'left', 'в': 'right', 'ц': 'up', 'ы': 'down',
    'Ф': 'left', 'В': 'right', 'Ц': 'up', 'Ы': 'down',
  };
  const ARROW_MAP = {
    'ArrowLeft': 'left', 'ArrowRight': 'right', 'ArrowUp': 'up', 'ArrowDown': 'down',
  };
  let keys2 = { left: false, right: false, up: false, down: false };

  function onKey(e) {
    if (e.key === 'Escape') { stop(); e.preventDefault(); return; }
    const wasd = WASD_MAP[e.key];
    const arr  = ARROW_MAP[e.key];
    if (currentMode === 'pair') {
      if (wasd) { keys[wasd]  = true; e.preventDefault(); e.stopPropagation(); }
      if (arr)  { keys2[arr]  = true; e.preventDefault(); e.stopPropagation(); }
    } else {
      const dir = wasd || arr;
      if (dir) { keys[dir] = true; e.preventDefault(); e.stopPropagation(); }
    }
  }
  function onKeyUp(e) {
    const wasd = WASD_MAP[e.key];
    const arr  = ARROW_MAP[e.key];
    if (currentMode === 'pair') {
      if (wasd) { keys[wasd]  = false; e.preventDefault(); e.stopPropagation(); }
      if (arr)  { keys2[arr]  = false; e.preventDefault(); e.stopPropagation(); }
    } else {
      const dir = wasd || arr;
      if (dir) { keys[dir] = false; e.preventDefault(); e.stopPropagation(); }
    }
  }

  let loopFrame = 0;
  function loop() {
    if (!running) return;
    try {
      loopFrame++;
      if (loopFrame === 1) console.log('[PAC] loop frame 1');

      checkRespawn(player);
      checkRespawn(bot);

      if (player.alive) updatePlayer();
      if (bot.alive) updateBot();
      updateCat();

      if (player.alive) eat(player, true);
      if (bot.alive) eat(bot, false);

      if (player.alive) checkPoopCollision(player);
      if (bot.alive) checkPoopCollision(bot);

      // 🍒 вишенки
      if (player.alive) checkCherryCollision(player, true);
      if (bot.alive) checkCherryCollision(bot, false);

      // PvP: пакманы могут друг друга съесть
      checkPacmanPvP();

      // 💥 screen shake
      applyShake();

      fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
      drawCherries(fxCtx);
      drawCat(fxCtx, cat.x, cat.y, cat.radius, cat.angle);
      if (player.alive) {
        drawPacman(fxCtx, player.x, player.y, player.radius, player.angle, player.mouth, player.color);
      } else {
        drawRespawnTimer(fxCtx, player);
      }
      if (bot.alive) {
        drawPacman(fxCtx, bot.x, bot.y, bot.radius, bot.angle, performance.now() / 100, bot.color);
      } else {
        drawRespawnTimer(fxCtx, bot);
      }

      updateHUD();
    } catch (e) {
      console.error('[PAC] loop crash on frame', loopFrame, e);
    }
    rafId = requestAnimationFrame(loop);
  }

  function updatePlayer() {
    let dx = 0, dy = 0;
    if (keys['left']) dx -= 1;
    if (keys['right']) dx += 1;
    if (keys['up']) dy -= 1;
    if (keys['down']) dy += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      const sp = (currentMode === 'pair') ? PAIR_SPEED : SPEED;
      player.dx = (dx / len) * sp;
      player.dy = (dy / len) * sp;
      player.angle = Math.atan2(player.dy, player.dx);
    } else { player.dx = 0; player.dy = 0; }
    player.x = clamp(player.x + player.dx, player.radius, bgCanvas.width - player.radius);
    player.y = clamp(player.y + player.dy, player.radius, bgCanvas.height - player.radius);
    player.mouth = (player.mouth + 0.2) % (Math.PI * 2);
  }

  function updateBot() {
    // В парном режиме bot — это второй человек на стрелках
    if (bot.isHuman2) {
      let dx = 0, dy = 0;
      if (keys2['left']) dx -= 1;
      if (keys2['right']) dx += 1;
      if (keys2['up']) dy -= 1;
      if (keys2['down']) dy += 1;
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        // Bot тут — это P2 в парном режиме, использует PAIR_SPEED
        bot.dx = (dx / len) * PAIR_SPEED;
        bot.dy = (dy / len) * PAIR_SPEED;
        bot.angle = Math.atan2(bot.dy, bot.dx);
      } else { bot.dx = 0; bot.dy = 0; }
      bot.mouth = (bot.mouth + 0.2) % (Math.PI * 2);
    }
    bot.x = clamp(bot.x + bot.dx, bot.radius, bgCanvas.width - bot.radius);
    bot.y = clamp(bot.y + bot.dy, bot.radius, bgCanvas.height - bot.radius);
  }

  function botBrainTick() {
    if (!running) return;
    // В парном режиме бот не нужен — управляется человеком
    if (bot.isHuman2) { setTimeout(botBrainTick, SCAN_INTERVAL); return; }
    if (!bot.alive) { setTimeout(botBrainTick, SCAN_INTERVAL); return; }
    const directions = [];
    const SCAN_DIST = 90;
    const SCAN_R = 28;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tx = bot.x + Math.cos(a) * SCAN_DIST;
      const ty = bot.y + Math.sin(a) * SCAN_DIST;
      if (tx < bot.radius || tx > bgCanvas.width - bot.radius ||
          ty < bot.radius || ty > bgCanvas.height - bot.radius) continue;
      // Бот избегает направлений с какашками
      if (poopNear(tx, ty, SCAN_R + POOP_RADIUS)) continue;
      const d = sampleDarkness(tx, ty, SCAN_R);
      directions.push({ a, d });
    }
    if (directions.length) {
      directions.sort((a, b) => b.d - a.d);
      const pick = directions[Math.floor(Math.random() * Math.min(3, directions.length))];
      bot.dx = Math.cos(pick.a) * BOT_SPEED;
      bot.dy = Math.sin(pick.a) * BOT_SPEED;
      bot.angle = pick.a;
    }
    setTimeout(botBrainTick, SCAN_INTERVAL);
  }

  function poopNear(x, y, r) {
    for (const p of poops) {
      const dx = x - p.x, dy = y - p.y;
      if (dx*dx + dy*dy < r*r) return true;
    }
    return false;
  }

  function sampleDarkness(x, y, r) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) return 0;
    const sx = Math.max(0, Math.floor(x - r)) | 0;
    const sy = Math.max(0, Math.floor(y - r)) | 0;
    const w = Math.min(bgCanvas.width - sx, Math.floor(r * 2)) | 0;
    const h = Math.min(bgCanvas.height - sy, Math.floor(r * 2)) | 0;
    if (w <= 0 || h <= 0) return 0;
    const data = bgCtx.getImageData(sx, sy, w, h).data;
    let sum = 0, count = 0;
    for (let i = 0; i < data.length; i += 16) {
      if (data[i+3] < 255) continue;  // съеденное — бот туда не пойдёт
      sum += 1 - (data[i] + data[i+1] + data[i+2]) / (3 * 255);
      count++;
    }
    return count ? sum / count : 0;
  }

  function eat(entity, isPlayer) {
    const r = entity.radius;
    if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y) || !Number.isFinite(r)) {
      console.warn('[PAC] eat: bad entity', { x: entity.x, y: entity.y, r });
      return;
    }
    const sx = Math.max(0, Math.floor(entity.x - r)) | 0;
    const sy = Math.max(0, Math.floor(entity.y - r)) | 0;
    const w = Math.min(bgCanvas.width - sx, Math.floor(r * 2)) | 0;
    const h = Math.min(bgCanvas.height - sy, Math.floor(r * 2)) | 0;
    if (w <= 0 || h <= 0) return;

    const img = bgCtx.getImageData(sx, sy, w, h);
    const data = img.data;
    let gained = 0;
    let pixelsEaten = 0;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const dx = px - r, dy = py - r;
        if (dx*dx + dy*dy > r*r) continue;
        const i = (py * w + px) * 4;
        // Маркер «уже съедено» — alpha=254. Уже съеденные ПРОПУСКАЕМ
        // (раньше перерандомизировали → перф квадратично с радиусом).
        if (data[i+3] < 255) continue;
        const R = data[i], G = data[i+1], B = data[i+2];
        const d = 1 - (R + G + B) / (3 * 255);
        const points = d < 0.3 ? d * 1 : d * 3;
        gained += points;
        pixelsEaten++;
        // TV-шум: чёрный фон + редкие цветные точки
        const noise = Math.random();
        if (noise < 0.72)      { data[i] = 0;   data[i+1] = 0;   data[i+2] = 0; }
        else if (noise < 0.82) { data[i] = 230; data[i+1] = 230; data[i+2] = 230; }
        else if (noise < 0.88) { data[i] = 220; data[i+1] = 40;  data[i+2] = 40; }
        else if (noise < 0.94) { data[i] = 40;  data[i+1] = 200; data[i+2] = 40; }
        else                   { data[i] = 40;  data[i+1] = 80;  data[i+2] = 240; }
        data[i+3] = 254;
      }
    }
    // Пишем обратно только если реально что-то поменяли
    if (pixelsEaten > 0) {
      bgCtx.putImageData(img, sx, sy);
      // Чавкаем не чаще раза в 200мс на сущность
      if (!entity._lastEatT || performance.now() - entity._lastEatT > 200) {
        playSound('eat');
        entity._lastEatT = performance.now();
      }
    }
    if (pixelsEaten > 0 && Number.isFinite(gained)) {
      areaEaten += pixelsEaten;
      if (isPlayer) scorePlayer += gained;
      else scoreBot += gained;
      // Рост — по количеству съеденных пикселей, без веса по цвету
      entity.pixelsEatenTotal += pixelsEaten;
      const newR = entity.baseR + Math.sqrt(entity.pixelsEatenTotal / 2000) * GROWTH_FACTOR;
      entity.radius = Number.isFinite(newR) ? newR : entity.baseR;
    }

    // Штамп лапки если сдвинулись достаточно далеко
    const ddx = entity.x - entity.lastStampX;
    const ddy = entity.y - entity.lastStampY;
    if (ddx*ddx + ddy*ddy >= STAMP_DIST*STAMP_DIST) {
      stampPaw(entity);
      entity.lastStampX = entity.x;
      entity.lastStampY = entity.y;
      entity.footIndex = 1 - entity.footIndex;
    }
  }

  // Лапка — в два раза меньше чем была
  function stampPaw(entity) {
    const sideOffset = entity.footIndex === 0 ? -1.5 : 1.5;
    const angle = entity.angle || 0;
    const jitter = (Math.random() - 0.5) * 1.5;
    const px = entity.x + Math.cos(angle + Math.PI/2) * sideOffset + Math.cos(angle) * jitter;
    const py = entity.y + Math.sin(angle + Math.PI/2) * sideOffset + Math.sin(angle) * jitter;
    const rotJitter = (Math.random() - 0.5) * 0.35;

    pawCtx.save();
    pawCtx.translate(px, py);
    pawCtx.rotate(angle + Math.PI/2 + rotJitter);
    pawCtx.fillStyle = entity.pawColor;
    pawCtx.globalAlpha = 0.92;

    // Подушечка пятки (половина прежнего размера)
    pawCtx.beginPath();
    pawCtx.ellipse(0, 2.5, 4, 5.5, 0, 0, Math.PI * 2);
    pawCtx.fill();

    // 4 пальчика (половина)
    const toes = [
      { ax: -5,   ay: -2.5, r: 1.6 },
      { ax: -2,   ay: -5.5, r: 1.8 },
      { ax:  2,   ay: -5.5, r: 1.8 },
      { ax:  5,   ay: -2.5, r: 1.6 },
    ];
    for (const t of toes) {
      pawCtx.beginPath();
      pawCtx.arc(t.ax, t.ay, t.r, 0, Math.PI * 2);
      pawCtx.fill();
    }
    pawCtx.restore();
  }

  // ============ NPC-КОТ ============

  function updateCat() {
    cat.x = clamp(cat.x + cat.dx, cat.radius, bgCanvas.width - cat.radius);
    cat.y = clamp(cat.y + cat.dy, cat.radius, bgCanvas.height - cat.radius);

    // Штамп чёрной лапки
    const ddx = cat.x - cat.lastStampX;
    const ddy = cat.y - cat.lastStampY;
    if (ddx*ddx + ddy*ddy >= STAMP_DIST*STAMP_DIST) {
      stampPaw(cat);
      cat.lastStampX = cat.x;
      cat.lastStampY = cat.y;
      cat.footIndex = 1 - cat.footIndex;
    }
  }

  function catBrainTick() {
    if (!running) return;
    const now = performance.now();
    // Смена направления каждые 0.5–2 сек
    if (now >= cat.nextDirChange) {
      const a = Math.random() * Math.PI * 2;
      cat.dx = Math.cos(a) * CAT_SPEED;
      cat.dy = Math.sin(a) * CAT_SPEED;
      cat.angle = a;
      cat.nextDirChange = now + 250 + Math.random() * 700;  // чаще меняет направление
    }
    // Какает каждые 5–9 сек
    if (now >= cat.nextPoop) {
      dropPoop(cat.x, cat.y);
      cat.nextPoop = now + POOP_MIN_INTERVAL + Math.random() * (POOP_MAX_INTERVAL - POOP_MIN_INTERVAL);
    }
    setTimeout(catBrainTick, 100);
  }

  function drawCat(c, x, y, r, angle) {
    c.save();
    c.translate(x, y);
    // Уши всегда смотрят ВВЕРХ. Зеркалим горизонтально если идёт влево.
    // (Раньше rotate(angle) переворачивал кошку вверх ногами при движении влево.)
    if (Math.cos(angle) < 0) c.scale(-1, 1);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    const lineW = Math.max(2, r * 0.14);

    // РАДУЖНАЯ КОШКА: основной цвет циклится по HSL во времени
    const t = performance.now() / 30;  // скорость цикла
    const bodyHue = t % 360;
    const earHueL = (t + 60) % 360;
    const earHueR = (t + 120) % 360;
    const bodyColor = `hsl(${bodyHue}, 85%, 55%)`;
    const earColorL = `hsl(${earHueL}, 85%, 55%)`;
    const earColorR = `hsl(${earHueR}, 85%, 55%)`;

    // Ушки (треугольники) — разных цветов
    drawCatEar(c, -r * 0.55, -r * 0.65, r, earColorL, '#FFB3BA', lineW);
    drawCatEar(c,  r * 0.55, -r * 0.65, r, earColorR, '#FFB3BA', lineW);

    // Тело — большая радужная клякса
    c.fillStyle = bodyColor;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.closePath();
    c.fill();
    c.strokeStyle = '#000';
    c.lineWidth = lineW;
    c.stroke();

    // Полоски (как у тигра) — другого радужного оттенка
    c.strokeStyle = `hsl(${(t + 180) % 360}, 85%, 35%)`;
    c.lineWidth = lineW * 0.6;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.arc(0, 0, r * 0.7, Math.PI * 0.7 + i * 0.3, Math.PI * 0.95 + i * 0.3);
      c.stroke();
    }

    // Два глаза (большие зелёные, светятся)
    for (const ex of [-r * 0.32, r * 0.32]) {
      c.fillStyle = '#9DFF6B';
      c.beginPath();
      c.arc(ex, -r * 0.15, r * 0.22, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#000';
      c.lineWidth = lineW * 0.5;
      c.stroke();
      c.fillStyle = '#000';
      c.beginPath();
      c.ellipse(ex, -r * 0.15, r * 0.06, r * 0.2, 0, 0, Math.PI * 2);
      c.fill();
    }

    // Носик-сердечко
    c.fillStyle = '#FF69B4';
    c.beginPath();
    c.moveTo(0, r * 0.15);
    c.lineTo(-r * 0.12, r * 0.05);
    c.lineTo(r * 0.12, r * 0.05);
    c.closePath();
    c.fill();
    c.strokeStyle = '#000';
    c.lineWidth = lineW * 0.4;
    c.stroke();

    c.restore();
  }

  // ============ КАКАШКИ ============

  function dropPoop(x, y) {
    const poop = { x, y, r: POOP_RADIUS };
    poops.push(poop);
    // Рисуем перманентно на pawCanvas
    pawCtx.save();
    pawCtx.translate(x, y);
    pawCtx.strokeStyle = '#000';
    pawCtx.lineWidth = 1.5;
    pawCtx.globalAlpha = 1;
    // 3 пересекающихся овала — куча
    const blobs = [
      { ox: -3, oy: 2, w: 8, h: 6, rot: 0.3 },
      { ox: 3, oy: -2, w: 9, h: 6.5, rot: -0.2 },
      { ox: 0, oy: 4, w: 7.5, h: 5.5, rot: 0.1 },
    ];
    for (const b of blobs) {
      pawCtx.fillStyle = '#4A2F1A';
      pawCtx.beginPath();
      pawCtx.ellipse(b.ox, b.oy, b.w, b.h, b.rot, 0, Math.PI * 2);
      pawCtx.fill();
      pawCtx.stroke();
    }
    // Блик сверху для объёма
    pawCtx.fillStyle = 'rgba(255,255,255,0.25)';
    pawCtx.beginPath();
    pawCtx.ellipse(-1, -3, 2.5, 1.5, 0, 0, Math.PI * 2);
    pawCtx.fill();
    pawCtx.restore();
  }

  // PvP: пакманы трогаются → больший ест меньшего ИЛИ кто наступает агрессивнее тот и ест.
  // Лоб в лоб → отскок.
  function checkPacmanPvP() {
    if (!player.alive || !bot.alive) return;
    const dx = bot.x - player.x;
    const dy = bot.y - player.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const touchDist = (player.radius + bot.radius) * 0.85;
    if (dist >= touchDist || dist < 0.001) return;

    // Размер не учитываем. Решает кто агрессивнее наступает.
    const playerApproach = (player.dx * dx + player.dy * dy) / dist;
    const botApproach   = -(bot.dx * dx + bot.dy * dy) / dist;

    if (playerApproach > botApproach + 0.8) {
      die(bot);
    } else if (botApproach > playerApproach + 0.8) {
      die(player);
    } else {
      // Лоб в лоб или скользящее касание — отскок
      const overlap = touchDist - dist + 1;
      const nx = dx / dist, ny = dy / dist;
      player.x = clamp(player.x - nx * overlap / 2, player.radius, bgCanvas.width - player.radius);
      player.y = clamp(player.y - ny * overlap / 2, player.radius, bgCanvas.height - player.radius);
      bot.x = clamp(bot.x + nx * overlap / 2, bot.radius, bgCanvas.width - bot.radius);
      bot.y = clamp(bot.y + ny * overlap / 2, bot.radius, bgCanvas.height - bot.radius);
    }
  }

  function checkPoopCollision(entity) {
    for (const p of poops) {
      const dx = entity.x - p.x, dy = entity.y - p.y;
      const collisionR = entity.radius * 0.5 + p.r * 0.5;
      if (dx*dx + dy*dy < collisionR * collisionR) {
        catTaunt();  // 🐱 "Попался!"
        die(entity);
        return;
      }
    }
  }

  function die(entity) {
    entity.alive = false;
    entity.respawnAt = performance.now() + RESPAWN_MS;
    entity.sizePoints = 0;
    entity.pixelsEatenTotal = 0;
    entity.radius = entity.baseR;
    entity.dx = 0;
    entity.dy = 0;
    playSound('death');
    triggerShake(18);
  }

  function checkRespawn(entity) {
    if (entity.alive) return;
    if (performance.now() >= entity.respawnAt) {
      entity.alive = true;
      entity.x = entity.startX;
      entity.y = entity.startY;
      entity.lastStampX = entity.x;
      entity.lastStampY = entity.y;
    }
  }

  function drawRespawnTimer(c, entity) {
    const left = Math.max(0, Math.ceil((entity.respawnAt - performance.now()) / 1000));
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.7)';
    c.beginPath();
    c.arc(entity.startX, entity.startY, 26, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = entity.color;
    c.font = 'bold 30px -apple-system, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(left, entity.startX, entity.startY);
    c.restore();
  }

  // ============ РИСОВАНИЕ ПАКМАНА ============

  function drawPacman(c, x, y, r, angle, mouthPhase, color) {
    const mouth = (Math.sin(mouthPhase) + 1) / 2 * 0.5 + 0.05;
    const lineW = Math.max(2.5, r * 0.14);
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.lineJoin = 'round';
    c.lineCap = 'round';

    drawCatEar(c, -r * 0.55, -r * 0.65, r, color, '#FFB3BA', lineW);
    drawCatEar(c,  r * 0.55, -r * 0.65, r, color, '#FFB3BA', lineW);

    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, r, mouth, Math.PI * 2 - mouth);
    c.closePath();
    c.fill();
    c.strokeStyle = '#000';
    c.lineWidth = lineW;
    c.stroke();

    c.fillStyle = '#FFF';
    c.beginPath();
    c.arc(0, -r * 0.4, r * 0.25, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#000';
    c.lineWidth = lineW * 0.6;
    c.stroke();
    c.fillStyle = '#000';
    c.beginPath();
    c.arc(r * 0.05, -r * 0.4, r * 0.13, 0, Math.PI * 2);
    c.fill();

    c.restore();
  }

  function drawCatEar(c, baseX, baseY, r, fillColor, innerColor, lineW) {
    const w = r * 0.55;
    const h = r * 1.0;
    c.beginPath();
    c.moveTo(baseX - w, baseY);
    c.lineTo(baseX + w, baseY);
    c.lineTo(baseX, baseY - h);
    c.closePath();
    c.fillStyle = fillColor;
    c.fill();
    c.strokeStyle = '#000';
    c.lineWidth = lineW;
    c.stroke();
    c.beginPath();
    c.moveTo(baseX - w * 0.55, baseY - h * 0.1);
    c.lineTo(baseX + w * 0.55, baseY - h * 0.1);
    c.lineTo(baseX, baseY - h * 0.75);
    c.closePath();
    c.fillStyle = innerColor;
    c.fill();
  }

  // ============ HUD / ФИНАЛ ============

  function updateHUD() {
    const p = displayScore(scorePlayer);
    const b = displayScore(scoreBot);
    if (hudElP) hudElP.textContent = fmt(p);
    if (hudElB) hudElB.textContent = fmt(b);
    const elapsed = performance.now() - startedAt;
    const left = Math.max(0, Math.ceil((GAME_DURATION - elapsed) / 1000));
    if (hudElT) hudElT.textContent = left;
    if (p >= SCORE_TO_WIN || b >= SCORE_TO_WIN || elapsed >= GAME_DURATION) finish();
  }

  function displayScore(raw) {
    if (!Number.isFinite(raw)) return 0;
    return Math.floor(raw / SCORE_DIVISOR);
  }
  function fmt(n) {
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('ru-RU').replace(/,/g, ' ');
  }

  function finish() {
    if (!running) return;
    running = false;
    const p = displayScore(scorePlayer);
    const b = displayScore(scoreBot);
    const isPair = (currentMode === 'pair');
    let winner;
    stopMusic();
    if (p === b) { winner = '🤝 Ничья'; }
    else if (isPair) {
      winner = p > b ? '🟡 Игрок 1 победил!' : '🔴 Игрок 2 победил!';
      playSound('win');
    }
    else {
      winner = p > b ? '🟡 Ты победил!' : '🤖 Бот победил';
      playSound(p > b ? 'win' : 'lose');
    }
    triggerShake(25);
    const banner = document.createElement('div');
    Object.assign(banner.style, {
      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
      padding: '30px 50px', background: 'rgba(0,0,0,0.92)', color: '#fff',
      fontFamily: '-apple-system, sans-serif', fontSize: '24px', borderRadius: '12px',
      textAlign: 'center', zIndex: '2147483647', minWidth: '320px'
    });
    banner.innerHTML = `
      <div style="font-size:34px;margin-bottom:14px">${winner}</div>
      <div style="font-size:20px;margin-bottom:6px">
        <span style="color:#FFCC00">🟡 ${fmt(p)}</span>
        &nbsp;·&nbsp;
        <span style="color:#FF4444">🤖 ${fmt(b)}</span>
      </div>
      <div style="font-size:13px;color:#aaa;margin-top:4px">цель была ${SCORE_TO_WIN}</div>
      <div style="font-size:13px;color:#888;margin-top:16px">Esc — закрыть</div>
    `;
    root.appendChild(banner);
  }

  function stop() {
    running = false;
    movingAllowed = false;
    stopMusic();
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    if (root) root.remove();
    window.__pacmanEaterRunning = false;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START_PACMAN') start(msg.screenshot, msg.mode || 'single');
  });
})();
// ============================================================
// ФОНОВЫЙ РЕЖИМ — полностью отдельная функция.
// Не трогает игровой код выше. Свой guard-флаг, свой listener,
// своё рисование котика. Живёт поверх живой страницы и удаляет
// реальные DOM-элементы по пути.
// ============================================================
(() => {
  if (window.__pacmanBgLoaded) return;
  window.__pacmanBgLoaded = true;

  const IDLE_MS = 3000;            // 3с без активности → котик появляется (просьба Михаила)
  const IDLE_CHECK_MS = 400;
  const CAT_BASE_SPEED = 5.2;      // стартовая скорость сессии
  const CAT_MAX_SPEED = 22;        // верхний потолок (px/frame)
  const CAT_ACCEL_PER_SEC = 0.7;   // прирост скорости в сек
  const CAT_R = 34;

  // Текущая скорость = base + elapsed * accel, capped at max
  function currentCatSpeed() {
    if (!state.sessionStartedAt) return CAT_BASE_SPEED;
    const elapsed = (performance.now() - state.sessionStartedAt) / 1000;
    return Math.min(CAT_MAX_SPEED, CAT_BASE_SPEED + elapsed * CAT_ACCEL_PER_SEC);
  }
  const Z_TOP = '2147483647';
  const ACT_EVENTS = ['mousemove', 'mousedown', 'mouseup', 'click', 'keydown', 'wheel', 'touchstart', 'touchmove'];

  const state = {
    enabled: false,
    sessionOn: false,
    lastActivityAt: 0,
    cat: null,
    canvas: null,
    ctx: null,
    rafId: null,
    idleTimer: null,
    indicator: null,
    fx: [],
  };

  function enableMode() {
    if (state.enabled) return;
    state.enabled = true;
    state.lastActivityAt = performance.now();
    ACT_EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { capture: true, passive: true }));
    window.addEventListener('scroll', onActivity, { capture: true, passive: true });
    showIndicator();
    scheduleIdleCheck();
    console.log('[PAC-BG] mode ON');
  }

  function disableMode() {
    if (!state.enabled) return;
    state.enabled = false;
    endSession();
    ACT_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity, { capture: true }));
    window.removeEventListener('scroll', onActivity, { capture: true });
    if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
    hideIndicator();
    console.log('[PAC-BG] mode OFF');
  }

  function onActivity(e) {
    state.lastActivityAt = performance.now();
    if (state.sessionOn) {
      // Esc во время сессии — вырубить весь режим, чтоб котик не возвращался
      if (e && e.type === 'keydown' && e.key === 'Escape') {
        disableMode();
        return;
      }
      endSession();
    }
  }

  function scheduleIdleCheck() {
    if (!state.enabled) return;
    state.idleTimer = setTimeout(() => {
      if (!state.enabled) return;
      const now = performance.now();
      if (!state.sessionOn && now - state.lastActivityAt >= IDLE_MS) {
        startSession();
      }
      scheduleIdleCheck();
    }, IDLE_CHECK_MS);
  }

  function startSession() {
    if (state.sessionOn) return;
    state.sessionOn = true;
    state.sessionStartedAt = performance.now();  // для разгона скорости

    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-pacman-overlay', 'bg-canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    Object.assign(canvas.style, {
      position: 'fixed', left: '0', top: '0',
      width: '100vw', height: '100vh',
      pointerEvents: 'none', zIndex: Z_TOP,
    });
    document.documentElement.appendChild(canvas);
    state.canvas = canvas;
    state.ctx = canvas.getContext('2d');

    const a = Math.random() * Math.PI * 2;
    state.cat = {
      x: window.innerWidth * (0.25 + Math.random() * 0.5),
      y: window.innerHeight * (0.25 + Math.random() * 0.5),
      dx: Math.cos(a) * CAT_BASE_SPEED,
      dy: Math.sin(a) * CAT_BASE_SPEED,
      angle: a,
      mouth: 0,
      r: CAT_R,
      nextDirChange: performance.now() + 1500,
    };
    state.fx = [];
    if (state.indicator) state.indicator.style.background = 'rgba(123, 97, 255, 0.85)';

    loop();
    console.log('[PAC-BG] session START');
  }

  function endSession() {
    if (!state.sessionOn) return;
    state.sessionOn = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    if (state.canvas) state.canvas.remove();
    state.canvas = null;
    state.ctx = null;
    state.cat = null;
    state.fx = [];
    if (state.indicator) state.indicator.style.background = 'rgba(0,0,0,0.7)';
    console.log('[PAC-BG] session END');
  }

  function loop() {
    if (!state.sessionOn) return;
    const cat = state.cat;
    const ctx = state.ctx;
    const canvas = state.canvas;

    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    const W = canvas.width, H = canvas.height, r = cat.r;

    // Плавный разгон: каждый кадр нормируем вектор к текущей скорости
    const targetSpeed = currentCatSpeed();
    const curMag = Math.hypot(cat.dx, cat.dy);
    if (curMag > 0.01) {
      const scale = targetSpeed / curMag;
      cat.dx *= scale; cat.dy *= scale;
    }

    cat.x += cat.dx;
    cat.y += cat.dy;

    let bounced = false;
    if (cat.x < r) { cat.x = r; cat.dx = Math.abs(cat.dx); bounced = true; }
    if (cat.x > W - r) { cat.x = W - r; cat.dx = -Math.abs(cat.dx); bounced = true; }
    if (cat.y < r) { cat.y = r; cat.dy = Math.abs(cat.dy); bounced = true; }
    if (cat.y > H - r) { cat.y = H - r; cat.dy = -Math.abs(cat.dy); bounced = true; }

    const now = performance.now();
    if (now >= cat.nextDirChange || bounced) {
      const ang = Math.atan2(cat.dy, cat.dx) + (Math.random() - 0.5) * 1.6;
      cat.dx = Math.cos(ang) * targetSpeed;
      cat.dy = Math.sin(ang) * targetSpeed;
      cat.nextDirChange = now + 1200 + Math.random() * 2000;
    }

    cat.angle = Math.atan2(cat.dy, cat.dx);
    cat.mouth = (cat.mouth + 0.25) % (Math.PI * 2);

    tryEat(cat);

    ctx.clearRect(0, 0, W, H);
    drawFx(ctx, now);
    drawCatPacman(ctx, cat);

    state.rafId = requestAnimationFrame(loop);
  }

  function tryEat(cat) {
    // 2 точки — центр и кончик морды, чтоб ловить элементы по ходу движения
    const points = [
      [cat.x, cat.y],
      [cat.x + Math.cos(cat.angle) * cat.r * 0.7, cat.y + Math.sin(cat.angle) * cat.r * 0.7],
    ];
    const seen = new Set();
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      let els;
      try { els = document.elementsFromPoint(x, y); } catch (_) { continue; }
      if (!els) continue;
      for (const el of els) {
        if (!el || seen.has(el)) continue;
        seen.add(el);
        if (!isEatable(el)) continue;
        eatElement(el);
        return; // одно поедание за кадр — чтоб видеть эффект
      }
    }
  }

  function isEatable(el) {
    if (!el || !el.tagName) return false;
    // Наш собственный канвас и индикатор — не трогаем
    if (el.hasAttribute && el.hasAttribute('data-pacman-overlay')) return false;
    if (el.closest && el.closest('[data-pacman-overlay]')) return false;
    // Контейнеры верхнего уровня — не трогаем (иначе одним укусом сожрём всю страницу)
    const tag = el.tagName;
    if (tag === 'HTML' || tag === 'BODY') return false;
    let rect;
    try { rect = el.getBoundingClientRect(); } catch (_) { return false; }
    const vw = window.innerWidth, vh = window.innerHeight;
    if (rect.width < 4 || rect.height < 4) return false;
    if (rect.width * rect.height > vw * vh * 0.45) return false; // слишком жирный — пропускаем, котик идёт дальше
    return true;
  }

  function eatElement(el) {
    let rect;
    try { rect = el.getBoundingClientRect(); } catch (_) { return; }
    state.fx.push({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      bornAt: performance.now(),
      r: Math.min(70, Math.max(20, Math.max(rect.width, rect.height) * 0.5 + 12)),
    });
    try { el.remove(); } catch (_) {}
  }

  function drawFx(ctx, now) {
    const DUR = 380;
    const next = [];
    for (const fx of state.fx) {
      const age = now - fx.bornAt;
      if (age >= DUR) continue;
      next.push(fx);
      const t = age / DUR;
      const rr = fx.r * (0.4 + t * 0.9);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = `hsl(${(now / 18) % 360}, 90%, 60%)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 2.5;
        const sx = fx.x + Math.cos(a) * rr;
        const sy = fx.y + Math.sin(a) * rr;
        ctx.fillStyle = `hsl(${(now / 18 + i * 60) % 360}, 90%, 70%)`;
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    state.fx = next;
  }

  function drawCatPacman(ctx, cat) {
    const r = cat.r;
    const mouth = (Math.sin(cat.mouth) + 1) / 2 * 0.55 + 0.08;
    const lineW = Math.max(2.5, r * 0.13);
    const t = performance.now() / 30;
    const body = `hsl(${t % 360}, 85%, 58%)`;
    const earL = `hsl(${(t + 60) % 360}, 85%, 58%)`;
    const earR = `hsl(${(t + 120) % 360}, 85%, 58%)`;

    ctx.save();
    ctx.translate(cat.x, cat.y);
    ctx.rotate(cat.angle);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    drawEar(ctx, -r * 0.55, -r * 0.65, r, earL, '#FFB3BA', lineW);
    drawEar(ctx,  r * 0.55, -r * 0.65, r, earR, '#FFB3BA', lineW);

    // Тело пакмана с чавкающим ртом
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, mouth, Math.PI * 2 - mouth);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = lineW;
    ctx.stroke();

    // Глаз
    ctx.fillStyle = '#FFF';
    ctx.beginPath();
    ctx.arc(0, -r * 0.4, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = lineW * 0.6;
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(r * 0.05, -r * 0.4, r * 0.13, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawEar(ctx, baseX, baseY, r, fillColor, innerColor, lineW) {
    const w = r * 0.55;
    const h = r * 1.0;
    ctx.beginPath();
    ctx.moveTo(baseX - w, baseY);
    ctx.lineTo(baseX + w, baseY);
    ctx.lineTo(baseX, baseY - h);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = lineW;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(baseX - w * 0.55, baseY - h * 0.1);
    ctx.lineTo(baseX + w * 0.55, baseY - h * 0.1);
    ctx.lineTo(baseX, baseY - h * 0.75);
    ctx.closePath();
    ctx.fillStyle = innerColor;
    ctx.fill();
  }

  function showIndicator() {
    if (state.indicator) return;
    const ind = document.createElement('div');
    ind.setAttribute('data-pacman-overlay', 'bg-indicator');
    ind.textContent = '🐱 фоновый режим (Esc — выкл)';
    Object.assign(ind.style, {
      position: 'fixed', right: '12px', bottom: '12px',
      padding: '6px 10px',
      background: 'rgba(0,0,0,0.7)', color: '#FFCC00',
      fontFamily: '-apple-system, sans-serif', fontSize: '12px',
      fontWeight: '600', borderRadius: '6px',
      pointerEvents: 'none', zIndex: Z_TOP,
      userSelect: 'none',
    });
    document.documentElement.appendChild(ind);
    state.indicator = ind;
  }

  function hideIndicator() {
    if (state.indicator) { state.indicator.remove(); state.indicator = null; }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'TOGGLE_BACKGROUND') {
      if (state.enabled) disableMode();
      else enableMode();
    }
  });
})();
