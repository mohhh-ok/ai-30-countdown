// 観客ビューの主役枠(.hero)に重ねる軽量WebGL演出レイヤ（案A: 背景だけWebGL演出）。
// 背景絵の上に「霊気」の光の粒子をゆっくり漂わせるだけの演出専用レイヤ。
// 数値・仕掛け（報酬/抗体/気分/囁き）は一切出さない（FrontStage の表ビュー原則を踏襲）。
//
// 設計メモ:
// - three を使うが、生成/破棄を厳密に行い WebGL コンテキストを取りこぼさない。
// - タブ非表示(document.hidden)中はループを止めて、自走配信中の無駄な負荷を避ける。
// - WebGL 非対応・初期化失敗時は「黙って既定化」せず warn で可視化し、演出だけ諦める
//   （本体UIは別レイヤなので演出無効でも観客ビューは成立する）。
import { useEffect, useRef } from "react";
import * as THREE from "three";

/** 霊気の粒子の数。控えめにしてモバイルでも軽く保つ。 */
const PARTICLE_COUNT = 90;

export function SceneFX({ tone = "warm" }: { tone?: "warm" | "cool" }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch (e) {
      // フォールバックで別物に差し替えたりせず、演出レイヤだけ諦める。理由を必ず可視化する。
      console.warn("[SceneFX] WebGL 初期化に失敗。演出レイヤを無効化します:", e);
      return;
    }

    // 高 DPI でも 2x までに抑える（4K 等で粒子描画が重くなりすぎないように）。
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0); // 背景は透過（下の背景絵を活かす）
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // 奥行きを少しだけ持たせて、粒子が手前/奥でほのかにボケるように。
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = 6;

    // 粒子の初期位置と、各粒子の上昇速度・横ゆらぎ位相を用意する。
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const drift = new Float32Array(PARTICLE_COUNT); // 上昇速度
    const phase = new Float32Array(PARTICLE_COUNT); // 横ゆらぎの位相
    const SPREAD_X = 9;
    const SPREAD_Y = 6;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * SPREAD_X;
      positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 4;
      drift[i] = 0.15 + Math.random() * 0.35;
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    // 暖色＝焦がし色寄りの霊気、寒色＝青白い霊気。場面に応じて切替できるように tone で分岐。
    const color = tone === "cool" ? 0x8fb6d6 : 0xe8b878;
    const material = new THREE.PointsMaterial({
      color,
      size: 0.14,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending, // 光が背景に溶けて重なる
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // mount のサイズに追従してレンダラ/カメラを合わせる。
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // アニメーションループ。フレーム間の実経過時間(dt)で粒子を進める。
    // 固定デルタ(0.016)にすると 120Hz 端末で 2倍速・低スペックで遅延するため、
    // rAF の now 引数から dt を計算する。タブ復帰時の大跳びは 50ms 上限でキャップする。
    let raf = 0;
    let running = true;
    let lastNow = 0;
    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const animate = (now: number) => {
      if (!running) return;
      const dt = lastNow === 0 ? 1 / 60 : Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;
      const t = now * 0.001;
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        // ゆっくり上昇、上端を越えたら下端へ巻き戻す。
        let y = arr[i * 3 + 1] + drift[i] * dt;
        if (y > SPREAD_Y / 2) y = -SPREAD_Y / 2;
        arr[i * 3 + 1] = y;
        // 横方向はサインで微かに揺らす（蛍のような漂い）。X はサイン波なので上限あり。
        arr[i * 3 + 0] += Math.sin(t + phase[i]) * 0.0025;
      }
      posAttr.needsUpdate = true;
      points.rotation.z = Math.sin(t * 0.05) * 0.05;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    // タブが隠れている間はループを止める（配信用に無駄な GPU/CPU を使わない）。
    // 復帰時に lastNow をリセットしないと、隠れていた時間分が dt として大跳びするため必ずリセット。
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        lastNow = 0; // タブ復帰時の大跳び防止
        running = true;
        raf = requestAnimationFrame(animate);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // 後始末: ループ停止・監視解除・WebGL リソース破棄・DOM から canvas を外す。
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [tone]);

  return <div ref={mountRef} className="scene-fx" aria-hidden />;
}
