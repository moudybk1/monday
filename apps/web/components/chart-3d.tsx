'use client';

import { useEffect, useRef, useState } from 'react';
import { useLiveState } from './landing';

/*
  The landing hero's 3D: Perpl's BTC chart, live, as solid candles with their volume underneath, that the reader can
  turn by dragging. The last 72 fifteen-minute candles come from /api/candles (Perpl's own); the last one follows the
  live mid every second, and the history is read again each minute. Without the server it draws example candles and
  says so in its caption.

  WebGL through three.js, loaded after the page is up. No WebGL: nothing is drawn and the hero reads without it.
  Off screen it stops drawing. On a touch screen a sideways drag turns it and an upward one still scrolls the page.
  Under reduced motion it neither grows in nor sways by itself; dragging still turns it.
*/

interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number }

const SYM = 'BTC';
const BARS = 72;
const STEP = 0.34; // world units between candles
const TOP = 8.6, BASE = 1.9, VOL = 1.3; // candles fill BASE..TOP, volume 0..VOL beneath them
const UP = 0x2fbf93, DOWN = 0xec6a43;
const REST_AZ = 0.55; // the resting view: from the right of the chart, radians

/** A plausible session when the server is unreachable: a drift with noise. Labelled as an example, never as Perpl. */
function example(): Candle[] {
  let p = 64_000;
  return Array.from({ length: BARS }, (_, i) => {
    const o = p;
    p *= 1 + (Math.random() - 0.48) * 0.006;
    const c = p;
    return { t: i, o, c, h: Math.max(o, c) * (1 + Math.random() * 0.002), l: Math.min(o, c) * (1 - Math.random() * 0.002), v: 20_000 + Math.random() * 80_000 };
  });
}

const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function Chart3D({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const live = useLiveState();
  const mid = useRef<number | null>(null);
  mid.current = live?.markets[SYM]?.mid ?? null;
  const [source, setSource] = useState<'perpl' | 'example' | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let cleanup = () => {};
    void (async () => {
      const THREE = await import('three');
      if (dead) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      } catch {
        return; // no WebGL: the hero stands without the picture
      }
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      const canvas = renderer.domElement;
      canvas.style.cssText = 'display:block;width:100%;height:100%;opacity:0;transition:opacity 1.2s cubic-bezier(.16,1,.3,1)';
      el.appendChild(canvas);

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x000000, 24, 46);
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(-8, 14, 12);
      scene.add(sun);

      const font = getComputedStyle(document.body).fontFamily;
      const W = BARS * STEP;
      const x = (i: number) => (i - (BARS - 1) / 2) * STEP;

      // The floor grid under the volume.
      const floor = new THREE.GridHelper(W + 4, (W + 4) / (STEP * 4), 0x262626, 0x141414);
      floor.scale.z = 0.3;
      scene.add(floor);

      // What the candles change: rebuilt whenever a fresh history arrives.
      const geo = { body: new THREE.BoxGeometry(STEP * 0.68, 1, 0.62), wick: new THREE.BoxGeometry(0.045, 1, 0.045), vol: new THREE.BoxGeometry(STEP * 0.68, 1, 0.3) };
      Object.values(geo).forEach((g) => g.translate(0, 0.5, 0));
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.08 });
      const volMat = new THREE.MeshStandardMaterial({ roughness: 0.8, transparent: true, opacity: 0.5 });
      let chart: InstanceType<typeof THREE.Group> | null = null;
      let data: Candle[] = [];
      let lo = 0, hi = 1, vmax = 1;
      let bodies: InstanceType<typeof THREE.InstancedMesh>, wicks: InstanceType<typeof THREE.InstancedMesh>, vols: InstanceType<typeof THREE.InstancedMesh>;
      let lastLine: InstanceType<typeof THREE.Line>, tag: ReturnType<typeof label>;
      let axis: { v: number; s: ReturnType<typeof label> }[] = [];
      const y = (p: number) => BASE + ((p - lo) / (hi - lo)) * (TOP - BASE);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();

      /** One candle's three boxes, grown to `g` (0 to 1) for the entrance. */
      const place = (i: number, g = 1) => {
        const k = data[i];
        const top = Math.max(k.o, k.c), bot = Math.min(k.o, k.c);
        const e = g * g * (3 - 2 * g);
        const ym = y((top + bot) / 2);
        const bh = Math.max(0.035, y(top) - y(bot)) * e;
        bodies.setMatrixAt(i, m.compose(p.set(x(i), ym - bh / 2, 0), q, s.set(1, Math.max(bh, 1e-4), 1)));
        const wh = (y(k.h) - y(k.l)) * e;
        wicks.setMatrixAt(i, m.compose(p.set(x(i), ym - wh / 2, 0), q, s.set(1, Math.max(wh, 1e-4), 1)));
        vols.setMatrixAt(i, m.compose(p.set(x(i), 0, 0.15), q, s.set(1, Math.max(((k.v ?? 0) / vmax) * VOL * e, 1e-4), 1)));
        const up = k.c >= k.o;
        bodies.setColorAt(i, col.set(up ? UP : DOWN));
        wicks.setColorAt(i, col.set(up ? UP : DOWN));
        vols.setColorAt(i, col.set(up ? UP : DOWN).multiplyScalar(0.55));
      };
      const flush = () => {
        for (const mesh of [bodies, wicks, vols]) {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.instanceColor!.needsUpdate = true;
        }
      };
      const pointTo = (price: number) => {
        lastLine.position.y = y(price);
        tag.draw(fmt(price));
        tag.position.y = y(price);
        axis.forEach((a) => { a.s.visible = Math.abs(y(a.v) - y(price)) > 0.5; }); // the tag takes the place of a level it covers
      };

      const build = (cs: Candle[]) => {
        if (chart) {
          scene.remove(chart);
          chart.traverse((o) => {
            const any = o as { material?: { map?: { dispose(): void }; dispose(): void }; geometry?: { dispose(): void } };
            if (o instanceof THREE.InstancedMesh) return; // shared geometry and materials, kept
            any.material?.map?.dispose();
            any.material?.dispose();
            if (!(o instanceof THREE.Sprite)) any.geometry?.dispose();
          });
          [bodies, wicks, vols].forEach((mesh) => mesh.dispose());
        }
        data = cs.slice(-BARS);
        while (data.length < BARS) data.unshift({ ...data[0] });
        lo = Math.min(...data.map((k) => k.l));
        hi = Math.max(...data.map((k) => k.h));
        const pad = (hi - lo) * 0.08;
        lo -= pad; hi += pad;
        vmax = Math.max(1, ...data.map((k) => k.v ?? 0));
        chart = new THREE.Group();
        bodies = new THREE.InstancedMesh(geo.body, mat, BARS);
        wicks = new THREE.InstancedMesh(geo.wick, mat, BARS);
        vols = new THREE.InstancedMesh(geo.vol, volMat, BARS);
        chart.add(bodies, wicks, vols);

        // Price levels on the back wall, labelled at the right.
        const levels = ticks(lo, hi, 5);
        const pts: number[] = [];
        axis = [];
        levels.forEach((v) => {
          pts.push(-W / 2 - 0.4, y(v), -0.8, W / 2 + 0.4, y(v), -0.8);
          const t = label(THREE, v.toLocaleString('en-US', { maximumFractionDigits: 0 }), font, { size: 30, weight: 500, color: 'rgba(255,255,255,0.5)', w: 256, h: 64 });
          t.position.set(W / 2 + 1.6, y(v), -0.8);
          t.scale.set(2.2, 0.55, 1);
          axis.push({ v, s: t });
          chart!.add(t);
        });
        const grid = new THREE.BufferGeometry();
        grid.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        chart.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: 0x2a2a2a })));

        // The last price: a dashed line across and a tag at the right, moved by the live mid.
        const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-W / 2 - 0.4, 0, 0.35), new THREE.Vector3(W / 2 + 0.4, 0, 0.35)]);
        lastLine = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.16, gapSize: 0.12, transparent: true, opacity: 0.6 }));
        lastLine.computeLineDistances();
        tag = label(THREE, '', font, { size: 30, weight: 700, color: '#000', bg: '#fff', w: 256, h: 64 });
        tag.position.set(W / 2 + 1.6, 0, 0.35);
        tag.scale.set(2.2, 0.55, 1);
        chart.add(lastLine, tag);
        pointTo(data[BARS - 1].c);

        for (let i = 0; i < BARS; i++) place(i, still || !intro ? 1 : 0);
        flush();
        scene.add(chart);
      };

      let intro = true;
      let started = 0;
      let kind: 'perpl' | 'example' | null = null;
      const load = async () => {
        try {
          const res = await fetch(`/api/candles?market=${SYM}&res=900&bars=${BARS}`);
          const cs = res.ok ? ((await res.json()) as Candle[]) : [];
          if (dead) return;
          if (cs.length >= 30) {
            build(cs);
            kind = 'perpl';
            setSource(kind);
            return;
          }
        } catch { /* fall through to the example */ }
        if (dead || data.length) return;
        build(example());
        kind = 'example';
        setSource(kind);
      };
      await load();
      if (dead) return;
      const refresh = setInterval(() => { intro = false; void load(); }, 60_000);

      // Turning: drag sideways to swing round the chart, up and down (mouse) to look from higher or lower.
      const view = { az: REST_AZ, el: 0.2, vAz: 0, dragging: false, lastX: 0, lastY: 0, idleAt: 0 };
      const onDown = (e: PointerEvent) => {
        view.dragging = true;
        view.lastX = e.clientX;
        view.lastY = e.clientY;
        view.vAz = 0;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
      };
      const onMove = (e: PointerEvent) => {
        if (!view.dragging) return;
        const dx = e.clientX - view.lastX, dy = e.clientY - view.lastY;
        view.lastX = e.clientX;
        view.lastY = e.clientY;
        view.vAz = -dx * 0.006;
        view.az = Math.max(-0.9, Math.min(1.3, view.az + view.vAz));
        if (e.pointerType === 'mouse') view.el = Math.max(0.02, Math.min(0.9, view.el + dy * 0.004));
      };
      const onUp = (e: PointerEvent) => {
        view.dragging = false;
        view.idleAt = performance.now();
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        el.style.cursor = 'grab';
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);

      let narrow = false;
      const fit = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        narrow = w / h < 0.9 || w < 640;
        camera.updateProjectionMatrix();
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);

      let visible = true;
      const io = new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible) loop();
      });
      io.observe(el);

      const target = new THREE.Vector3();
      let last = performance.now(), raf = 0, shown = mid.current;
      const draw = (now: number, dt: number) => {
        if (!started) started = now;
        const t = (now - started) / 1000;
        // Entrance: the candles grow in from the left.
        if (intro && !still) {
          for (let i = 0; i < BARS; i++) place(i, Math.min(1, Math.max(0, (t - 0.2 - i * 0.016) / 0.55)));
          flush();
          if (t > 0.2 + BARS * 0.016 + 0.6) intro = false;
        }
        // The live mid moves the last candle and the price line.
        const live = mid.current;
        if (!intro && kind === 'perpl' && live && live !== shown && data.length) {
          shown = live;
          const k = data[BARS - 1];
          k.c = live; k.h = Math.max(k.h, live); k.l = Math.min(k.l, live);
          place(BARS - 1);
          flush();
          pointTo(live);
        }
        // Momentum after a drag, then, once left alone, a slow sway back round to the resting view.
        if (!view.dragging) {
          view.az = Math.max(-0.9, Math.min(1.3, view.az + view.vAz));
          view.vAz *= Math.pow(0.04, dt);
          if (!still && now - view.idleAt > 3500) {
            const rest = REST_AZ + Math.sin(t * 0.22) * 0.12;
            view.az += (rest - view.az) * Math.min(1, dt * 0.5);
            view.el += (0.2 - view.el) * Math.min(1, dt * 0.5);
          }
        }
        const pv = Math.min(1, scrollY / Math.max(1, el.clientHeight));
        // Aimed at the latest candles, seen from the right, so they stand close and the history recedes to the left.
        const dist = narrow ? 23 : 20;
        const el2 = view.el + pv * 0.25;
        target.set(W / 2 - (narrow ? 3 : 3.2), (BASE + TOP) / 2 - 0.6, 0);
        camera.position.set(target.x + Math.sin(view.az) * Math.cos(el2) * dist, target.y + Math.sin(el2) * dist, Math.cos(view.az) * Math.cos(el2) * dist);
        camera.lookAt(target);
        renderer.render(scene, camera);
      };
      function loop() {
        cancelAnimationFrame(raf);
        last = performance.now();
        raf = requestAnimationFrame(function frame(now) {
          draw(now, Math.min(0.05, (now - last) / 1000));
          last = now;
          if (visible) raf = requestAnimationFrame(frame);
        });
      }
      draw(performance.now(), 0);
      canvas.style.opacity = '1';
      loop();

      cleanup = () => {
        cancelAnimationFrame(raf);
        clearInterval(refresh);
        visible = false;
        io.disconnect();
        ro.disconnect();
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        Object.values(geo).forEach((g) => g.dispose());
        mat.dispose();
        volMat.dispose();
        renderer.dispose();
        canvas.remove();
      };
    })();
    return () => { dead = true; cleanup(); };
    // The scene is built once; the live mid reaches it through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className}>
      <div
        ref={host} aria-hidden style={{ touchAction: 'pan-y', cursor: 'grab' }}
        className="absolute inset-0 [mask-image:linear-gradient(to_bottom,black_80%,transparent)] lg:[mask-image:linear-gradient(to_right,transparent_2%,black_30%),linear-gradient(to_bottom,black_82%,transparent)] lg:[mask-composite:intersect]"
      />
      {source && (
        <p className="enter pointer-events-none absolute bottom-3 right-4 text-[13px] text-fg-3 sm:right-8 lg:bottom-10">
          {source === 'perpl' ? 'BTC on Perpl, 15-minute candles, live.' : 'Example candles.'} Drag to turn it.
        </p>
      )}
    </div>
  );
}

/** Round price levels inside the range, about `n` of them. */
function ticks(lo: number, hi: number, n: number): number[] {
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((v) => v >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

/** Text on a sprite that always faces the reader; `draw` replaces the text. */
function label(THREE: typeof import('three'), text: string, font: string, o: { size: number; weight: number; color: string; bg?: string; w: number; h: number }) {
  const c = document.createElement('canvas');
  c.width = o.w;
  c.height = o.h;
  const g = c.getContext('2d')!;
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = Object.assign(new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false })), {
    draw(t: string) {
      g.clearRect(0, 0, o.w, o.h);
      g.font = `${o.weight} ${o.size}px ${font}`;
      g.textBaseline = 'middle';
      if (o.bg) {
        const tw = g.measureText(t).width + 28;
        g.fillStyle = o.bg;
        g.beginPath();
        g.roundRect(0, 8, tw, o.h - 16, 10);
        g.fill();
      }
      g.fillStyle = o.color;
      g.fillText(t, o.bg ? 14 : 0, o.h / 2 + 2);
      map.needsUpdate = true;
    },
  });
  sprite.center.set(0, 0.5); // anchored at its left edge, beside the axis
  sprite.draw(text);
  return sprite;
}
