(() => {
  if (window.__pacmanEaterRunning) return;
  window.__pacmanEaterRunning = true;

  const BASE_RADIUS = 20;
  const SPEED = 4.0;
  const BOT_SPEED = 3.0;
  const CAT_SPEED = 1.6;
  const SCAN_INTERVAL = 250;
  const GAME_DURATION = 120_000;
  const SCORE_DIVISOR = 2000;   // в 20 раз медленнее чем раньше (было 100)
  const SCORE_TO_WIN = 200;
  const COUNTDOWN_SEC = 3;
  const STAMP_DIST = 50;         // лапки реже, чтоб не сливались
  const GROWTH_FACTOR = 3.0;     // sqrt(sizePoints) * GROWTH_FACTOR = доп. радиус (×2 быстрее)
  const POOP_RADIUS = 12;
  const POOP_MIN_INTERVAL = 5000;
  const POOP_MAX_INTERVAL = 9000;
  const RESPAWN_MS = 3000;

  let bgCanvas, bgCtx;
  let pawCanvas, pawCtx;
  let fxCanvas, fxCtx;
  let root, hud, screenshotImg;
  let hudElP, hudElB, hudElT;  // прямые ссылки на HUD, без getElementById
  let player, bot, cat;
  let poops = [];
  let keys = {};
  let scorePlayer = 0, scoreBot = 0;
  let areaEaten = 0, totalArea = 0;
  let running = false;
  let movingAllowed = false;
  let startedAt = 0;
  let rafId = null;

  function start(screenshotDataUrl) {
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
    hud.innerHTML = `
      <span style="color:#FFCC00">🟡 <span data-pac="player">0</span></span>
      <span style="color:#FF4444">🤖 <span data-pac="bot">0</span></span>
      <span style="color:#aaa">цель <b style="color:#fff">${SCORE_TO_WIN}</b></span>
      <span style="color:#aaa">⏱ <span data-pac="time">120</span>с</span>
      <span style="color:#888;font-weight:400;font-size:11px">WASD / ← ↑ → ↓ &nbsp;·&nbsp; Esc</span>
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
      initEntities(W, H);
      bindInput();
      runCountdown(() => {
        movingAllowed = true;
        startedAt = performance.now();
        running = true;
        loop();
        botBrainTick();
        catBrainTick();
      });
    };
    screenshotImg.src = screenshotDataUrl;
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
      if (n > 0) { overlay.textContent = String(n); n--; setTimeout(tick, 1000); }
      else {
        overlay.textContent = 'GO!';
        overlay.style.color = '#4CFF4C';
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
      alive: true, respawnAt: 0,
    };
  }

  function initEntities(W, H) {
    player = makeEntity(W * 0.2, H * 0.5, '#FFCC00', '#6B4F1D');
    bot    = makeEntity(W * 0.8, H * 0.5, '#FF4444', '#8B0000');
    bot.angle = Math.PI;

    // NPC-кот: серый, чёрные лапки, какает, нельзя его съесть
    // Стартует с РАНДОМНЫМ направлением чтоб не было статичен на старте
    const catA = Math.random() * Math.PI * 2;
    cat = {
      x: W * 0.5, y: H * 0.5,
      dx: Math.cos(catA) * CAT_SPEED,
      dy: Math.sin(catA) * CAT_SPEED,
      angle: catA,
      lastStampX: W * 0.5, lastStampY: H * 0.5, footIndex: 0,
      color: '#3A3A3A',     // используется только для следов лапок (чёрные)
      pawColor: '#000000',
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

  const KEYMAP = {
    'ArrowLeft': 'left', 'ArrowRight': 'right', 'ArrowUp': 'up', 'ArrowDown': 'down',
    'a': 'left', 'd': 'right', 'w': 'up', 's': 'down',
    'A': 'left', 'D': 'right', 'W': 'up', 'S': 'down',
    'ф': 'left', 'в': 'right', 'ц': 'up', 'ы': 'down',
    'Ф': 'left', 'В': 'right', 'Ц': 'up', 'Ы': 'down',
  };

  function onKey(e) {
    if (e.key === 'Escape') { stop(); e.preventDefault(); return; }
    const dir = KEYMAP[e.key];
    if (dir) { keys[dir] = true; e.preventDefault(); e.stopPropagation(); }
  }
  function onKeyUp(e) {
    const dir = KEYMAP[e.key];
    if (dir && keys[dir]) { keys[dir] = false; e.preventDefault(); e.stopPropagation(); }
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

      fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
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
      player.dx = (dx / len) * SPEED;
      player.dy = (dy / len) * SPEED;
      player.angle = Math.atan2(player.dy, player.dx);
    } else { player.dx = 0; player.dy = 0; }
    player.x = clamp(player.x + player.dx, player.radius, bgCanvas.width - player.radius);
    player.y = clamp(player.y + player.dy, player.radius, bgCanvas.height - player.radius);
    player.mouth = (player.mouth + 0.2) % (Math.PI * 2);
  }

  function updateBot() {
    bot.x = clamp(bot.x + bot.dx, bot.radius, bgCanvas.width - bot.radius);
    bot.y = clamp(bot.y + bot.dy, bot.radius, bgCanvas.height - bot.radius);
  }

  function botBrainTick() {
    if (!running) return;
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
        const R = data[i], G = data[i+1], B = data[i+2];
        if (R > 248 && G > 248 && B > 248) continue;
        const d = 1 - (R + G + B) / (3 * 255);
        const points = d < 0.3 ? d * 1 : d * 3;
        gained += points;
        pixelsEaten++;
        data[i] = 255; data[i+1] = 255; data[i+2] = 255;
      }
    }
    if (pixelsEaten > 0 && Number.isFinite(gained)) {
      bgCtx.putImageData(img, sx, sy);
      areaEaten += pixelsEaten;
      if (isPlayer) scorePlayer += gained;
      else scoreBot += gained;
      entity.sizePoints += gained;
      const newR = entity.baseR + Math.sqrt(Math.max(0, entity.sizePoints) / SCORE_DIVISOR) * GROWTH_FACTOR;
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
      cat.nextDirChange = now + 500 + Math.random() * 1500;
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
    c.rotate(angle);
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

  function checkPoopCollision(entity) {
    for (const p of poops) {
      const dx = entity.x - p.x, dy = entity.y - p.y;
      const collisionR = entity.radius * 0.5 + p.r * 0.5;
      if (dx*dx + dy*dy < collisionR * collisionR) {
        die(entity);
        return;
      }
    }
  }

  function die(entity) {
    entity.alive = false;
    entity.respawnAt = performance.now() + RESPAWN_MS;
    entity.sizePoints = 0;
    entity.radius = entity.baseR;
    entity.dx = 0;
    entity.dy = 0;
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
    const winner = p > b ? '🟡 Ты победил!' : (p === b ? '🤝 Ничья' : '🤖 Бот победил');
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
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    if (root) root.remove();
    window.__pacmanEaterRunning = false;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START_PACMAN') start(msg.screenshot);
  });
})();
