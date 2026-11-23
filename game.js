/**
 * ============================================================================
 * DERBİ PENALTI SİMÜLASYONU (FB vs GS) - OYUN MOTORU & FİZİK SİSTEMİ
 * ============================================================================
 * Saf JavaScript ve HTML5 Canvas 2D motoru.
 * Harici kütüphane veya görsel asset bağımlılığı yoktur.
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. VERİ YAPILARI, SABİTLER VE OYUN DURUMU
     ========================================================================== */
  const TEAMS = {
    FB: {
      id: 'FB',
      name: 'Fenerbahçe',
      shortName: 'FB',
      colors: { primary: '#002D72', secondary: '#FFED00', dark: '#001940' },
      shooter: { name: 'İrfan Can Kahveci', number: '17', foot: 'left', blonde: true },
      rivalGk: { name: 'Uğurcan Çakır (GS)', team: 'GS', jerseyColor: '#10b981', shortsColor: '#047857' }
    },
    GS: {
      id: 'GS',
      name: 'Galatasaray',
      shortName: 'GS',
      colors: { primary: '#A90432', secondary: '#FDB912', dark: '#6e001e' },
      shooter: { name: 'Victor Osimhen', number: '45', foot: 'right', masked: true },
      rivalGk: { name: 'Ederson (FB)', team: 'FB', jerseyColor: '#0ea5e9', shortsColor: '#0369a1' }
    }
  };

  const GAME_STATE = {
    AIMING: 'AIMING',
    RUNUP: 'RUNUP',
    FLIGHT: 'FLIGHT',
    RESULT: 'RESULT',
    SERIES_OVER: 'SERIES_OVER'
  };

  const SHOT_RESULT = {
    GOAL: 'GOAL',
    SAVED: 'SAVED',
    POST: 'POST',
    OUT: 'OUT'
  };

  // Oyun Durum Nesnesi
  const state = {
    team: 'FB',                 // 'FB' veya 'GS'
    difficulty: 'HARD',         // 'EASY' veya 'HARD'
    currentRound: 0,            // 0..4 (5 penaltı)
    maxRounds: 5,
    userGoals: 0,
    roundsHistory: [],          // [{ result: 'GOAL', points: 185, speed: 110, corner: true }]
    shotHistory: [],            // GK hafızası için: ['TL', 'BR', 'C', ...]
    totalPoints: 0,
    currentState: GAME_STATE.AIMING,

    // Şut Parametreleri
    target: { x: 0, y: 0.5 },    // Hedef kale düzlemi: x: -1 (sol) .. 1 (sağ), y: 0 (yer) .. 1 (üst)
    impact: { x: 0, y: 0 },      // Vuruş noktası: x: -1 (sol) .. 1 (sağ), y: -1 (üst) .. 1 (alt)
    speedKmh: 95,               // 40 .. 135 km/s

    // Meydan Okuma Parametreleri (URL)
    challenge: null,            // { rival: 'Ad', targetScore: 850, team: 'FB' }

    // Ses Tercihi
    soundEnabled: true
  };

  /* ==========================================================================
     2. SES SİSTEMİ (WEB AUDIO API - %100 SAF VE BAĞIMSIZ)
     ========================================================================== */
  class SoundFX {
    constructor() {
      this.ctx = null;
      this.initCtx();
    }

    initCtx() {
      if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
      }
    }

    ensureRunning() {
      if (!this.ctx) this.initCtx();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    playKick() {
      if (!state.soundEnabled) return;
      try {
        this.ensureRunning();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(32, now + 0.16);

        gain.gain.setValueAtTime(1.0, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
      } catch (e) { /* sessiz devam */ }
    }

    playWhistle() {
      if (!state.soundEnabled) return;
      try {
        this.ensureRunning();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc1.type = 'triangle';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(2600, now);
        osc2.frequency.setValueAtTime(2850, now);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.28);
        osc2.stop(now + 0.28);
      } catch (e) { /* sessiz devam */ }
    }

    playPostClang() {
      if (!state.soundEnabled) return;
      try {
        this.ensureRunning();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(980, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.35);

        gain.gain.setValueAtTime(0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.4);
      } catch (e) { /* sessiz devam */ }
    }

    playNetRustle() {
      if (!state.soundEnabled) return;
      try {
        this.ensureRunning();
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate * 0.25;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1200;
        filter.Q.value = 1.5;

        const gain = this.ctx.createGain();
        gain.gain.value = 0.5;

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        noise.start();
      } catch (e) { /* sessiz devam */ }
    }

    playGoalCheer() {
      if (!state.soundEnabled) return;
      try {
        this.ensureRunning();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        // Stadyum tezahürat simülasyonu
        const bufferSize = this.ctx.sampleRate * 1.5;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400, now);
        filter.frequency.linearRampToValueAtTime(1400, now + 0.6);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0.7, now + 0.3);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 1.5);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start();
      } catch (e) { /* sessiz devam */ }
    }

    playGroan() {
      if (!state.soundEnabled) return;
      try {
        this.ensureRunning();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(85, now + 0.6);

        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.6);
      } catch (e) { /* sessiz devam */ }
    }
  }

  const sfx = new SoundFX();

  /* ==========================================================================
     3. CANVAS 2D GRAFİK & FİZİK MOTORU
     ========================================================================== */
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  // Sanal Çözünürlük ve Geometri
  const WIDTH = 960;
  const HEIGHT = 540;

  // Kale ve Saha Geometrisi
  const GOAL = {
    leftX: 250,
    rightX: 710,
    crossbarY: 140,
    groundY: 345,
    width: 460,
    height: 205,
    postRadius: 6,
    depth: 60
  };

  const PENALTY_SPOT = {
    x: 480,
    y: 470
  };

  // Dinamik Ağ (Cloth/Net Simulation)
  const netGrid = {
    cols: 24,
    rows: 12,
    points: [],
    init() {
      this.points = [];
      for (let r = 0; r <= this.rows; r++) {
        const row = [];
        for (let c = 0; c <= this.cols; c++) {
          const u = c / this.cols;
          const v = r / this.rows;
          // Arka ağ derinliği
          const x = GOAL.leftX + u * GOAL.width;
          const y = GOAL.crossbarY + v * GOAL.height;
          row.push({
            origX: x, origY: y,
            x: x, y: y,
            vx: 0, vy: 0
          });
        }
        this.points.push(row);
      }
    },
    hit(impactX, impactY, power) {
      for (let r = 0; r <= this.rows; r++) {
        for (let c = 0; c <= this.cols; c++) {
          const pt = this.points[r][c];
          const dx = pt.origX - impactX;
          const dy = pt.origY - impactY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            const force = (1 - dist / 120) * (power * 0.12);
            pt.vx += (dx / (dist + 0.1)) * force * 0.4;
            pt.vy += (dy / (dist + 0.1)) * force * 0.4;
          }
        }
      }
    },
    update() {
      for (let r = 0; r <= this.rows; r++) {
        for (let c = 0; c <= this.cols; c++) {
          const pt = this.points[r][c];
          // Sabit çerçeve dışındakileri yay gibi geri çek
          if (r > 0 && r < this.rows && c > 0 && c < this.cols) {
            const k = 0.08;
            const damp = 0.88;
            pt.vx += (pt.origX - pt.x) * k;
            pt.vy += (pt.origY - pt.y) * k;
            pt.vx *= damp;
            pt.vy *= damp;
            pt.x += pt.vx;
            pt.y += pt.vy;
          }
        }
      }
    },
    draw(c) {
      c.save();
      c.strokeStyle = 'rgba(230, 235, 245, 0.45)';
      c.lineWidth = 1;

      // Yatay çizgiler
      for (let r = 0; r <= this.rows; r++) {
        c.beginPath();
        for (let col = 0; col <= this.cols; col++) {
          const pt = this.points[r][col];
          if (col === 0) c.moveTo(pt.x, pt.y);
          else c.lineTo(pt.x, pt.y);
        }
        c.stroke();
      }

      // Dikey çizgiler
      for (let col = 0; col <= this.cols; col++) {
        c.beginPath();
        for (let r = 0; r <= this.rows; r++) {
          const pt = this.points[r][col];
          if (r === 0) c.moveTo(pt.x, pt.y);
          else c.lineTo(pt.x, pt.y);
        }
        c.stroke();
      }
      c.restore();
    }
  };

  // Konfeti ve Kıvılcım Parçacıkları
  const particles = [];
  function spawnParticles(x, y, count, isConfetti) {
    const curTeam = TEAMS[state.team];
    const colors = isConfetti
      ? [curTeam.colors.primary, curTeam.colors.secondary, '#ffffff', '#10b981']
      : ['#ffd700', '#ff8800', '#ffffff', '#eab308'];

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = isConfetti ? Math.random() * 8 + 3 : Math.random() * 6 + 2;
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (isConfetti ? 4 : 1),
        size: isConfetti ? Math.random() * 7 + 4 : Math.random() * 3 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1.0,
        decay: isConfetti ? Math.random() * 0.015 + 0.008 : Math.random() * 0.03 + 0.02,
        isConfetti: isConfetti,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.2
      });
    }
  }

  function updateAndDrawParticles(c) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.isConfetti ? 0.18 : 0.1;
      p.life -= p.decay;
      p.rotation += p.vRot;

      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      c.save();
      c.globalAlpha = Math.max(0, p.life);
      c.translate(p.x, p.y);
      c.rotate(p.rotation);
      c.fillStyle = p.color;
      if (p.isConfetti) {
        c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else {
        c.beginPath();
        c.arc(0, 0, p.size, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }
  }

  /* ==========================================================================
     4. KALECİ VE ŞUTÖR MODELİ & ANİMASYONLARI
     ========================================================================== */
  const goalkeeper = {
    x: (GOAL.leftX + GOAL.rightX) / 2,
    y: GOAL.groundY - 10,
    baseX: (GOAL.leftX + GOAL.rightX) / 2,
    baseY: GOAL.groundY - 10,
    vx: 0,
    vy: 0,
    width: 36,
    height: 80,
    feintTimer: 0,
    feintOffset: 0,
    armsAngle: 0,
    diving: false,
    diveTargetX: 0,
    diveTargetY: 0,
    diveProgress: 0,
    diveDuration: 0.6,
    saveSuccess: false,
    facing: 1,

    reset() {
      this.x = this.baseX;
      this.y = this.baseY;
      this.vx = 0;
      this.vy = 0;
      this.diving = false;
      this.diveProgress = 0;
      this.saveSuccess = false;
      this.feintTimer = 0;
      this.feintOffset = 0;
    },

    update(dt) {
      if (state.currentState === GAME_STATE.AIMING || state.currentState === GAME_STATE.RUNUP) {
        // Çizgi üzerinde ayak kaydırma ve kollarla fake hareketleri
        this.feintTimer += dt * 3.5;
        this.feintOffset = Math.sin(this.feintTimer) * 28 + Math.sin(this.feintTimer * 2.3) * 12;
        this.armsAngle = Math.sin(this.feintTimer * 2) * 0.35;
        this.x = this.baseX + this.feintOffset;
        this.y = this.baseY;
      } else if (this.diving) {
        this.diveProgress = Math.min(1.0, this.diveProgress + dt / this.diveDuration);
        const ease = 1 - Math.pow(1 - this.diveProgress, 3);
        this.x = this.baseX + (this.diveTargetX - this.baseX) * ease;
        this.y = this.baseY + (this.diveTargetY - this.baseY) * ease;
      }
    },

    triggerDive(targetX, targetY, duration, willSave) {
      this.diving = true;
      this.diveProgress = 0;
      this.diveDuration = duration;
      this.diveTargetX = targetX;
      this.diveTargetY = targetY;
      this.saveSuccess = willSave;
      this.facing = targetX < this.x ? -1 : 1;
    },

    draw(c) {
      c.save();
      c.translate(this.x, this.y);

      const rivalTeam = state.team === 'FB' ? 'GS' : 'FB';
      const kit = TEAMS[state.team].rivalGk;

      // Kaleci gölgesi
      c.save();
      c.scale(1, 0.25);
      c.fillStyle = 'rgba(0, 0, 0, 0.35)';
      c.beginPath();
      c.arc(0, 0, this.diving ? 30 : 22, 0, Math.PI * 2);
      c.fill();
      c.restore();

      if (!this.diving) {
        // AYAKTA / FAKE DURUŞU
        // Bacaklar
        c.fillStyle = kit.shortsColor;
        c.fillRect(-12, -42, 10, 22);
        c.fillRect(2, -42, 10, 22);

        // Çoraplar & Kramponlar
        c.fillStyle = '#ffffff';
        c.fillRect(-11, -20, 8, 16);
        c.fillRect(3, -20, 8, 16);
        c.fillStyle = '#111827';
        c.fillRect(-13, -4, 11, 6);
        c.fillRect(2, -4, 11, 6);

        // Gövde / Forma
        c.fillStyle = kit.jerseyColor;
        c.beginPath();
        c.roundRect(-16, -72, 32, 32, 6);
        c.fill();

        // Kollar (Fake hareketiyle sallanır)
        c.save();
        c.translate(-16, -66);
        c.rotate(-0.5 + this.armsAngle);
        c.fillStyle = kit.jerseyColor;
        c.fillRect(-6, 0, 8, 22);
        // Eldiven
        c.fillStyle = '#ffffff';
        c.fillRect(-8, 20, 12, 10);
        c.restore();

        c.save();
        c.translate(16, -66);
        c.rotate(0.5 - this.armsAngle);
        c.fillStyle = kit.jerseyColor;
        c.fillRect(-2, 0, 8, 22);
        // Eldiven
        c.fillStyle = '#ffffff';
        c.fillRect(-4, 20, 12, 10);
        c.restore();

        // Kafa ve Saç
        c.fillStyle = '#e2a77a';
        c.beginPath();
        c.arc(0, -82, 11, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#261b11'; // Saç
        c.beginPath();
        c.arc(0, -86, 11, Math.PI, Math.PI * 2);
        c.fill();
      } else {
        // ATLAMA (DIVE) ANİMASYONU
        const angle = Math.atan2(this.diveTargetY - this.baseY, this.diveTargetX - this.baseX);
        c.rotate(angle * 0.65);

        // Uçan Kaleci Gövdesi
        c.fillStyle = kit.shortsColor;
        c.fillRect(-16, -10, 20, 14);

        // Bacaklar geriye uzanmış
        c.fillStyle = kit.shortsColor;
        c.fillRect(-38, -8, 22, 10);
        c.fillStyle = '#ffffff';
        c.fillRect(-52, -7, 14, 8);
        c.fillStyle = '#111827';
        c.fillRect(-58, -8, 8, 10);

        // Gövde
        c.fillStyle = kit.jerseyColor;
        c.beginPath();
        c.roundRect(-6, -14, 30, 22, 5);
        c.fill();

        // Kafa
        c.fillStyle = '#e2a77a';
        c.beginPath();
        c.arc(28, -3, 10, 0, Math.PI * 2);
        c.fill();

        // İleri uzanmış kollar ve eldivenler
        c.fillStyle = kit.jerseyColor;
        c.fillRect(20, -14, 26, 8);
        c.fillRect(20, 2, 26, 8);
        // Eldivenler
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.roundRect(46, -16, 12, 11, 3);
        c.roundRect(46, 1, 12, 11, 3);
        c.fill();
      }

      c.restore();
    }
  };

  const shooter = {
    x: PENALTY_SPOT.x - 38,
    y: PENALTY_SPOT.y + 12,
    baseX: PENALTY_SPOT.x - 38,
    baseY: PENALTY_SPOT.y + 12,
    runProgress: 0,
    kicking: false,

    reset() {
      this.runProgress = 0;
      this.kicking = false;
      this.x = this.baseX;
      this.y = this.baseY;
    },

    update(dt) {
      if (state.currentState === GAME_STATE.RUNUP) {
        this.runProgress += dt * 2.2;
        // Penaltı noktasına doğru koşu
        this.x = this.baseX + (PENALTY_SPOT.x - 12 - this.baseX) * Math.min(1.0, this.runProgress);
        this.y = this.baseY + (PENALTY_SPOT.y - this.baseY) * Math.min(1.0, this.runProgress);
      }
    },

    draw(c) {
      // Şutör şut çekildikten sonra biraz geri çekilir veya sahada görünür
      c.save();
      c.translate(this.x, this.y);

      const curTeam = TEAMS[state.team];
      const isOsimhen = state.team === 'GS';

      // Şutör gölgesi
      c.save();
      c.scale(1, 0.3);
      c.fillStyle = 'rgba(0, 0, 0, 0.4)';
      c.beginPath();
      c.arc(0, 0, 24, 0, Math.PI * 2);
      c.fill();
      c.restore();

      // Bacaklar
      const runCycle = Math.sin(this.runProgress * 15);
      c.fillStyle = curTeam.colors.dark;
      c.fillRect(-12 + runCycle * 6, -42, 9, 26);
      c.fillRect(3 - runCycle * 6, -42, 9, 26);

      // Çoraplar & Krampon
      c.fillStyle = curTeam.colors.secondary;
      c.fillRect(-11 + runCycle * 6, -18, 7, 14);
      c.fillRect(4 - runCycle * 6, -18, 7, 14);
      c.fillStyle = '#f97316'; // Kramponlar
      c.fillRect(-13 + runCycle * 6, -4, 11, 6);
      c.fillRect(3 - runCycle * 6, -4, 11, 6);

      // Gövde / Forma (Arkadan görünüm)
      c.fillStyle = curTeam.colors.primary;
      c.beginPath();
      c.roundRect(-16, -78, 32, 36, 6);
      c.fill();

      // Forma Çizgileri / Deseni
      if (state.team === 'FB') {
        // Çubuklu sarı-lacivert
        c.fillStyle = '#FFED00';
        c.fillRect(-8, -78, 5, 36);
        c.fillRect(4, -78, 5, 36);
      } else {
        // GS Parçalı (Sağ kırmızı, sol sarı)
        c.fillStyle = '#FDB912';
        c.fillRect(-16, -78, 16, 36);
      }

      // Sırt Numarası ve İsim
      c.fillStyle = '#ffffff';
      c.font = 'bold 12px monospace';
      c.textAlign = 'center';
      c.fillText(curTeam.shooter.number, 0, -52);

      // Kollar
      c.fillStyle = curTeam.colors.primary;
      c.fillRect(-22, -72 + runCycle * 4, 7, 24);
      c.fillRect(15, -72 - runCycle * 4, 7, 24);

      // Kafa
      c.fillStyle = isOsimhen ? '#4a2c1b' : '#df9e6d';
      c.beginPath();
      c.arc(0, -90, 11, 0, Math.PI * 2);
      c.fill();

      // Saç / Maske Detayı
      if (isOsimhen) {
        // Osimhen ikonik sarı saç tutamı ve siyah maskesi
        c.fillStyle = '#eab308';
        c.fillRect(-5, -100, 10, 4);
        c.fillStyle = '#111827'; // İkonik siyah maske kayışları
        c.fillRect(-12, -91, 24, 3);
      } else {
        // İrfan Can Kahveci saç stili
        c.fillStyle = '#5c4033';
        c.beginPath();
        c.arc(0, -94, 11, Math.PI, Math.PI * 2);
        c.fill();
      }

      c.restore();
    }
  };

  /* ==========================================================================
     5. 3D TOP FİZİĞİ VE MAGNUS ETKİSİ
     ========================================================================== */
  const ball = {
    x: PENALTY_SPOT.x,
    y: PENALTY_SPOT.y - 12,
    z: 0,                       // 0 (penaltı noktası) -> 1.0 (kale çizgisi) -> 1.25 (ağlar)
    vx: 0,
    vy: 0,
    vz: 0,
    spinX: 0,                   // Falso ekseni
    spinY: 0,
    radius: 18,
    rotation: 0,
    trail: [],
    finalResult: null,

    reset() {
      this.x = PENALTY_SPOT.x;
      this.y = PENALTY_SPOT.y - 12;
      this.z = 0;
      this.vx = 0;
      this.vy = 0;
      this.vz = 0;
      this.spinX = 0;
      this.spinY = 0;
      this.radius = 18;
      this.rotation = 0;
      this.trail = [];
      this.finalResult = null;
    },

    update(dt) {
      if (state.currentState !== GAME_STATE.FLIGHT) return;

      // Z derinlik ilerlemesi
      this.z += this.vz * dt;

      // Magnus etkisi: Spin yatay ivme üretir
      const magnusForceX = this.spinX * 380;
      this.vx += magnusForceX * dt;

      // Knuckleball (Füze) yalpalama etkisi: Eğer spin yok ve çok sert vurulduysa
      if (Math.abs(state.impact.x) < 0.12 && Math.abs(state.impact.y) < 0.15 && state.speedKmh > 105) {
        this.vx += Math.sin(this.z * 18) * 120 * dt;
      }

      // Yerçekimi ve dikey hareket
      this.vy += 180 * dt; // Hafif yerçekimi
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // Topun kendi etrafında dönüşü
      this.rotation += (this.spinX * 15 + this.vz * 4) * dt;

      // Derinliğe göre küçülme (3D perspektif: 18px -> 9px)
      this.radius = 18 - this.z * 9;

      // İzi kaydet (trajectory trail)
      this.trail.push({ x: this.x, y: this.y, r: this.radius, alpha: 0.8 });
      if (this.trail.length > 25) this.trail.shift();

      // KALE ÇİZGİSİNE ULAŞMA KONTROLÜ (z >= 1.0)
      if (this.z >= 1.0 && !this.finalResult) {
        this.evaluateGoalPlane();
      }

      // Ağ teması veya frenleme
      if (this.finalResult === SHOT_RESULT.GOAL && this.z >= 1.05) {
        netGrid.hit(this.x, this.y, state.speedKmh);
        this.vx *= 0.85;
        this.vy *= 0.85;
      }
    },

    evaluateGoalPlane() {
      const px = this.x;
      const py = this.y;

      // Direk ve Üst Direk Koordinatları
      const leftPost = GOAL.leftX;
      const rightPost = GOAL.rightX;
      const crossbar = GOAL.crossbarY;
      const ground = GOAL.groundY;

      // 1. DİREK ÇARPIŞMASI KONTROLÜ
      const hitLeftPost = Math.abs(px - leftPost) < 14 && py >= crossbar - 10 && py <= ground;
      const hitRightPost = Math.abs(px - rightPost) < 14 && py >= crossbar - 10 && py <= ground;
      const hitCrossbar = Math.abs(py - crossbar) < 14 && px >= leftPost - 10 && px <= rightPost + 10;

      if (hitLeftPost || hitRightPost || hitCrossbar) {
        this.finalResult = SHOT_RESULT.POST;
        this.vx = (px - PENALTY_SPOT.x) * -0.3;
        this.vy = -60;
        this.vz = 0;
        sfx.playPostClang();
        spawnParticles(px, py, 25, false);
        setTimeout(() => finishShot(), 700);
        return;
      }

      // 2. DIŞARI GİTME (AUT) KONTROLÜ
      const isOut = px < leftPost - 10 || px > rightPost + 10 || py < crossbar - 10;
      if (isOut) {
        this.finalResult = SHOT_RESULT.OUT;
        sfx.playGroan();
        setTimeout(() => finishShot(), 700);
        return;
      }

      // 3. KALECİ KURTARIŞI KONTROLÜ
      if (goalkeeper.saveSuccess) {
        this.finalResult = SHOT_RESULT.SAVED;
        this.vx = (Math.random() - 0.5) * 160;
        this.vy = -80;
        this.vz = 0;
        sfx.playPostClang();
        sfx.playGroan();
        spawnParticles(px, py, 15, false);
        setTimeout(() => finishShot(), 700);
        return;
      }

      // 4. GÖÖÖL!
      this.finalResult = SHOT_RESULT.GOAL;
      sfx.playNetRustle();
      sfx.playGoalCheer();
      spawnParticles(px, py, 60, true);
      netGrid.hit(this.x, this.y, state.speedKmh);
      this.vx *= 0.2;
      this.vy *= 0.2;
      this.vz = 0.05;
      setTimeout(() => finishShot(), 800);
    },

    draw(c) {
      // Kuyruk İzi (Glow Ribbon)
      if (this.trail.length > 1) {
        c.save();
        for (let i = 0; i < this.trail.length - 1; i++) {
          const pt = this.trail[i];
          const next = this.trail[i + 1];
          c.strokeStyle = state.team === 'FB' ? 'rgba(255, 237, 0, 0.45)' : 'rgba(253, 185, 18, 0.45)';
          c.lineWidth = pt.r * 1.2;
          c.beginPath();
          c.moveTo(pt.x, pt.y);
          c.lineTo(next.x, next.y);
          c.stroke();
        }
        c.restore();
      }

      // Topun Yerdeki Gölgesi
      c.save();
      const shadowY = Math.min(GOAL.groundY + 20, PENALTY_SPOT.y - (PENALTY_SPOT.y - GOAL.groundY) * this.z);
      const shadowScale = Math.max(0.2, 1 - (shadowY - this.y) / 220);
      c.translate(this.x, shadowY);
      c.scale(1, 0.25);
      c.fillStyle = `rgba(0, 0, 0, ${0.45 * shadowScale})`;
      c.beginPath();
      c.arc(0, 0, this.radius * 1.5, 0, Math.PI * 2);
      c.fill();
      c.restore();

      // Top Gövdesi ve Dikiş Çizimi
      c.save();
      c.translate(this.x, this.y);
      c.rotate(this.rotation);

      // Top Yuvarlağı
      const grad = c.createRadialGradient(-this.radius * 0.35, -this.radius * 0.35, this.radius * 0.1, 0, 0, this.radius);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.7, '#d1d5db');
      grad.addColorStop(1, '#6b7280');

      c.fillStyle = grad;
      c.beginPath();
      c.arc(0, 0, this.radius, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#1f2937';
      c.lineWidth = 1.2;
      c.stroke();

      // Pentagon Panelleri
      c.fillStyle = '#111827';
      c.beginPath();
      const pR = this.radius * 0.45;
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        const px = Math.cos(a) * pR;
        const py = Math.sin(a) * pR;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      c.fill();

      // Panel çizgileri
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        c.beginPath();
        c.moveTo(Math.cos(a) * pR, Math.sin(a) * pR);
        c.lineTo(Math.cos(a) * this.radius, Math.sin(a) * this.radius);
        c.stroke();
      }

      c.restore();
    }
  };

  /* ==========================================================================
     6. SAHA, KALE VE STADYUM ÇİZİMİ
     ========================================================================== */
  function drawStadium() {
    // 1. Gökyüzü & Stadyum Tribünleri
    const skyGrad = ctx.createLinearGradient(0, 0, 0, GOAL.crossbarY);
    skyGrad.addColorStop(0, '#020610');
    skyGrad.addColorStop(1, '#0c1a2e');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, WIDTH, GOAL.crossbarY);

    // Stadyum Işıkları (Projektörler)
    drawFloodlights(120, 50);
    drawFloodlights(WIDTH - 120, 50);

    // Taraftar Tribünleri (Noktasal / Vektörel)
    ctx.save();
    const fanColors = state.team === 'FB'
      ? ['#002D72', '#FFED00', '#ffffff', '#001a40']
      : ['#A90432', '#FDB912', '#ffffff', '#5c021b'];

    for (let i = 0; i < 180; i++) {
      const fx = (i * 17) % WIDTH;
      const fy = 60 + ((i * 23) % 70);
      ctx.fillStyle = fanColors[i % fanColors.length];
      ctx.beginPath();
      ctx.arc(fx, fy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Reklam Panoları
    const boardY = GOAL.crossbarY - 18;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, boardY, WIDTH, 24);
    ctx.strokeStyle = '#334155';
    ctx.strokeRect(0, boardY, WIDTH, 24);

    ctx.fillStyle = state.team === 'FB' ? '#FFED00' : '#FDB912';
    ctx.font = '900 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DERBİ 2026 ★ SÜPER LİG ★ BÜYÜK HEYECAN ★ ANTIGRAVITY DERBY ★', WIDTH / 2, boardY + 16);

    // 2. Çim Saha & Çizgiler (3D Perspektif)
    const pitchGrad = ctx.createLinearGradient(0, GOAL.crossbarY, 0, HEIGHT);
    pitchGrad.addColorStop(0, '#124523');
    pitchGrad.addColorStop(1, '#1b6334');
    ctx.fillStyle = pitchGrad;
    ctx.fillRect(0, GOAL.crossbarY, WIDTH, HEIGHT - GOAL.crossbarY);

    // Çim Şeritleri (10 adet derinlik şeridi)
    for (let s = 0; s < 10; s++) {
      if (s % 2 === 0) {
        const sy1 = GOAL.crossbarY + (s / 10) * (HEIGHT - GOAL.crossbarY);
        const sy2 = GOAL.crossbarY + ((s + 1) / 10) * (HEIGHT - GOAL.crossbarY);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
        ctx.fillRect(0, sy1, WIDTH, sy2 - sy1);
      }
    }

    // Ceza Sahası Çizgisi ve Kale Çizgisi
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 4;

    // Kale Çizgisi
    ctx.beginPath();
    ctx.moveTo(120, GOAL.groundY);
    ctx.lineTo(WIDTH - 120, GOAL.groundY);
    ctx.stroke();

    // Ceza Sahası Yan Çizgileri (Perspektif)
    ctx.beginPath();
    ctx.moveTo(180, GOAL.groundY);
    ctx.lineTo(80, HEIGHT);
    ctx.moveTo(WIDTH - 180, GOAL.groundY);
    ctx.lineTo(WIDTH - 80, HEIGHT);
    ctx.stroke();

    // Penaltı Noktası
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(PENALTY_SPOT.x, PENALTY_SPOT.y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Penaltı Yayı
    ctx.beginPath();
    ctx.arc(PENALTY_SPOT.x, PENALTY_SPOT.y - 10, 55, 0.8 * Math.PI, 0.2 * Math.PI, true);
    ctx.stroke();

    // 3. Ağlar (Dinamik Cloth)
    netGrid.draw(ctx);

    // 4. 3D Kale Direkleri (Beyaz & Metalik Gölgeli)
    drawGoalPosts();
  }

  function drawFloodlights(x, y) {
    ctx.save();
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(x - 22, y - 8, 44, 16);
    // Parlama konisi
    const glow = ctx.createRadialGradient(x, y, 5, x, y, 70);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    glow.addColorStop(0.3, 'rgba(255, 255, 220, 0.35)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawGoalPosts() {
    ctx.save();
    // Metalik Direk Gölgelemesi
    const postGrad = ctx.createLinearGradient(GOAL.leftX - GOAL.postRadius, 0, GOAL.leftX + GOAL.postRadius, 0);
    postGrad.addColorStop(0, '#cbd5e1');
    postGrad.addColorStop(0.4, '#ffffff');
    postGrad.addColorStop(1, '#94a3b8');

    ctx.fillStyle = postGrad;
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;

    // Sol Direk
    ctx.beginPath();
    ctx.roundRect(GOAL.leftX - GOAL.postRadius, GOAL.crossbarY, GOAL.postRadius * 2, GOAL.height, 4);
    ctx.fill();
    ctx.stroke();

    // Sağ Direk
    ctx.beginPath();
    ctx.roundRect(GOAL.rightX - GOAL.postRadius, GOAL.crossbarY, GOAL.postRadius * 2, GOAL.height, 4);
    ctx.fill();
    ctx.stroke();

    // Üst Direk
    const barGrad = ctx.createLinearGradient(0, GOAL.crossbarY - GOAL.postRadius, 0, GOAL.crossbarY + GOAL.postRadius);
    barGrad.addColorStop(0, '#ffffff');
    barGrad.addColorStop(1, '#94a3b8');
    ctx.fillStyle = barGrad;
    ctx.beginPath();
    ctx.roundRect(GOAL.leftX - GOAL.postRadius, GOAL.crossbarY - GOAL.postRadius, GOAL.width + GOAL.postRadius * 2, GOAL.postRadius * 2, 4);
    ctx.fill();
    ctx.stroke();

    // Arka Destek Direkleri (Derinlik)
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(GOAL.leftX, GOAL.crossbarY);
    ctx.lineTo(GOAL.leftX + 25, GOAL.crossbarY - 20);
    ctx.lineTo(GOAL.leftX + 25, GOAL.groundY - 15);
    ctx.moveTo(GOAL.rightX, GOAL.crossbarY);
    ctx.lineTo(GOAL.rightX - 25, GOAL.crossbarY - 20);
    ctx.lineTo(GOAL.rightX - 25, GOAL.groundY - 15);
    ctx.stroke();

    ctx.restore();
  }

  /* ==========================================================================
     7. NİŞAN ALMA RETİCLE'I (HEDEF İMLECİ) VE TIKLAMA HESABI
     ========================================================================== */
  function getGoalScreenPos(target) {
    // target.x: -1 .. 1, target.y: 0 .. 1
    const screenX = GOAL.leftX + GOAL.width * 0.5 + (target.x * GOAL.width * 0.45);
    const screenY = GOAL.groundY - (target.y * GOAL.height * 0.92);
    return { x: screenX, y: screenY };
  }

  function drawReticle() {
    if (state.currentState !== GAME_STATE.AIMING) return;

    const pos = getGoalScreenPos(state.target);

    ctx.save();
    ctx.translate(pos.x, pos.y);

    const teamCol = TEAMS[state.team].colors.secondary;
    ctx.strokeStyle = teamCol;
    ctx.lineWidth = 2.5;

    // Dönen hedef dairesi
    const time = performance.now() * 0.003;
    ctx.beginPath();
    ctx.arc(0, 0, 16, time, time + Math.PI * 1.5);
    ctx.stroke();

    // Artı çizgileri (Crosshair)
    ctx.beginPath();
    ctx.moveTo(-22, 0); ctx.lineTo(-8, 0);
    ctx.moveTo(8, 0); ctx.lineTo(22, 0);
    ctx.moveTo(0, -22); ctx.lineTo(0, -8);
    ctx.moveTo(0, 8); ctx.lineTo(0, 22);
    ctx.stroke();

    // Merkez Noktası
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Hedef etiketi
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    let cornerTag = 'HEDEF';
    if (Math.abs(state.target.x) > 0.65 && state.target.y > 0.7) cornerTag = "90'A!";
    ctx.fillText(cornerTag, 0, -26);

    ctx.restore();
  }

  /* ==========================================================================
     8. KALECİ YAPAY ZEKASI VE %90 KURTARIŞ SINIRI (HARD-CAP)
     ========================================================================== */
  function calculateGoalkeeperSave(actualTarget) {
    const isHard = state.difficulty === 'HARD';
    // 1. Taban Olasılık (Kolay: %35, Zor: %60)
    let saveProb = isHard ? 0.60 : 0.35;

    // 2. Köşeye Yakınlık Bonusu/Cezası
    // Köşeler (özellikle 90'lar) kalecinin ulaşmasını çok zorlaştırır
    const distFromCenter = Math.sqrt(
      Math.pow(actualTarget.x, 2) + Math.pow(actualTarget.y - 0.5, 2)
    );
    // distFromCenter: 0 (tam orta) .. ~1.1 (90 köşeleri)
    const cornerPenalty = distFromCenter * 0.28;
    saveProb -= cornerPenalty;

    // 3. Şut Hızı Faktörü (40 .. 135 km/s)
    // 110+ km/s füzeler kalecinin reaksiyon süresini daraltır
    const speedRatio = (state.speedKmh - 40) / (135 - 40); // 0 .. 1
    const speedPenalty = (speedRatio - 0.5) * 0.22;
    saveProb -= speedPenalty;

    // 4. Falso (Magnus) ve Aldatma Faktörü
    const spinAmount = Math.abs(state.impact.x);
    saveProb -= spinAmount * 0.12;

    // 5. Zor Mod Hafıza / Öngörü Algoritması
    if (isHard && state.shotHistory.length >= 2) {
      const lastShot = state.shotHistory[state.shotHistory.length - 1];
      const prevShot = state.shotHistory[state.shotHistory.length - 2];
      const currentSide = actualTarget.x < -0.2 ? 'L' : (actualTarget.x > 0.2 ? 'R' : 'C');

      // Eğer oyuncu ısrarla aynı köşeye vuruyorsa kaleci tahmin eder
      if (currentSide === lastShot && lastShot === prevShot) {
        saveProb += 0.16; // Kaleci köşeyi ezberledi
      } else {
        // Değiştiriyorsa kalecinin ters köşede kalma payı
        saveProb -= 0.08;
      }
    }

    // 6. Ters Köşe / Yanılma Şansı (Her zaman mevcuttur)
    const blunderRoll = Math.random();
    if (blunderRoll < 0.15) {
      // Kaleci tamamen ters köşeye atlar!
      saveProb = 0.05;
    }

    // 7. KRİTİK KURAL: %90 HARD-CAP SINIRI
    // Math.min(saveProb, 0.90) formülüyle kalecinin kurtarış şansı asla %90'ı geçemez!
    saveProb = Math.max(0.05, Math.min(saveProb, 0.90));

    console.log(`[AI GK] Mod: ${state.difficulty} | Hız: ${state.speedKmh} km/s | Hesaplanan Kurtarış: %${(saveProb * 100).toFixed(1)} (Hard-Cap %90 devrede)`);

    // Zar atışı
    const dice = Math.random();
    const willSave = dice < saveProb;

    return {
      willSave: willSave,
      saveProb: saveProb
    };
  }

  /* ==========================================================================
     9. ŞUT İCRA MEKANİZMASI & FİZİK BAŞLATMA
     ========================================================================== */
  function executeShot() {
    if (state.currentState !== GAME_STATE.AIMING) return;

    state.currentState = GAME_STATE.RUNUP;
    shooter.reset();
    document.getElementById('shootBtn').disabled = true;
    document.getElementById('aimHintOverlay').classList.add('fade-out');

    sfx.playWhistle();

    // 1. Sapma (Hata Payı) Hesabı: Hız arttıkça hata payı hafif artar
    const speedRatio = (state.speedKmh - 40) / 95;
    const maxSpread = 0.03 + speedRatio * 0.08;
    const errX = (Math.random() * 2 - 1) * maxSpread;
    const errY = (Math.random() * 2 - 1) * maxSpread;

    const actualTarget = {
      x: Math.max(-1.15, Math.min(1.15, state.target.x + errX)),
      y: Math.max(-0.1, Math.min(1.15, state.target.y + errY))
    };

    // Hafızaya kaydet
    const side = actualTarget.x < -0.2 ? 'L' : (actualTarget.x > 0.2 ? 'R' : 'C');
    state.shotHistory.push(side);

    // 2. Kaleci Yapay Zekası Kararı
    const aiDecision = calculateGoalkeeperSave(actualTarget);

    // Koşu süresinden sonra topa vurulur (0.45 sn)
    setTimeout(() => {
      state.currentState = GAME_STATE.FLIGHT;
      sfx.playKick();

      // Topun uçuş parametreleri
      const screenTarget = getGoalScreenPos(actualTarget);
      const flightDuration = Math.max(0.42, 1.25 - (state.speedKmh / 135) * 0.75);

      ball.reset();
      ball.vz = 1.0 / flightDuration;

      // Başlangıç hızları
      ball.vx = (screenTarget.x - PENALTY_SPOT.x) / flightDuration;
      ball.vy = (screenTarget.y - (PENALTY_SPOT.y - 12)) / flightDuration;

      // Falso parametresi (Magnus etkisi)
      // impact.x < 0 -> sola vurulur, top sağa kavis alır; impact.x > 0 -> sağa vurulur, sola kavis
      ball.spinX = -state.impact.x;
      ball.spinY = state.impact.y;

      // Kaleci atlayışını başlat
      let gkTargetX = screenTarget.x;
      let gkTargetY = screenTarget.y;

      if (!aiDecision.willSave) {
        // Kaleci yetişemez veya ters köşeye uçar
        if (Math.random() < 0.3) {
          // Ters köşe
          gkTargetX = GOAL.leftX + GOAL.width - (screenTarget.x - GOAL.leftX);
        } else {
          // Kısa kalır (elinin ucuyla kaçırır)
          gkTargetX = (goalkeeper.baseX + screenTarget.x) * 0.65;
          gkTargetY = Math.max(GOAL.crossbarY + 30, screenTarget.y + 25);
        }
      }

      goalkeeper.triggerDive(gkTargetX, gkTargetY, flightDuration * 0.95, aiDecision.willSave);
    }, 450);
  }

  /* ==========================================================================
     10. SONUÇ DEĞERLENDİRME, PUANLAMA VE SERİ DÖNGÜSÜ
     ========================================================================== */
  function finishShot() {
    state.currentState = GAME_STATE.RESULT;
    const result = ball.finalResult || SHOT_RESULT.OUT;

    let shotPoints = 0;
    let isCorner90 = false;
    let announcementTitle = '';
    let announcementSub = '';
    let cardClass = '';

    // Puanlama Kuralları
    if (result === SHOT_RESULT.GOAL) {
      state.userGoals++;
      // Taban Puan: 100
      let base = 100;

      // Hız Bonusu (0 .. 50)
      const speedBonus = Math.round(((state.speedKmh - 40) / 95) * 50);

      // 90'lar & Köşe Bonusu (0 .. 75)
      const distFromCenter = Math.sqrt(Math.pow(state.target.x, 2) + Math.pow(state.target.y - 0.5, 2));
      let cornerBonus = 0;
      if (distFromCenter > 0.8) {
        cornerBonus = 75;
        isCorner90 = true;
      } else if (distFromCenter > 0.5) {
        cornerBonus = 35;
      }

      let subTotal = base + speedBonus + cornerBonus;

      // Zor Mod Çarpanı (1.5x)
      if (state.difficulty === 'HARD') {
        shotPoints = Math.round(subTotal * 1.5);
      } else {
        shotPoints = subTotal;
      }

      state.totalPoints += shotPoints;

      announcementTitle = isCorner90 ? "90'A GÖÖÖL!" : "GÖÖÖL!";
      announcementSub = `${TEAMS[state.team].shooter.name} fileleri havalandırdı!`;
      cardClass = 'ann-goal';
    } else if (result === SHOT_RESULT.SAVED) {
      announcementTitle = 'MÜTHİŞ KURTARIŞ!';
      announcementSub = `${TEAMS[state.team].rivalGk.name} gole izin vermedi!`;
      cardClass = 'ann-save';
      shotPoints = 0;
    } else if (result === SHOT_RESULT.POST) {
      announcementTitle = 'DİREKTEN DÖNDÜ!';
      announcementSub = 'Top direğe çarpıp sahaya geri döndü!';
      cardClass = 'ann-post';
      shotPoints = 0;
    } else {
      announcementTitle = 'AUT!';
      announcementSub = 'Top kaleyi bulmadı, tribünlere gitti!';
      cardClass = 'ann-out';
      shotPoints = 0;
    }

    // Raunt Geçmişini Kaydet
    state.roundsHistory.push({
      round: state.currentRound + 1,
      result: result,
      points: shotPoints,
      speed: state.speedKmh,
      isCorner90: isCorner90
    });

    console.log(`[SHOT RESULT] Round ${state.currentRound + 1}: ${result} | Puan: +${shotPoints} | Toplam: ${state.totalPoints}`);

    // Scoreboard UI Güncelle
    updateScoreboardUI(result);

    // Ekran Üstü Yayıncı Kartını Göster
    showAnnouncementCard(announcementTitle, announcementSub, cardClass, state.speedKmh, shotPoints);

    // 1.8 Saniye sonra bir sonraki tura veya maç sonuna geç
    setTimeout(() => {
      hideAnnouncementCard();
      state.currentRound++;

      if (state.currentRound < state.maxRounds) {
        // Yeni atış hazırlığı
        prepareNextShot();
      } else {
        // 5 Penaltılık Seri Tamamlandı
        endMatchSeries();
      }
    }, 1800);
  }

  function prepareNextShot() {
    state.currentState = GAME_STATE.AIMING;
    ball.reset();
    goalkeeper.reset();
    shooter.reset();
    document.getElementById('shootBtn').disabled = false;
    document.getElementById('aimHintOverlay').classList.remove('fade-out');

    // UI Güncelle
    document.getElementById('roundBadge').textContent = `Atış ${state.currentRound + 1} / ${state.maxRounds}`;

    // Mevcut penaltı göstergesini aktifleştir
    const dots = document.querySelectorAll('.p-dot');
    dots.forEach((dot, idx) => {
      dot.classList.remove('current');
      if (idx === state.currentRound) dot.classList.add('current');
    });
  }

  function endMatchSeries() {
    state.currentState = GAME_STATE.SERIES_OVER;
    document.getElementById('shootBtn').disabled = true;

    // İstatistikleri hesapla
    const totalGoals = state.userGoals;
    let baseGoalsPts = totalGoals * 100;
    let totalSpeedBonus = 0;
    let totalCornerBonus = 0;
    let totalMultiplier = 0;

    let totalSpeedSum = 0;
    state.roundsHistory.forEach(r => {
      totalSpeedSum += r.speed;
      if (r.result === SHOT_RESULT.GOAL) {
        const sb = Math.round(((r.speed - 40) / 95) * 50);
        totalSpeedBonus += sb;
        if (r.isCorner90) totalCornerBonus += 75;
      }
    });

    const avgSpeed = Math.round(totalSpeedSum / state.maxRounds);
    if (state.difficulty === 'HARD') {
      totalMultiplier = Math.round((baseGoalsPts + totalSpeedBonus + totalCornerBonus) * 0.5);
    }

    // Modal Alanlarını Doldur
    document.getElementById('finalGoalsCount').textContent = `${totalGoals} / ${state.maxRounds}`;
    document.getElementById('finalTotalPoints').textContent = state.totalPoints;
    document.getElementById('finalAvgSpeed').textContent = `${avgSpeed} km/s`;

    document.getElementById('ptsBaseGoals').textContent = baseGoalsPts;
    document.getElementById('ptsSpeedBonus').textContent = `+${totalSpeedBonus}`;
    document.getElementById('ptsCornerBonus').textContent = `+${totalCornerBonus}`;
    document.getElementById('ptsMultiplier').textContent = state.difficulty === 'HARD' ? `+${totalMultiplier}` : '0 (Kolay Mod)';

    // Başlık ve Kupa
    const titleEl = document.getElementById('gameOverTitle');
    const subEl = document.getElementById('gameOverSub');
    if (totalGoals >= 4) {
      titleEl.textContent = `ŞAMPİYON ${TEAMS[state.team].name.toUpperCase()}! 🏆`;
      subEl.textContent = 'Harika bir penaltı serisi çıkardın, derbiyi kazandın!';
      sfx.playGoalCheer();
    } else if (totalGoals >= 2) {
      titleEl.textContent = 'SERİ TAMAMLANDI!';
      subEl.textContent = 'Çekişmeli bir derbi oldu. Skorunu kaydet veya yeniden dene!';
    } else {
      titleEl.textContent = 'DERBİDE YENİLGİ...';
      subEl.textContent = 'Rakip kaleci devleşti. Hemen intikam maçı başlat!';
    }

    // Modalı Göster
    document.getElementById('gameOverModal').classList.remove('hidden');
  }

  /* ==========================================================================
     11. ARAYÜZ (UI) GÜNCELLEMELERİ & ETKİLEŞİM
     ========================================================================== */
  function updateScoreboardUI(result) {
    document.getElementById('scoreUser').textContent = state.userGoals;
    document.getElementById('totalPointsDisplay').textContent = state.totalPoints;

    const dots = document.querySelectorAll('.p-dot');
    if (dots[state.currentRound]) {
      dots[state.currentRound].classList.remove('pending', 'current');
      if (result === SHOT_RESULT.GOAL) {
        dots[state.currentRound].classList.add('goal');
        dots[state.currentRound].textContent = '✓';
      } else {
        dots[state.currentRound].classList.add('miss');
        dots[state.currentRound].textContent = '✕';
      }
    }
  }

  function showAnnouncementCard(title, sub, cardClass, speed, points) {
    const wrap = document.getElementById('shotAnnouncement');
    const card = wrap.querySelector('.announcement-card');
    card.className = `announcement-card ${cardClass}`;

    document.getElementById('announcementTitle').textContent = title;
    document.getElementById('announcementSub').textContent = sub;
    document.getElementById('announcementStats').textContent = `Hız: ${speed} km/s | ${points > 0 ? `+${points} Puan` : '0 Puan'}`;

    wrap.classList.remove('hidden');
  }

  function hideAnnouncementCard() {
    document.getElementById('shotAnnouncement').classList.add('hidden');
  }

  function applyTeamTheme(teamId) {
    state.team = teamId;
    const body = document.body;
    body.classList.remove('theme-fb', 'theme-gs');
    body.classList.add(teamId === 'FB' ? 'theme-fb' : 'theme-gs');

    const curTeam = TEAMS[teamId];
    document.getElementById('matchupBadge').textContent = `Şutör: ${curTeam.shooter.name} | Kaleci: ${curTeam.rivalGk.name}`;

    // Target butonları aktif rengi tazele
    syncTargetButtons();
  }

  function syncTargetButtons() {
    document.querySelectorAll('.target-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    let preset = 'center';
    if (state.target.x < -0.4 && state.target.y > 0.6) preset = 'top-left';
    else if (Math.abs(state.target.x) <= 0.4 && state.target.y > 0.6) preset = 'top-center';
    else if (state.target.x > 0.4 && state.target.y > 0.6) preset = 'top-right';
    else if (state.target.x < -0.4 && state.target.y <= 0.4) preset = 'bottom-left';
    else if (state.target.x > 0.4 && state.target.y <= 0.4) preset = 'bottom-right';

    const matchBtn = document.querySelector(`.target-btn[data-target="${preset}"]`);
    if (matchBtn) matchBtn.classList.add('active');

    // Metin etiketi
    const labels = {
      'top-left': 'Sol Üst 90',
      'top-center': 'Üst Orta',
      'top-right': 'Sağ Üst 90',
      'bottom-left': 'Sol Alt',
      'center': 'Merkez',
      'bottom-right': 'Sağ Alt'
    };
    document.getElementById('targetCoordLabel').textContent = labels[preset] || 'Özel Hedef';
  }

  function setTargetPreset(preset) {
    switch (preset) {
      case 'top-left': state.target = { x: -0.85, y: 0.90 }; break;
      case 'top-center': state.target = { x: 0.0, y: 0.88 }; break;
      case 'top-right': state.target = { x: 0.85, y: 0.90 }; break;
      case 'bottom-left': state.target = { x: -0.85, y: 0.15 }; break;
      case 'center': state.target = { x: 0.0, y: 0.50 }; break;
      case 'bottom-right': state.target = { x: 0.85, y: 0.15 }; break;
    }
    syncTargetButtons();
  }

  function setImpact(ix, iy) {
    // ix: -1 .. 1, iy: -1 .. 1
    state.impact.x = Math.max(-1, Math.min(1, ix));
    state.impact.y = Math.max(-1, Math.min(1, iy));

    // Pointer pozisyonu (104x104 diyagram)
    const pointer = document.getElementById('impactPointer');
    const px = 52 + state.impact.x * 46;
    const py = 52 + state.impact.y * 46;
    pointer.style.left = `${px}px`;
    pointer.style.top = `${py}px`;

    // Etiketler
    let spinText = 'Düz (0)';
    if (state.impact.x < -0.3) spinText = `Sağ Falso (${Math.round(Math.abs(state.impact.x) * 100)})`;
    else if (state.impact.x > 0.3) spinText = `Sol Falso (${Math.round(state.impact.x * 100)})`;

    let heightText = 'Dengeli';
    if (state.impact.y > 0.4) heightText = 'Havadan / Aşırtma ▲';
    else if (state.impact.y < -0.4) heightText = 'Yerden / Sert ▼';

    let descText = 'Füze (Knuckleball)';
    if (Math.abs(state.impact.x) > 0.4) descText = 'Muz Falso (Magnus)';
    else if (state.impact.y > 0.5) descText = 'Panenka / Aşırtma';

    document.getElementById('spinValueText').textContent = spinText;
    document.getElementById('heightValueText').textContent = heightText;
    document.getElementById('impactDescLabel').textContent = descText;
  }

  function setPower(kmh) {
    state.speedKmh = Math.max(40, Math.min(135, parseInt(kmh, 10)));
    document.getElementById('powerRangeInput').value = state.speedKmh;
    document.getElementById('powerSpeedKmh').textContent = `${state.speedKmh} km/s`;

    const pct = ((state.speedKmh - 40) / 95) * 100;
    document.getElementById('powerBarFill').style.width = `${pct}%`;
    document.getElementById('powerIndicator').style.left = `${pct}%`;

    // Sapma yüzdesi
    const errPct = (3.0 + (pct / 100) * 4.5).toFixed(1);
    document.getElementById('errorMarginBadge').innerHTML = `<span>🎯 İsabet Sapması: <strong>±${errPct}%</strong></span>`;
  }

  /* ==========================================================================
     12. LİDERLİK TABLOSU & LOCALSTORAGE YÖNETİMİ
     ========================================================================== */
  const LEADERBOARD_KEY = 'derby_penalty_leaderboard_v1';

  function getLeaderboard() {
    try {
      const raw = localStorage.getItem(LEADERBOARD_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* sessiz */ }

    // Varsayılan nostaljik derbi rekorları
    return [
      { name: 'Alex10', team: 'FB', diff: 'ZOR', goals: '5/5', score: 920, date: '2026-10-12' },
      { name: 'Hagi10', team: 'GS', diff: 'ZOR', goals: '5/5', score: 905, date: '2026-10-15' },
      { name: 'Volkan01', team: 'FB', diff: 'KOLAY', goals: '5/5', score: 620, date: '2026-11-01' },
      { name: 'Muslera01', team: 'GS', diff: 'KOLAY', goals: '4/5', score: 510, date: '2026-11-05' }
    ];
  }

  function saveScore(name) {
    const list = getLeaderboard();
    const entry = {
      name: name || 'DerbiOyuncusu',
      team: state.team,
      diff: state.difficulty === 'HARD' ? 'ZOR' : 'KOLAY',
      goals: `${state.userGoals}/${state.maxRounds}`,
      score: state.totalPoints,
      date: new Date().toISOString().split('T')[0]
    };

    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const topList = list.slice(0, 10); // İlk 10

    try {
      localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(topList));
    } catch (e) { /* sessiz */ }

    showToast('Skorunuz Liderlik Tablosuna başarıyla kaydedildi! 🏆');
    renderLeaderboard();
  }

  function renderLeaderboard() {
    const tbody = document.getElementById('leaderboardTbody');
    const list = getLeaderboard();
    tbody.innerHTML = '';

    list.forEach((item, idx) => {
      const tr = document.createElement('tr');
      const rankClass = idx === 0 ? 'rank-1' : (idx === 1 ? 'rank-2' : (idx === 2 ? 'rank-3' : ''));
      const chipClass = item.team === 'FB' ? 'chip-fb' : 'chip-gs';

      tr.innerHTML = `
        <td><span class="rank-pill ${rankClass}">${idx + 1}</span></td>
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td><span class="team-chip ${chipClass}">${item.team}</span></td>
        <td>${item.diff}</td>
        <td>${item.goals}</td>
        <td><strong>${item.score}</strong></td>
        <td style="color: #94a3b8; font-size: 0.75rem;">${item.date}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m];
    });
  }

  function showToast(msg) {
    const toast = document.getElementById('toastNotification');
    document.getElementById('toastMessage').textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2800);
  }

  /* ==========================================================================
     13. ARKADAŞA MEYDAN OKUMA URL YÖNETİMİ
     ========================================================================== */
  function parseUrlChallenge() {
    const params = new URLSearchParams(window.location.search);
    const rival = params.get('rival');
    const targetScore = params.get('targetScore');
    const team = params.get('team');

    if (rival && targetScore) {
      state.challenge = {
        rival: rival,
        targetScore: parseInt(targetScore, 10) || 500,
        team: team || 'GS'
      };

      // Banner'ı görünür kıl
      const banner = document.getElementById('challengeBanner');
      document.getElementById('challengeText').innerHTML =
        `<strong>${escapeHtml(rival)}</strong> sana meydan okudu! Hedef Skor: <strong>${state.challenge.targetScore}</strong> Puan. Geçebilir misin?`;
      banner.classList.remove('hidden');

      // Rakip takımın karşısını varsayılan olarak seç
      if (team === 'FB') applyTeamTheme('GS');
      else if (team === 'GS') applyTeamTheme('FB');
    }
  }

  function copyChallengeLink() {
    const nickname = document.getElementById('playerNicknameInput').value.trim() || 'DerbiUstası';
    const currentUrl = window.location.origin + window.location.pathname;
    const challengeUrl = `${currentUrl}?rival=${encodeURIComponent(nickname)}&targetScore=${state.totalPoints}&team=${state.team}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(challengeUrl).then(() => {
        showToast('🔗 Meydan okuma linki kopyalandı! Arkadaşına gönder!');
      }).catch(() => {
        fallbackCopy(challengeUrl);
      });
    } else {
      fallbackCopy(challengeUrl);
    }
  }

  function fallbackCopy(text) {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast('🔗 Meydan okuma linki kopyalandı! Arkadaşına gönder!');
  }

  /* ==========================================================================
     14. OLAY DİNLEYİCİLERİ (EVENT LISTENERS)
     ========================================================================== */
  function setupEventListeners() {
    // 1. Şut Butonu ve Space Tuşu
    const shootBtn = document.getElementById('shootBtn');
    shootBtn.addEventListener('click', () => {
      executeShot();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        executeShot();
      }
    });

    // 2. Kalede Tıklayarak Nişan Alma (Canvas Click)
    canvas.addEventListener('click', (e) => {
      if (state.currentState !== GAME_STATE.AIMING) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = WIDTH / rect.width;
      const scaleY = HEIGHT / rect.height;
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;

      // Kale sınırları içindeyse hedefi ayarla
      if (clickX >= GOAL.leftX - 40 && clickX <= GOAL.rightX + 40 &&
          clickY >= GOAL.crossbarY - 30 && clickY <= GOAL.groundY + 20) {

        const normX = (clickX - (GOAL.leftX + GOAL.width * 0.5)) / (GOAL.width * 0.45);
        const normY = (GOAL.groundY - clickY) / (GOAL.height * 0.92);

        state.target.x = Math.max(-1.1, Math.min(1.1, normX));
        state.target.y = Math.max(-0.1, Math.min(1.1, normY));

        syncTargetButtons();
        sfx.ensureRunning();
      }
    });

    // 3. Hedef Hızlı Seçim Butonları
    document.querySelectorAll('.target-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.currentState !== GAME_STATE.AIMING) return;
        const targetType = btn.getAttribute('data-target');
        setTargetPreset(targetType);
        sfx.ensureRunning();
      });
    });

    // 4. İnteraktif Top Vuruş Noktası (Ball Diagram Click)
    const ballDiag = document.getElementById('ballDiagram');
    ballDiag.addEventListener('click', (e) => {
      const rect = ballDiag.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const normX = (clickX - cx) / cx;
      const normY = (clickY - cy) / cy;

      setImpact(normX, normY);
      sfx.ensureRunning();
    });

    // Mini Preset Butonları
    document.querySelectorAll('.mini-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mini-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const p = btn.getAttribute('data-preset');
        switch (p) {
          case 'left-curl': setImpact(-0.65, 0.1); break;
          case 'knuckle': setImpact(0, 0); break;
          case 'right-curl': setImpact(0.65, 0.1); break;
          case 'chip': setImpact(0, 0.7); break;
        }
        sfx.ensureRunning();
      });
    });

    // 5. Şut Hızı Slider'ı
    const powerInput = document.getElementById('powerRangeInput');
    powerInput.addEventListener('input', (e) => {
      setPower(e.target.value);
    });

    // 6. Takım Seçim Kartları
    document.querySelectorAll('.team-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.team-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const teamId = card.getAttribute('data-team');
        applyTeamTheme(teamId);
      });
    });

    // 7. Oyunu Başlat Butonu (Modal)
    document.getElementById('startGameBtn').addEventListener('click', () => {
      const diffRadio = document.querySelector('input[name="difficulty"]:checked');
      state.difficulty = diffRadio ? diffRadio.value : 'HARD';

      document.getElementById('difficultyBadge').textContent = `ZORLUK: ${state.difficulty === 'HARD' ? 'ZOR 🔥' : 'KOLAY'}`;
      document.getElementById('teamSelectModal').classList.add('hidden');

      restartMatch();
    });

    // 8. Skor Kaydet Butonu
    document.getElementById('saveScoreBtn').addEventListener('click', () => {
      const name = document.getElementById('playerNicknameInput').value.trim();
      saveScore(name);
      document.getElementById('saveScoreBtn').disabled = true;
      document.getElementById('saveScoreBtn').textContent = 'KAYDEDİLDİ ✓';
    });

    // 9. Arkadaşa Meydan Oku Butonu
    document.getElementById('copyChallengeLinkBtn').addEventListener('click', () => {
      copyChallengeLink();
    });

    // 10. Yeniden Oyna Butonları
    document.getElementById('playAgainBtn').addEventListener('click', () => {
      document.getElementById('gameOverModal').classList.add('hidden');
      restartMatch();
    });

    document.getElementById('changeTeamBtn').addEventListener('click', () => {
      document.getElementById('teamSelectModal').classList.remove('hidden');
    });

    // 11. Liderlik Tablosu Aç/Kapat
    const openLeaderboard = () => {
      renderLeaderboard();
      document.getElementById('leaderboardModal').classList.remove('hidden');
    };
    document.getElementById('leaderboardBtn').addEventListener('click', openLeaderboard);
    document.getElementById('viewLeaderboardFromEndBtn').addEventListener('click', openLeaderboard);

    document.getElementById('closeLeaderboardBtn').addEventListener('click', () => {
      document.getElementById('leaderboardModal').classList.add('hidden');
    });

    document.getElementById('clearLeaderboardBtn').addEventListener('click', () => {
      if (confirm('Liderlik tablosunu sıfırlamak istediğinize emin misiniz?')) {
        localStorage.removeItem(LEADERBOARD_KEY);
        renderLeaderboard();
        showToast('Tablo sıfırlandı.');
      }
    });

    // 12. Ses Aç/Kapat Butonu
    const soundBtn = document.getElementById('soundToggleBtn');
    soundBtn.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      soundBtn.textContent = state.soundEnabled ? '🔊' : '🔇';
      showToast(state.soundEnabled ? 'Ses Açık' : 'Ses Kapatıldı');
    });

    // 13. Banner Kapat Butonu
    document.getElementById('closeChallengeBtn').addEventListener('click', () => {
      document.getElementById('challengeBanner').classList.add('hidden');
    });
  }

  function restartMatch() {
    state.currentRound = 0;
    state.userGoals = 0;
    state.totalPoints = 0;
    state.roundsHistory = [];
    state.shotHistory = [];
    state.currentState = GAME_STATE.AIMING;

    // Scoreboard sıfırla
    document.getElementById('scoreUser').textContent = '0';
    document.getElementById('scoreTarget').textContent = '0';
    document.getElementById('totalPointsDisplay').textContent = '0';
    document.getElementById('roundBadge').textContent = `Atış 1 / ${state.maxRounds}`;

    const dots = document.querySelectorAll('.p-dot');
    dots.forEach((dot, idx) => {
      dot.className = 'p-dot pending';
      dot.textContent = idx + 1;
      if (idx === 0) dot.classList.add('current');
    });

    document.getElementById('saveScoreBtn').disabled = false;
    document.getElementById('saveScoreBtn').textContent = 'KAYDET';

    ball.reset();
    goalkeeper.reset();
    shooter.reset();
    netGrid.init();
    particles.length = 0;

    prepareNextShot();
  }

  /* ==========================================================================
     15. ANA OYUN DÖNGÜSÜ (GAME LOOP - 60 FPS)
     ========================================================================== */
  let lastTime = performance.now();

  function tick(now) {
    if (!now) now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;

    // 1. Güncellemeler
    goalkeeper.update(dt);
    shooter.update(dt);
    ball.update(dt);
    netGrid.update();

    // 2. Çizim
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawStadium();
    goalkeeper.draw(ctx);
    drawReticle();
    shooter.draw(ctx);
    ball.draw(ctx);
    updateAndDrawParticles(ctx);
  }

  function gameLoop(now) {
    tick(now);
    requestAnimationFrame(gameLoop);
  }

  // Headless veya arka plan sekmelerinde rAF duraksarsa setInterval ile güvenceye al:
  setInterval(() => {
    const now = performance.now();
    if (now - lastTime > 45) {
      tick(now);
    }
  }, 16);

  /* ==========================================================================
     16. BAŞLATMA (INIT)
     ========================================================================== */
  function init() {
    netGrid.init();
    setImpact(0, 0);
    setPower(95);
    setTargetPreset('center');
    setupEventListeners();
    parseUrlChallenge();
    applyTeamTheme(state.team);

    // İlk animasyon döngüsünü başlat
    requestAnimationFrame(gameLoop);
  }

  window.addEventListener('DOMContentLoaded', init);

})();
