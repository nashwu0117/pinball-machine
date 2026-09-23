/**
 * Minimal HTML overlay.
 *
 * The spec calls for almost no HUD, so this is deliberately tiny: the ball
 * count, the current target, a power meter that appears while the plunger is
 * being pulled, a SUCCESS / MISS flash, and the game-over card. Everything else
 * the player needs is modelled physically on the machine itself.
 */

import { audio } from './audio.js';
import { PLUNGER, BASE_SCORE_OPTIONS, SHOT_BATCH_OPTIONS } from './config.js';

export class UI {
  /**
   * @param {object} opts
   * @param {import('./controls.js').Controls} opts.controls
   */
  constructor({ controls }) {
    this.controls = controls;
    this.game = null;

    this.el = {
      root: document.getElementById('overlay'),
      balls: document.getElementById('hud-balls'),
      base: document.getElementById('hud-base'),
      score: document.getElementById('hud-score'),
      history: document.getElementById('history-list'),
      stats: document.getElementById('stats-summary'),
      combo: document.getElementById('combo'),
      status: document.getElementById('hud-status'),
      power: document.getElementById('power'),
      powerFill: document.getElementById('power-fill'),
      flash: document.getElementById('flash'),
      gameOver: document.getElementById('game-over'),
      summary: document.getElementById('summary'),
      restart: document.getElementById('restart'),
      hint: document.getElementById('hint'),
      mute: document.getElementById('mute'),
      loading: document.getElementById('loading'),
      welcome: document.getElementById('welcome'),
      welcomeBalls: document.getElementById('welcome-balls'),
      welcomeStart: document.getElementById('welcome-start'),
      touchPower: document.getElementById('touch-power'),
      touchPowerValue: document.getElementById('touch-power-value'),
      actionButton: document.getElementById('action-button'),
    };

    this._flashTimer = 0;
    this._shake = 0;
    this._shakeTime = 0;
    this.shakeOffset = { x: 0, y: 0 };

    this._bind();
  }

  _bind() {
    document.querySelectorAll('[data-base-score]').forEach((button) => {
      button.addEventListener('click', () => {
        if (this.game?.setBaseScore(button.dataset.baseScore)) {
          document.querySelectorAll('[data-base-score]').forEach((b) => b.classList.toggle('selected', b === button));
        }
      });
    });
    document.querySelectorAll('[data-batch-size]').forEach((button) => {
      button.addEventListener('click', () => {
        if (this.game?.setBatchSize(button.dataset.batchSize)) {
          document.querySelectorAll('[data-batch-size]').forEach((b) => b.classList.toggle('selected', b === button));
        }
      });
    });
    this.el.welcomeStart?.addEventListener('click', () => {
      audio.unlock();
      audio.start();
      this.el.welcome?.classList.add('hidden');
      this.game?.pressStart();
    });

    this.el.restart?.addEventListener('click', () => {
      audio.unlock();
      audio.start();
      this.game?.reset();
      this.hideGameOver();
    });

    this.el.touchPower?.addEventListener('input', () => {
      if (this.el.touchPowerValue) this.el.touchPowerValue.value = `${this.el.touchPower.value}%`;
    });

    this.el.actionButton?.addEventListener('click', () => {
      if (!this.game) return;
      audio.unlock();
      if (this.game.state === 'READY' || this.game.state === 'GAME_OVER') {
        this.hideGameOver();
        this.game.pressStart();
      } else if (this.game.state === 'SPINNING') {
        this.game.stopSpin();
      } else if (this.game.state === 'AIMING') {
        const ratio = Number(this.el.touchPower?.value ?? 65) / 100;
        this.game.releasePlunger(PLUNGER.maxPull * ratio);
      }
    });

    this.el.mute?.addEventListener('click', () => {
      audio.unlock();
      this.setMuted(audio.toggleMute());
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR') this.hideGameOver();
    });
  }

  bindGame(game) {
    this.game = game;
  }

  /** Hide the boot placeholder once the first frame has rendered. */
  ready() {
    this.el.loading?.classList.add('hidden');
    this.el.root?.classList.add('ready');
  }

  setMuted(muted) {
    this._muted = muted;
    if (this.el.mute) {
      this.el.mute.textContent = muted ? '\u{1F507} M' : '\u{1F50A} M';
      this.el.mute.dataset.muted = muted ? 'true' : 'false';
    }
  }

  // ------------------------------------------------------------------ effects

  /**
   * Add camera shake. Magnitude is deliberately small: the spec asks for a
   * rumble on hard impacts, not a rollercoaster.
   * @param {number} magnitude
   */
  shake(magnitude) {
    this._shake = Math.min(0.55, this._shake + magnitude);
  }

  /**
   * Advance shake decay and the power meter. Called from the render loop.
   * @param {number} dt
   */
  update(dt) {
    if (this._shake > 0.0005) {
      this._shakeTime += dt;
      this._shake *= Math.exp(-dt * 9.0);
      // Two different frequencies so the shake does not read as a sine wave.
      this.shakeOffset.x = Math.sin(this._shakeTime * 61) * this._shake;
      this.shakeOffset.y = Math.cos(this._shakeTime * 47) * this._shake * 0.7;
    } else {
      this._shake = 0;
      this.shakeOffset.x = 0;
      this.shakeOffset.y = 0;
    }

    if (this.el.power) {
      const pulling = Boolean(this.controls?.dragging || this.controls?.spaceHeld);
      this.el.power.classList.toggle('visible', pulling);
      if (pulling && this.el.powerFill) {
        const ratio = Math.min(1, this.controls.pull / PLUNGER.maxPull);
        this.el.powerFill.style.height = `${(ratio * 100).toFixed(1)}%`;
        this.el.powerFill.dataset.power = ratio > 0.75 ? 'high' : ratio > 0.4 ? 'mid' : 'low';
      }
    }

    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      if (this._flashTimer <= 0) this.el.flash?.classList.remove('visible');
    }
  }

  // ------------------------------------------------------------------- render

  /**
   * Repaint the HUD from the current game state.
   * @param {import('./game.js').Game} game
   */
  render(game) {
    this.game = game;
    const { state } = game;

    if (this.el.balls) this.el.balls.textContent = String(game.balls);
    if (this.el.base) this.el.base.textContent = String(game.baseScore ?? 20);
    if (this.el.welcomeBalls) this.el.welcomeBalls.textContent = String(game.batchSize ?? 10);
    document.querySelectorAll('[data-base-score]').forEach((button) => {
      button.classList.toggle('selected', Number(button.dataset.baseScore) === game.baseScore);
    });
    document.querySelectorAll('[data-batch-size]').forEach((button) => {
      button.classList.toggle('selected', Number(button.dataset.batchSize) === game.batchSize);
    });
    this.renderScore(game);
    this.renderHistory(game);
    this.renderStats(game);
    if (this.el.status) {
      this.el.status.textContent = this._statusText(game);
      this.el.status.dataset.state = state;
    }
    if (this.el.hint) {
      this.el.hint.textContent = this._hintText(game);
      this.el.hint.dataset.state = state;
    }

    if (state !== 'READY' || game.shots > 0) this.el.welcome?.classList.add('hidden');

    if (this.el.actionButton) {
      const labels = {
        READY: '開始抽獎',
        SPINNING: '抽選跑燈中',
        AIMING: '發射鋼珠',
        IN_PLAY: '鋼珠滾動中',
        RESOLVING: '結算中…',
        GAME_OVER: '再玩一局',
      };
      this.el.actionButton.textContent = labels[state] ?? '開始';
      this.el.actionButton.disabled = !['READY', 'SPINNING', 'AIMING', 'GAME_OVER'].includes(state);
    }

    if (state === 'GAME_OVER') this.showGameOver(game);
    if (game.pendingResult) this.flashResult(game.pendingResult);
  }

  /** Update fast-changing score fields without replaying result effects. */
  renderScore(game) {
    if (this.el.score) this.el.score.textContent = String(game.score ?? 0).padStart(5, '0');
    if (this.el.combo) {
      this.el.combo.textContent = `COMBO ×${game.combo ?? 0}`;
      this.el.combo.classList.toggle('active', (game.combo ?? 0) > 1);
    }
  }

  _statusText(game) {
    switch (game.state) {
      case 'READY': return '投入 1 顆鋼珠，按白色跳燈鈕';
      case 'SPINNING': return '紅燈球道與獎勵顆數跳動中・再按一次停止';
      case 'AIMING': return `基礎 ${game.baseScore} 分 — 往下拉右下角彈簧發射`;
      case 'IN_PLAY': return '鋼珠穿越釘陣中…';
      case 'RESOLVING':
        if (game.pendingResult?.type !== 'score') return '彈珠未進洞，再來一球';
        return game.pendingResult.hitTarget
          ? `命中指定球道！贏得 ${game.pendingResult.reward} 顆彈珠`
          : `進入 ×${game.pendingResult.value} 洞！`;
      case 'GAME_OVER': return '本張票券已結算';
      default: return '';
    }
  }

  _hintText(game) {
    switch (game.state) {
      case 'READY': return '每局共 ' + (game.batchSize ?? 10) + ' 顆，逐顆投入；SPACE 或點白色按鈕開始跳燈';
      case 'AIMING': return '將拉桿往下拉出蓄力、放開發射；力道不足會退回原位';
      default: return '';
    }
  }

  /**
   * Show the SUCCESS / MISS banner.
   * @param {{type: string, value: number|null}} result
   */
  flashResult(result) {
    const el = this.el.flash;
    if (!el) return;
    if (result.type === 'score' && result.hitTarget) el.textContent = `命中指定球道！+${result.reward} 顆彈珠 ・ +${result.points} 分`;
    else if (result.type === 'score') el.textContent = `×${result.value}！  +${result.points} 分`;
    else if (result.type === 'retry') el.textContent = '力道不足・再拉一次';
    else el.textContent = '未進球槽';
    el.dataset.type = result.type === 'score' ? (result.hitTarget ? 'jackpot' : (result.value >= 10 ? 'jackpot' : 'score')) : result.type;
    el.classList.add('visible');
    this._flashTimer = 1.15;
  }

  showGameOver(game) {
    const el = this.el.gameOver;
    if (!el) return;
    el.classList.add('visible');
    if (this.el.summary) {
      this.el.summary.innerHTML = [
        `本局發射：<b>${game.shots}</b> 顆`,
        `成功命中：<b>${game.hits}</b> 次`,
        `命中指定球道：<b>${game.targetHits ?? 0}</b> 次`,
        `贏回球數：<b>${game.ballsWon ?? 0}</b> 顆`,
        `本局總分：<b>${game.score}</b>`,
        `最高單次：<b>${game.highestShot}</b>`,
      ].join('<br>');
    }
  }

  renderHistory(game) {
    if (!this.el.history) return;
    this.el.history.innerHTML = (game.history ?? []).slice(0, 8).map((entry) =>
      `<li>第 ${entry.shot} 球：<b>×${entry.multiplier}</b> → <strong>+${entry.points}</strong></li>`
    ).join('');
  }

  renderStats(game) {
    if (!this.el.stats) return;
    const counts = Object.entries(game.multiplierStats ?? {}).map(([m, n]) => `×${m}:${n}`).join('  ');
    this.el.stats.innerHTML = `<b>統計</b><br>發射 ${game.shots ?? 0} 球 ・ 最高 ${game.highestShot ?? 0} 分<br>${counts}`;
  }

  hideGameOver() {
    this.el.gameOver?.classList.remove('visible');
  }
}
