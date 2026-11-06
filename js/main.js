/* Scan Graphic SA — site behaviour
   1. Header: highlights the section in view, white menu on Accueil.
   2. Galerie: Avant / Après cards.
      - The "Avant" / "Après" buttons (or a click on the image) switch the
        image, with a gooey wipe from the side of the button.
      - Hovering the image reveals the other version through a gooey blob
        that follows the mouse (simplified take on Codrops' "Gooey Hover").
      Drawn with a small WebGL shader, no library. Without WebGL the plain
      <img> stays and the buttons simply swap it.
*/

(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mqMobile = window.matchMedia('(max-width: 1000px)'); // same breakpoint as the CSS

  /* ---------- 1. Header ---------- */

  const header = document.querySelector('.header');
  const links = [...document.querySelectorAll('.nav a, .menu-mobile__nav a')];
  const sections = [...document.querySelectorAll('[data-section]')];
  let ticking = false;

  function updateHeader() {
    ticking = false;
    const probe = mqMobile.matches ? 100 : 190; // just under the header
    let current = sections[0];
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= probe) current = s;
    }
    header.dataset.theme = current.dataset.theme || 'dark';
    for (const a of links) {
      a.classList.toggle('is-active', a.getAttribute('href') === '#' + current.id);
    }
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(updateHeader); }
  }, { passive: true });
  window.addEventListener('resize', updateHeader);
  updateHeader();

  /* Mobile menu (burger) */
  const burger = document.querySelector('.burger');
  const menu = document.getElementById('menu-mobile');
  const closeBtn = menu.querySelector('.menu-mobile__close');

  function setMenu(open) {
    menu.hidden = !open;
    burger.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
    (open ? closeBtn : burger).focus({ preventScroll: true });
  }
  burger.addEventListener('click', () => setMenu(true));
  closeBtn.addEventListener('click', () => setMenu(false));
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) setMenu(false); });
  mqMobile.addEventListener('change', () => { if (!mqMobile.matches && !menu.hidden) setMenu(false); });

  /* ---------- 2. Avant / Après ---------- */

  const N = 8;                                              // blob + trail points
  const RADII = [1, 0.84, 0.7, 0.58, 0.48, 0.39, 0.31, 0.24];

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); // (0,0) = top left
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  const FRAG = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uBase;
    uniform sampler2D uTop;
    uniform vec2 uRes;            // canvas size, css px
    uniform vec2 uBaseSize;       // image sizes, px
    uniform vec2 uTopSize;
    uniform vec3 uPts[${N}];      // x, y (css px), radius
    uniform float uTime;
    uniform float uGrayBase;
    uniform float uGrayTop;

    vec2 cover(vec2 uv, vec2 img) {
      float ca = uRes.x / uRes.y;
      float ia = img.x / img.y;
      vec2 s = ca > ia ? vec2(1.0, ia / ca) : vec2(ca / ia, 1.0);
      return (uv - 0.5) * s + 0.5;
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) { return 0.6 * noise(p) + 0.3 * noise(p * 2.1) + 0.1 * noise(p * 4.3); }
    vec3 tone(vec3 c, float g) { return mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), g); }

    void main() {
      vec2 px = vUv * uRes;

      // Metaballs: the points melt together into one gooey shape.
      float f = 0.0;
      for (int i = 0; i < ${N}; i++) {
        vec2 d = px - uPts[i].xy;
        f += (uPts[i].z * uPts[i].z) / max(dot(d, d), 1.0);
      }
      // Organic, slowly moving edge.
      float n = fbm(px / (uRes.y * 0.18) + vec2(uTime * 0.18, -uTime * 0.12));
      f *= 0.7 + 0.6 * n;
      float mask = smoothstep(0.92, 1.08, f);

      vec3 base = tone(texture2D(uBase, cover(vUv, uBaseSize)).rgb, uGrayBase);
      vec3 top  = tone(texture2D(uTop,  cover(vUv, uTopSize)).rgb,  uGrayTop);
      gl_FragColor = vec4(mix(base, top, mask), 1.0);
    }`;

  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const loadImage = src => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });

  class BeforeAfter {
    constructor(figure) {
      this.figure = figure;
      this.media = figure.querySelector('.ba__media');
      this.fallback = figure.querySelector('.ba__img');
      this.buttons = [...figure.querySelectorAll('.ba__btn')];
      this.label = figure.dataset.label || 'Image';

      const avant = figure.dataset.avant;
      const apres = figure.dataset.apres;
      // No "Après" file yet: the Avant photo in black and white stands in.
      this.src = {
        avant: { src: avant, gray: 0 },
        apres: { src: apres || avant, gray: apres ? 0 : 1 },
      };

      this.state = 'avant';
      this.mode = 'idle';     // idle | hover | wipe
      this.inside = false;
      this.s = 0;             // blob scale: 0 hidden, 1 hover size
      this.target = 0;
      this.mouse = { x: 0, y: 0 };
      this.pts = RADII.map(() => ({ x: 0, y: 0 }));
      this.running = false;
      this.t0 = performance.now();

      this.bindUI();
      this.buildSlider();

      // Desktop: gooey WebGL effect. Mobile: slider. WebGL only starts when needed.
      if (!mqMobile.matches) this.initGL();
      mqMobile.addEventListener('change', () => {
        if (mqMobile.matches) this.setPos(this.pos);
        else { this.setButtons(this.state); this.initGL(); }
      });
    }

    /* --- Mobile slider: drag the line, or tap Avant / Après --- */

    buildSlider() {
      const s = document.createElement('div');
      s.className = 'ba__slider';
      const mk = (cls, src) => {
        const im = new Image();
        im.className = cls;
        im.alt = '';
        im.decoding = 'async';
        im.loading = 'lazy';
        im.src = src;
        return im;
      };
      s.appendChild(mk('ba__s-img', this.src.avant.src));
      s.appendChild(mk('ba__s-img ba__s-apres' + (this.src.apres.gray ? ' is-gray' : ''), this.src.apres.src));
      const line = document.createElement('div');
      line.className = 'ba__line';
      const handle = document.createElement('div');
      handle.className = 'ba__handle';
      handle.tabIndex = 0;
      handle.setAttribute('role', 'slider');
      handle.setAttribute('aria-label', `${this.label} : comparer avant et après`);
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', '100');
      handle.innerHTML = '<svg viewBox="0 0 44 44" aria-hidden="true"><path d="M18 15l-7 7 7 7M26 15l7 7-7 7" fill="none" stroke="#FF8F6D" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      s.append(line, handle);
      this.slider = s;
      this.handle = handle;
      this.media.appendChild(s);
      this.pos = 50;
      if (mqMobile.matches) this.setPos(50);

      const fromEvent = e => {
        const r = s.getBoundingClientRect();
        this.setPos(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
      };
      s.addEventListener('pointerdown', e => {
        if (!mqMobile.matches) return;
        this.dragging = true;
        cancelAnimationFrame(this.slideRaf);
        s.setPointerCapture(e.pointerId);
        fromEvent(e);
      });
      s.addEventListener('pointermove', e => { if (this.dragging) fromEvent(e); });
      const stop = () => { this.dragging = false; };
      s.addEventListener('pointerup', stop);
      s.addEventListener('pointercancel', stop);

      handle.addEventListener('keydown', e => {
        const step = { ArrowLeft: -5, ArrowRight: 5, Home: -100, End: 100 }[e.key];
        if (step === undefined) return;
        e.preventDefault();
        this.setPos(Math.min(100, Math.max(0, this.pos + step)));
      });
    }

    setPos(p) {
      this.pos = p;
      this.slider.style.setProperty('--pos', p + '%');
      this.handle.setAttribute('aria-valuenow', String(Math.round(p)));
      this.handle.setAttribute('aria-valuetext', `${Math.round(p)} % avant, ${Math.round(100 - p)} % après`);
      // "Avant" lights up when the whole image is Avant, "Après" when it is all Après.
      this.setButtons(p >= 99 ? 'avant' : p <= 1 ? 'apres' : null);
    }

    slideTo(target) {
      cancelAnimationFrame(this.slideRaf);
      if (reduceMotion) { this.setPos(target); return; }
      const from = this.pos, start = performance.now(), dur = 450;
      const step = now => {
        const k = Math.min((now - start) / dur, 1);
        this.setPos(lerp(from, target, easeInOut(k)));
        if (k < 1) this.slideRaf = requestAnimationFrame(step);
      };
      this.slideRaf = requestAnimationFrame(step);
    }

    /* --- UI --- */

    bindUI() {
      for (const b of this.buttons) {
        b.addEventListener('click', () => {
          if (mqMobile.matches) this.slideTo(b.dataset.show === 'avant' ? 100 : 0);
          else this.toggle(b.dataset.show);
        });
      }
      this.media.addEventListener('click', () => {
        if (mqMobile.matches) return; // on mobile the image is the slider
        this.toggle(this.state === 'avant' ? 'apres' : 'avant');
      });

      const local = e => {
        const r = this.media.getBoundingClientRect();
        this.mouse.x = e.clientX - r.left;
        this.mouse.y = e.clientY - r.top;
      };
      this.media.addEventListener('pointerenter', e => {
        if (e.pointerType !== 'mouse' || reduceMotion || !this.gl || mqMobile.matches) return;
        local(e);
        this.inside = true;
        if (this.mode !== 'wipe') {
          if (this.s < 0.02) this.pts.forEach(p => { p.x = this.mouse.x; p.y = this.mouse.y; });
          this.mode = 'hover';
          this.target = 1;
          this.start();
        }
      });
      this.media.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') local(e); });
      this.media.addEventListener('pointerleave', e => {
        if (e.pointerType !== 'mouse') return;
        this.inside = false;
        this.target = 0;
      });
    }

    setButtons(which) {
      for (const b of this.buttons) {
        const on = b.dataset.show === which;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      }
    }

    syncFallback() {
      const cur = this.src[this.state];
      this.fallback.src = cur.src;
      this.fallback.classList.toggle('is-gray', !!cur.gray);
      this.fallback.alt = `${this.label}, ${this.state === 'avant' ? 'avant' : 'après'} retouche`;
    }

    toggle(to) {
      if (to === this.state || this.mode === 'wipe') return;
      this.setButtons(to);

      if (!this.gl || reduceMotion) {
        this.state = to;
        this.syncFallback();
        if (this.gl) { this.bindTextures(); this.draw(performance.now()); }
        return;
      }

      // Wipe: one big blob grows from the side of the button until it covers the image.
      const cx = to === 'apres' ? this.w * 0.75 : this.w * 0.25;
      const cy = this.h;
      this.pts.forEach(p => { p.x = cx; p.y = cy; });
      const far = Math.hypot(Math.max(cx, this.w - cx), this.h) * 1.6;
      this.wipe = { to: far / this.R, start: performance.now(), dur: 900, next: to };
      this.mode = 'wipe';
      this.start();
    }

    /* --- WebGL --- */

    async initGL() {
      if (this.glStarted) return;
      this.glStarted = true;
      const canvas = document.createElement('canvas');
      canvas.className = 'ba__canvas';
      canvas.setAttribute('aria-hidden', 'true');
      const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
      if (!gl) return; // keep the plain <img>

      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      this.u = {};
      for (const name of ['uBase', 'uTop', 'uRes', 'uBaseSize', 'uTopSize', 'uPts', 'uTime', 'uGrayBase', 'uGrayTop']) {
        this.u[name] = gl.getUniformLocation(prog, name);
      }
      gl.uniform1i(this.u.uBase, 0);
      gl.uniform1i(this.u.uTop, 1);

      // Textures: one per distinct file (placeholder Après reuses the Avant one).
      const files = [...new Set([this.src.avant.src, this.src.apres.src])];
      const images = await Promise.all(files.map(loadImage));
      this.tex = {};
      files.forEach((file, i) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, images[i]);
        this.tex[file] = { t, w: images[i].naturalWidth, h: images[i].naturalHeight };
      });

      this.gl = gl;
      this.canvas = canvas;
      this.media.appendChild(canvas);
      new ResizeObserver(() => { this.resize(); this.draw(performance.now()); }).observe(this.media);
      this.resize();
      this.bindTextures();
      this.draw(performance.now());
      requestAnimationFrame(() => canvas.classList.add('is-ready'));
    }

    resize() {
      const r = this.media.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = r.width;
      this.h = r.height;
      this.R = Math.min(this.w, this.h) * 0.264; // hover blob size
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.gl.uniform2f(this.u.uRes, this.w, this.h);
    }

    bindTextures() {
      const gl = this.gl;
      const base = this.src[this.state];
      const top = this.src[this.state === 'avant' ? 'apres' : 'avant'];
      const tb = this.tex[base.src], tt = this.tex[top.src];
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tb.t);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tt.t);
      gl.uniform2f(this.u.uBaseSize, tb.w, tb.h);
      gl.uniform2f(this.u.uTopSize, tt.w, tt.h);
      gl.uniform1f(this.u.uGrayBase, base.gray);
      gl.uniform1f(this.u.uGrayTop, top.gray);
    }

    draw(now) {
      const gl = this.gl;
      const wiping = this.mode === 'wipe';
      const data = new Float32Array(N * 3);
      this.pts.forEach((p, i) => {
        data[i * 3] = p.x;
        data[i * 3 + 1] = p.y;
        data[i * 3 + 2] = wiping ? (i === 0 ? this.R * this.s : 0) : this.R * RADII[i] * this.s;
      });
      gl.uniform3fv(this.u.uPts, data);
      gl.uniform1f(this.u.uTime, (now - this.t0) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    start() {
      if (this.running) return;
      this.running = true;
      requestAnimationFrame(t => this.tick(t));
    }

    tick(now) {
      if (this.mode === 'wipe') {
        const k = Math.min((now - this.wipe.start) / this.wipe.dur, 1);
        this.s = lerp(0, this.wipe.to, easeInOut(k));
        if (k >= 1) {
          // What was revealed becomes the base image.
          this.state = this.wipe.next;
          this.syncFallback();
          this.bindTextures();
          this.s = 0;
          this.mode = this.inside ? 'hover' : 'idle';
          this.target = this.inside ? 1 : 0;
          this.pts.forEach(p => { p.x = this.mouse.x; p.y = this.mouse.y; });
        }
      } else {
        this.s += (this.target - this.s) * 0.1;
        // Head follows the mouse, each trail point follows the one before it.
        this.pts.forEach((p, i) => {
          const lead = i === 0 ? this.mouse : this.pts[i - 1];
          const f = i === 0 ? 0.28 : 0.3;
          p.x += (lead.x - p.x) * f;
          p.y += (lead.y - p.y) * f;
        });
      }

      this.draw(now);

      if (this.mode === 'wipe' || this.inside || this.s > 0.003) {
        requestAnimationFrame(t => this.tick(t));
      } else {
        this.running = false;
        this.s = 0;
        this.mode = 'idle';
        this.draw(now);
      }
    }
  }

  document.querySelectorAll('.ba').forEach(f => new BeforeAfter(f));
})();
