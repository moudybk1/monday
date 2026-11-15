'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type * as Three from 'three';
import { useLiveState } from './landing';
import { DUSK_BARS, DUSK_SUN } from './ui';

/*
  The landing's two WebGL scenes, after Imagica (2026-11-15). three.js loads only when a scene mounts.
  LiquidPearl: a pearl with Monday's mark resting in dark liquid, and the pearl is the Launch app button. Rings spread
  from it on their own; every BTC price move on Perpl drops a ripple from it, larger for a larger move; a click on the
  liquid drops one where it lands.
  GlassBubbles: glass spheres and rings on the dark for the close, lit periwinkle and indigo at their rims, with the coins
  of markets Perpl lists floating face-on inside them.
*/

type T3 = typeof Three;

/** A renderer filling `host`, drawing only while it is on screen and the tab is shown. Returns its stop function. */
function stage(T: T3, host: HTMLElement, frame: (t: number, r: Three.WebGLRenderer) => void, size: (w: number, h: number) => void, still: boolean, setup?: (r: Three.WebGLRenderer) => void) {
  const r = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  setup?.(r);
  r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity 1.2s ease';
  host.appendChild(r.domElement);
  const t0 = performance.now();
  let raf = 0, on = true;
  const fit = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    r.setSize(w, h, false);
    size(w, h);
    if (still) { frame(0, r); r.domElement.style.opacity = '1'; }
  };
  const loop = () => {
    raf = 0;
    if (!on || document.hidden) return;
    frame((performance.now() - t0) / 1000, r);
    r.domElement.style.opacity = '1';
    raf = requestAnimationFrame(loop);
  };
  const go = () => { if (!still && !raf) raf = requestAnimationFrame(loop); };
  const ro = new ResizeObserver(fit);
  ro.observe(host);
  const io = new IntersectionObserver(([e]) => { on = e.isIntersecting; if (on) go(); }, { rootMargin: '120px' });
  io.observe(host);
  const vis = () => go();
  document.addEventListener('visibilitychange', vis);
  fit();
  go();
  return {
    stop() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
      r.dispose();
      r.domElement.remove();
    },
  };
}

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- The hero: a pearl in liquid, and the pearl is the way into the app ----

const RIPPLES = 12;
const R = 1.5; // the pearl's radius
const REST_Y = 1.18; // a little below its radius: it sits in the liquid

// Height of the liquid at p: standing rings round the pearl plus every ripple still travelling. Flat under the pearl.
const LIQUID = /* glsl */ `
uniform float uT;
uniform vec4 uR[${RIPPLES}];
varying vec2 vXZ;
float rh(vec2 p) {
  float d0 = length(p);
  float h = 0.22 * sin(d0 * 1.8 - uT * 1.4) * exp(-d0 * 0.075);
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 q = uR[i];
    float age = uT - q.z;
    if (q.w <= 0.0 || age < 0.0 || age > 9.0) continue;
    float x = length(p - q.xy) - age * 3.0;
    h += q.w * 0.42 * sin(x * 2.2) * exp(-x * x * 0.22) * exp(-age * 0.38);
  }
  return h * smoothstep(${(R * 0.8).toFixed(2)}, ${(R * 1.9).toFixed(2)}, d0);
}
`;

/**
 * Monday's mark on the pearl, where the sphere's texture faces the camera: u = 0.25 is +z, and the camera looks down
 * about 25 degrees, so the mark sits that far above the equator (y 370 of 1024), widened by 1 / cos 25° to undo the
 * map's squeeze there. A colour map (white, so the pearl's own colour shows, with the mark in periwinkle) and a glow map.
 */
function markTextures(T: T3) {
  const make = (ground: string) => {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 1024;
    const x = c.getContext('2d')!;
    x.fillStyle = ground;
    x.fillRect(0, 0, 2048, 1024);
    // The Dusk mark in its 48-unit box, centred on (32, 30), in the brand periwinkle.
    x.fillStyle = '#a3b3ee';
    x.translate(512, 370);
    x.scale(4.8 * 1.1, 4.8);
    x.translate(-32, -30);
    x.fill(new Path2D(DUSK_SUN));
    for (const [bx, by, bw, o] of DUSK_BARS) {
      x.globalAlpha = o;
      x.beginPath();
      x.roundRect(bx, by, bw, 4, 2);
      x.fill();
    }
    x.globalAlpha = 1;
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: make('#ffffff'), glow: make('#000000') };
}

/**
 * The pearl in its liquid, and the pearl is the button: a round link laid exactly over the drawn pearl opens `href`.
 * Pointed at or focused, the pearl rises, its mark glows and a ripple runs out from under it.
 */
export function LiquidPearl({ className, href }: { className?: string; href: string }) {
  const host = useRef<HTMLDivElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const drop = useRef<((x: number, z: number, a: number) => void) | null>(null);
  const live = useLiveState();
  const mid = live?.markets.BTC?.mid ?? null;
  const last = useRef<number | null>(null);

  // A BTC price move on Perpl: a ripple from the pearl, a basis point a step up to a full one at 4 bps.
  useEffect(() => {
    if (mid == null) return;
    const prev = last.current;
    last.current = mid;
    if (prev == null || prev === mid) return;
    drop.current?.(0, 0, Math.min(1, 0.3 + (Math.abs(mid - prev) / prev) * 1e4 * 0.18));
  }, [mid]);

  useEffect(() => {
    const el = host.current;
    const a = link.current;
    if (!el || !a) return;
    let dead = false;
    let stop = () => {};
    void Promise.all([import('three'), import('three/addons/environments/RoomEnvironment.js')]).then(([T, { RoomEnvironment }]) => {
      if (dead) return;
      const calm = still();
      const scene = new T.Scene();
      const cam = new T.PerspectiveCamera(30, 1, 0.1, 100);
      const u = { uT: { value: 0 }, uR: { value: Array.from({ length: RIPPLES }, () => new T.Vector4(0, 0, 0, 0)) } };
      let next = 0;
      let t = 0;
      drop.current = (x, z, k) => { u.uR.value[next].set(x, z, t, k); next = (next + 1) % RIPPLES; };

      // The liquid: a fine grid lifted in the vertex shader, its normals from the same height, fading into the page.
      const geo = new T.PlaneGeometry(64, 64, 280, 280);
      geo.rotateX(-Math.PI / 2);
      const milk = new T.MeshPhysicalMaterial({ color: 0x151821, roughness: 0.36, clearcoat: 0.55, clearcoatRoughness: 0.32, envMapIntensity: 0.4, transparent: true });
      milk.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, u);
        s.vertexShader = LIQUID + s.vertexShader
          .replace('#include <beginnormal_vertex>', 'float h0 = rh(position.xz);\nvec3 objectNormal = normalize(vec3(h0 - rh(position.xz + vec2(0.05, 0.0)), 0.05, h0 - rh(position.xz + vec2(0.0, 0.05))));')
          .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position);\ntransformed.y += h0;\nvXZ = position.xz;');
        s.fragmentShader = 'varying vec2 vXZ;\n' + s.fragmentShader.replace(
          '#include <dithering_fragment>',
          // A soft darkening where the liquid meets the pearl, then the far liquid fades out into the page itself.
          `#include <dithering_fragment>
          float d = length(vXZ);
          gl_FragColor.rgb *= mix(0.6, 1.0, smoothstep(${(R * 0.9).toFixed(2)}, ${(R * 2.2).toFixed(2)}, d));
          gl_FragColor.a *= 1.0 - smoothstep(8.0, 21.0, length(vXZ * vec2(0.75, 1.0)));`,
        );
      };
      const liquid = new T.Mesh(geo, milk);
      liquid.receiveShadow = true;
      scene.add(liquid);

      // A real pearl: a warm white under a clear coat, a thin-film shimmer at the edges, a soft sheen, and the mark.
      const tex = markTextures(T);
      const shell = new T.MeshPhysicalMaterial({
        color: 0xe6e8f0, map: tex.map, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08,
        iridescence: 0.45, iridescenceIOR: 1.45, iridescenceThicknessMinimum: 220, iridescenceThicknessMaximum: 560,
        sheen: 0.5, sheenColor: new T.Color(0xc9d3ff), sheenRoughness: 0.45,
        emissive: new T.Color(0xa3b3ee), emissiveMap: tex.glow, emissiveIntensity: 0.3,
      });
      const pearl = new T.Mesh(new T.SphereGeometry(R, 128, 96), shell);
      pearl.position.y = REST_Y;
      pearl.castShadow = true;
      scene.add(pearl);

      scene.add(new T.HemisphereLight(0xeef1ff, 0x151821, 0.3));
      // Periwinkle from behind, Monday's colour: a rim on the pearl and a glint on the far side of each ring.
      const rim = new T.DirectionalLight(0xa3b3ee, 0.6);
      rim.position.set(-5, 7, -5);
      scene.add(rim);
      const sun = new T.DirectionalLight(0xf3f5ff, 1.35);
      sun.position.set(8, 5.5, 2.5);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.radius = 14;
      sun.shadow.blurSamples = 20;
      Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
      scene.add(sun);

      const ray = new T.Raycaster();
      const flat = new T.Plane(new T.Vector3(0, 1, 0), 0);
      const hit = new T.Vector3();
      const ndc = new T.Vector2();
      const at = new T.Vector3();
      let w = 1, h = 1;
      let hot = false; // pointed at or focused
      let lift = 0; // 0 at rest, 1 fully raised
      let press = 0;

      const { stop: halt } = stage(T, el, (now, r) => {
        t = calm ? 6 : now;
        u.uT.value = t;
        // Scrolling the hero away sinks the pearl, and with it the button.
        const box = el.getBoundingClientRect();
        const sink = calm ? 0 : Math.min(1, Math.max(0, -box.top / Math.max(1, box.height)) * 1.6);
        lift += ((hot ? 1 : 0) - lift) * (calm ? 1 : 0.12);
        press *= 0.85;
        pearl.position.y = REST_Y - sink * 2.2 + lift * 0.32 + (calm ? 0 : Math.sin(t * 0.9) * 0.04);
        pearl.scale.setScalar(1 + lift * 0.035 - press * 0.05);
        // It sways a little but keeps its mark toward the reader.
        pearl.rotation.y = calm ? 0 : Math.sin(t * 0.3) * 0.22;
        shell.emissiveIntensity = 0.3 + lift * 1.1;
        r.render(scene, cam);
        // The link covers the pearl as drawn: its centre, and its radius from the distance and the field of view.
        at.copy(pearl.position).project(cam);
        const px = (R * pearl.scale.x * (h / 2)) / (cam.position.distanceTo(pearl.position) * Math.tan((cam.fov * Math.PI) / 360));
        a.style.left = `${((at.x + 1) / 2) * w}px`;
        a.style.top = `${((1 - at.y) / 2) * h}px`;
        a.style.width = a.style.height = `${px * 2}px`;
        a.style.visibility = sink > 0.45 ? 'hidden' : 'visible';
      }, (W, H) => {
        w = W; h = H;
        const narrow = W / H < 0.85 || W < 640;
        cam.aspect = W / H;
        // The pearl sits in the lower half, under the headline; on a phone it is drawn smaller and lower.
        cam.position.set(0, narrow ? 9.8 : 9.5, narrow ? 20.5 : 18);
        cam.lookAt(0, narrow ? 4.1 : 3.5, 0);
        cam.updateProjectionMatrix();
      }, calm, (rr) => {
        rr.shadowMap.enabled = true;
        rr.shadowMap.type = T.VSMShadowMap;
        rr.toneMapping = T.NeutralToneMapping;
        rr.toneMappingExposure = 0.9;
        const pm = new T.PMREMGenerator(rr);
        scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = 0.6;
        pm.dispose();
      });

      const click = (e: PointerEvent) => {
        const b = el.getBoundingClientRect();
        ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
        ray.setFromCamera(ndc, cam);
        if (ray.ray.intersectPlane(flat, hit) && hit.length() > R) drop.current?.(hit.x, hit.z, 0.9);
      };
      const on = () => { if (!hot) drop.current?.(0, 0, 0.8); hot = true; };
      const off = () => { hot = false; };
      const down = () => { press = 1; };
      el.addEventListener('pointerdown', click);
      a.addEventListener('pointerenter', on);
      a.addEventListener('pointerleave', off);
      a.addEventListener('focus', on);
      a.addEventListener('blur', off);
      a.addEventListener('pointerdown', down);
      // A first ripple as the page opens, so the liquid is seen to move.
      if (!calm) setTimeout(() => drop.current?.(0, 0, 0.9), 600);

      stop = () => {
        el.removeEventListener('pointerdown', click);
        a.removeEventListener('pointerenter', on);
        a.removeEventListener('pointerleave', off);
        a.removeEventListener('focus', on);
        a.removeEventListener('blur', off);
        a.removeEventListener('pointerdown', down);
        halt();
        geo.dispose();
        milk.dispose();
        pearl.geometry.dispose();
        shell.dispose();
        tex.map.dispose();
        tex.glow.dispose();
        scene.environment?.dispose();
        drop.current = null;
      };
    });
    return () => { dead = true; stop(); };
  }, []);

  return (
    // `className` must position it (absolute or relative with a height): the scene fills it.
    <div className={className}>
      <div ref={host} aria-hidden className="absolute inset-0 cursor-crosshair [mask-image:linear-gradient(to_bottom,black_72%,transparent)]" />
      {/* The pearl is the button. Before the scene draws (or without WebGL) the link sits about where the pearl will be. */}
      <Link
        ref={link} href={href} aria-label="Launch app" title="Launch App"
        className="absolute left-1/2 top-[68%] block size-64 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full focus-visible:outline-offset-4"
      />
    </div>
  );
}

// ---- The close: glass on black ----

// Fresnel glass: almost clear face-on, lit at the rim, periwinkle above and indigo below, with one small highlight.
const GLASS_V = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const GLASS_F = /* glsl */ `
uniform vec3 uA; uniform vec3 uB; uniform float uK;
varying vec3 vN; varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  float f = pow(1.0 - abs(dot(n, vV)), 3.2);
  vec3 c = mix(uB, uA, smoothstep(-0.7, 0.8, n.y));
  float spec = pow(max(dot(n, normalize(vec3(-0.4, 0.7, 0.6) + vV)), 0.0), 90.0);
  gl_FragColor = vec4((c * (f * 0.7 + 0.02) + spec * 0.4) * uK, 1.0);
}`;

/**
 * [x, y, z, size, kind, coin] — kind 0 is a sphere, 1 a ring. A sphere with a coin holds that market's coin, always
 * turned square to the reader (the user found turning coins looked crooked): markets Perpl lists, with icons from
 * web3icons (MIT, notice in public/landing/coins/LICENSE.txt). HYPE is left out on purpose; LIT, PUMP and VVV have no
 * icon there that is surely theirs.
 */
const PIECES: [number, number, number, number, number, string?][] = [
  // The ring at the centre holds Monday's own mark; every other bubble holds a market's coin.
  [0, 0.2, 0, 2.3, 1, 'monday'],
  [-1.9, 1.7, -1.5, 1.35, 0, 'eth'], [2.0, 2.3, -2.5, 1.7, 0, 'btc'], [2.4, -1.6, 0.6, 1.05, 0, 'sol'],
  [-3.3, -1.8, -2.5, 1.5, 0, 'uni'], [4.5, 0.1, -4.5, 1.9, 0, 'zec'], [-0.5, -2.75, 0.8, 0.95, 0, 'near'],
  [0.3, 3.1, -1.2, 1.0, 0, 'mon'],
];

/** A coin's face: its icon drawn onto a canvas, so the SVG stays sharp at any size. Blank until the icon loads. */
function coinFace(T: T3, name: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  if (name === 'monday') {
    // Monday's own mark, drawn here on a clear ground: just the Dusk sun and its bars, no coin behind them.
    const x = c.getContext('2d')!;
    x.fillStyle = '#a3b3ee';
    x.translate(128, 128);
    x.scale(5, 5);
    x.translate(-32, -29.75);
    x.fill(new Path2D(DUSK_SUN));
    for (const [bx, by, bw, o] of DUSK_BARS) {
      x.globalAlpha = o;
      x.beginPath();
      x.roundRect(bx, by, bw, 4, 2);
      x.fill();
    }
    return tex;
  }
  const img = new Image();
  img.onload = () => {
    // The icons are square tiles; the coin shows the round middle of each.
    const x = c.getContext('2d')!;
    x.beginPath();
    x.arc(128, 128, 128, 0, Math.PI * 2);
    x.clip();
    x.drawImage(img, 0, 0, 256, 256);
    tex.needsUpdate = true;
  };
  img.src = `/landing/coins/${name}.svg`;
  return tex;
}

export function GlassBubbles({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let stop = () => {};
    void import('three').then((T) => {
      if (dead) return;
      const calm = still();
      const scene = new T.Scene();
      const cam = new T.PerspectiveCamera(34, 1, 0.1, 100);
      cam.position.set(0, 0, 15);
      const mat = new T.ShaderMaterial({
        vertexShader: GLASS_V, fragmentShader: GLASS_F, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
        uniforms: { uA: { value: new T.Color(0xa3b3ee) }, uB: { value: new T.Color(0x4659a8) }, uK: { value: 1 } },
      });
      const ball = new T.SphereGeometry(1, 64, 48);
      const ring = new T.TorusGeometry(1, 0.14, 48, 160);
      // A coin: a short cylinder stood face-on, its faces the icon (dimmed a little, so it glows less than the rims) and
      // a dark edge. Drawn before the glass, so the bubble's rim light lies over it.
      // A coin: a short dark rim (a cylinder lying along z) with the icon on a flat face in front, so the logo is always
      // upright. Each frame it is turned to face the camera, whatever the group's lean.
      const rim = new T.CylinderGeometry(1, 1, 0.1, 64);
      rim.rotateX(Math.PI / 2);
      const front = new T.CircleGeometry(0.97, 64);
      front.translate(0, 0, 0.051);
      const edge = new T.MeshBasicMaterial({ color: 0x2a2f3c });
      const faces: { dispose(): void }[] = []; // each coin's texture and material
      const group = new T.Group();
      const parts = PIECES.map(([x, y, z, s, kind, coin]) => {
        const m = new T.Mesh(kind ? ring : ball, mat);
        m.position.set(x, y, z);
        m.scale.setScalar(s);
        m.renderOrder = 1;
        if (kind) m.rotation.set(0.5, -0.6, 0.2);
        group.add(m);
        let c: Three.Group | null = null;
        if (coin) {
          const tex = coinFace(T, coin);
          // Market coins a little dimmed so they glow less than the rims; Monday's mark at full strength, the one to see first.
          const face = new T.MeshBasicMaterial({ map: tex, color: coin === 'monday' ? 0xffffff : 0xc4c8d4 });
          faces.push(tex, face);
          c = new T.Group();
          // Monday's mark floats on its own; a market's coin gets a rim behind its face.
          if (coin === 'monday') {
            // Drawn last and over everything: it is the nearest thing in the scene, and a coin behind it must never cut it.
            Object.assign(face, { transparent: true, depthTest: false, depthWrite: false });
            const mark = new T.Mesh(front, face);
            mark.renderOrder = 2;
            c.add(mark);
          } else c.add(new T.Mesh(rim, edge), new T.Mesh(front, face));
          c.position.set(x, y, z);
          c.scale.setScalar(s * 0.56);
          group.add(c);
        }
        return { m, c, y };
      });
      scene.add(group);
      const aim = { x: 0, y: 0 };
      const move = (e: PointerEvent) => { aim.x = e.clientX / window.innerWidth - 0.5; aim.y = e.clientY / window.innerHeight - 0.5; };
      window.addEventListener('pointermove', move, { passive: true });
      const { stop: halt } = stage(T, el, (t, r) => {
        parts.forEach(({ m, c, y }, i) => {
          m.position.y = y + (calm ? 0 : Math.sin(t * 0.5 + i * 1.7) * 0.18);
          if (i === 0) m.rotation.z = 0.2 + t * 0.12;
          if (c) {
            c.position.y = m.position.y;
            c.lookAt(cam.position);
          }
        });
        group.rotation.y += ((calm ? 0 : aim.x * 0.35) - group.rotation.y) * 0.04;
        group.rotation.x += ((calm ? 0 : aim.y * 0.2) - group.rotation.x) * 0.04;
        r.render(scene, cam);
      }, (W, H) => {
        cam.aspect = W / H;
        // Beside the words on a wide screen; above them, dimmer, on a phone.
        const narrow = W < 768;
        group.position.set(narrow ? -0.3 : 4.2, narrow ? 2.45 : 0, 0);
        group.scale.setScalar(narrow ? 0.52 : 1);
        mat.uniforms.uK.value = narrow ? 0.7 : 1;
        cam.updateProjectionMatrix();
      }, calm);
      stop = () => {
        window.removeEventListener('pointermove', move);
        halt();
        ball.dispose();
        ring.dispose();
        rim.dispose();
        front.dispose();
        edge.dispose();
        faces.forEach((f) => f.dispose());
        mat.dispose();
      };
    });
    return () => { dead = true; stop(); };
  }, []);
  return <div ref={host} aria-hidden className={className} />;
}
