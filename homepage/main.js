/* TECTONICA INC. — トップページ
 * 1. ヒーローの骨組解析（2次元フレームの剛性マトリクス法）
 * 2. 作品・プロジェクト一覧・受賞・掲載の描画
 */
(() => {
  "use strict";

  const DATA = window.TECTONICA_DATA || { projects: [], pubs: [], awards: [] };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /* ───────────────────── テーマ（白図／青図） ───────────────────── */
  const root = document.documentElement;
  const themeBtn = $(".theme");
  const setTheme = (t) => {
    root.dataset.theme = t;
    themeBtn.setAttribute("aria-pressed", String(t === "blue"));
    try { localStorage.setItem("tectonica-theme", t); } catch (_) { /* 保存できなくても表示は続ける */ }
    frame.recolor();
  };
  themeBtn.addEventListener("click", () => setTheme(root.dataset.theme === "blue" ? "paper" : "blue"));

  /* ───────────────────── 1. 骨組解析 ───────────────────── */
  const frame = (() => {
    const canvas = $("#frame");
    const ctx = canvas.getContext("2d");

    // 単位：kN, m。3次元の骨組（1節点6自由度）として解く。平面の架構は面外を拘束する
    const E = 2.05e8, G = E / 2.6;
    const P = 100;   // 鉛直集中荷重

    const sec = (A, I) => ({ A, I });
    const SEC = {
      trunk: sec(6.0e-2, 1.6e-3), branch: sec(1.2e-2, 1.5e-4), roof: sec(1.2e-2, 3.0e-4),
      arch: sec(2.4e-2, 6.0e-4), deck: sec(1.2e-2, 2.5e-4), strut: sec(4.0e-3, 2.0e-5),
      core: sec(8.0e-2, 3.0e-3), chord: sec(2.0e-2, 8.0e-4), post: sec(1.6e-2, 6.0e-4),
      col: sec(2.8e-2, 4.0e-4), beam: sec(1.2e-2, 5.0e-4),
      sbeam: sec(1.0e-2, 3.0e-4), cable: sec(2.5e-3, 2.0e-7), tchord: sec(6.0e-3, 2.0e-5), tdiag: sec(3.0e-3, 6.0e-6),
      mast: sec(3.0e-2, 6.0e-4), hang: sec(1.6e-2, 1.2e-4), hpEdge: sec(1.2e-2, 2.5e-4),
      lat: sec(4.0e-3, 1.5e-5), sch: sec(3.0e-3, 6.0e-6), sdi: sec(2.0e-3, 3.0e-6), scol: sec(3.0e-2, 4.0e-4), hp: sec(3.5e-3, 1.2e-5),
    };
    const L2 = (x1, y1, x2, y2) => [[x1, y1, 0], [x2, y2, 0]];

    /* ── 構造モデル ──
     * build(): [点列[x,y,z], 分割長さ, 断面, 載荷できるか]
     * sup: (x,y,z) => "fix" | "pin" | "roller" | null
     * lat: 地震力（x方向） [x, y, z, Q]
     */
    const PRESETS = {
      /* 平面の架構 */
      tree: {
        build() {
          const m = [], keys = [0, 2, 6, 10, 14, 18, 22, 24];
          for (let i = 0; i < keys.length - 1; i++) m.push([L2(keys[i], 7, keys[i + 1], 7), 0.5, SEC.roof, true]);
          [6, 18].forEach((x) => {
            m.push([L2(x, 0, x, 3.2), 0.8, SEC.trunk]);
            [-4, 0, 4].forEach((d) => m.push([L2(x, 3.2, x + d, 7), 0.8, SEC.branch]));
          });
          return m;
        },
        sup: (x, y) => (y === 0 ? "fix" : null),
        axes: [[6, "X1"], [18, "X2"]], levels: [[0, "GL"], [7, "RFL"]], dims: [0, 6, 18, 24],
        lat: [[0, 7, 0, 30], [12, 7, 0, 30], [24, 7, 0, 30]],
      },
      arch: {
        build() {
          const m = [], pts = [];
          for (let x = 0; x <= 32; x += 2) pts.push([x, 7 * (1 - ((x - 16) / 16) ** 2), 0]);
          for (let i = 0; i < pts.length - 1; i++) m.push([[pts[i], pts[i + 1]], 1, SEC.arch]);
          for (let x = 0; x < 32; x += 2) m.push([L2(x, 8.5, x + 2, 8.5), 0.5, SEC.deck, true]);
          pts.forEach(([x, y]) => m.push([L2(x, y, x, 8.5), 9, SEC.strut]));
          return m;
        },
        sup: (x, y) => (y === 0 ? "pin" : null),
        axes: [[0, "A1"], [16, "C"], [32, "A2"]], levels: [[0, "GL"], [8.5, "路面"]], dims: [0, 16, 32],
        lat: [[0, 8.5, 0, 40], [32, 8.5, 0, 40]],
      },
      bstring: {
        build() {
          const m = [], cab = [[0, 8], [6, 6.6], [12, 6.1], [18, 6.6], [24, 8]];
          for (let x = 0; x < 24; x += 6) m.push([L2(x, 8, x + 6, 8), 0.5, SEC.sbeam, true]);
          for (let i = 0; i < cab.length - 1; i++) m.push([L2(...cab[i], ...cab[i + 1]), 6, SEC.cable]);
          [1, 2, 3].forEach((i) => m.push([L2(cab[i][0], cab[i][1], cab[i][0], 8), 2, SEC.strut]));
          [0, 24].forEach((x) => m.push([L2(x, 0, x, 8), 1, SEC.col]));
          return m;
        },
        sup: (x, y) => (y === 0 ? "fix" : null),
        axes: [[0, "X1"], [24, "X2"]], levels: [[0, "GL"], [8, "RFL"]], dims: [0, 6, 12, 18, 24],
        lat: [[0, 8, 0, 40], [24, 8, 0, 40]],
      },
      truss: {
        build() {
          const m = [];
          for (let x = 0; x < 24; x += 3) {
            m.push([L2(x, 6.4, x + 3, 6.4), 3, SEC.tchord, true]);
            m.push([L2(x, 4, x + 3, 4), 3, SEC.tchord]);
            m.push([L2(x, (x / 3) % 2 ? 6.4 : 4, x + 3, (x / 3) % 2 ? 4 : 6.4), 9, SEC.tdiag]);
          }
          for (let x = 3; x < 24; x += 3) m.push([L2(x, 4, x, 6.4), 9, SEC.tdiag]);
          [0, 24].forEach((x) => { m.push([L2(x, 0, x, 4), 1, SEC.col]); m.push([L2(x, 4, x, 6.4), 1.2, SEC.col]); });
          return m;
        },
        sup: (x, y) => (y === 0 ? "fix" : null),
        axes: [[0, "X1"], [24, "X2"]], levels: [[0, "GL"], [6.4, "RFL"]], dims: [0, 24],
        lat: [[0, 6.4, 0, 60]],
      },
      susp: {
        build() {
          const m = [], pts = [];
          for (let x = 0; x <= 30; x += 2) pts.push([x, 10 - 3.2 * (1 - ((x - 15) / 15) ** 2), 0]);
          for (let i = 0; i < pts.length - 1; i++) m.push([[pts[i], pts[i + 1]], 1, SEC.hang, true]);
          [0, 30].forEach((x) => m.push([L2(x, 0, x, 10), 1, SEC.mast]));
          m.push([L2(-7, 0, 0, 10), 12, SEC.cable]);
          m.push([L2(37, 0, 30, 10), 12, SEC.cable]);
          return m;
        },
        sup: (x, y) => (y === 0 ? (x === 0 || x === 30 ? "fix" : "pin") : null),
        axes: [[0, "X1"], [30, "X2"]], levels: [[0, "GL"], [10, "頂部"]], dims: [-7, 0, 15, 30, 37],
        lat: [[0, 10, 0, 40]],
      },
      box: {
        build() {
          const m = [];
          [0, 4].forEach((x) => [[0, 5], [5, 8.6]].forEach(([a, b]) => m.push([L2(x, a, x, b), 1, SEC.core])));
          for (let x = 0; x < 18; x += 2) {
            m.push([L2(x, 8.6, x + 2, 8.6), 0.5, SEC.chord, true]);
            m.push([L2(x, 5, x + 2, 5), 0.5, SEC.chord, true]);
          }
          for (let x = 2; x <= 18; x += 2) if (x !== 4) m.push([L2(x, 5, x, 8.6), 0.9, SEC.post]);
          return m;
        },
        sup: (x, y) => (y === 0 ? "fix" : null),
        axes: [[0, "X1"], [4, "X2"]], levels: [[0, "GL"], [5, "2FL"], [8.6, "RFL"]], dims: [0, 4, 18],
        lat: [[0, 5, 0, 60], [0, 8.6, 0, 60]],
      },
      rahmen: {
        build() {
          const m = [], XS = [0, 6, 13.2, 19.2], LV = [0, 4.2, 7.8];
          for (let s = 0; s < 2; s++) XS.forEach((x) => m.push([L2(x, LV[s], x, LV[s + 1]), 1.05, SEC.col]));
          for (let f = 1; f < 3; f++) for (let b = 0; b < 3; b++) m.push([L2(XS[b], LV[f], XS[b + 1], LV[f]), 0.75, SEC.beam, true]);
          m.push([L2(19.2, 7.8, 21.6, 7.8), 0.8, SEC.beam, true]);
          return m;
        },
        sup: (x, y) => (y === 0 ? "fix" : null),
        axes: [[0, "X1"], [6, "X2"], [13.2, "X3"], [19.2, "X4"]], levels: [[0, "1FL"], [4.2, "2FL"], [7.8, "RFL"]], dims: [0, 6, 13.2, 19.2, 21.6],
        lat: [[0, 4.2, 0, 80], [0, 7.8, 0, 120]],
      },

      /* 空間構造 */
      dome: {
        space: true,
        build() {
          // 単層ラチスドーム：スパン24m・ライズ6m の球面、6分割の三角形網
          const m = [], R = 15, rise = 6, rings = 4, span = 12;
          const cy = rise - R, P3 = (r, a) => [r * Math.cos(a), cy + Math.sqrt(R * R - r * r), r * Math.sin(a)];
          const ring = [[P3(0, 0)]];
          for (let i = 1; i <= rings; i++) {
            const r = span * i / rings, n = 6 * i, row = [];
            for (let j = 0; j < n; j++) row.push(P3(r, (2 * Math.PI * j) / n + (i % 2 ? 0 : Math.PI / (6 * i))));
            ring.push(row);
          }
          const link = (p, q) => m.push([[p, q], 99, SEC.lat, true]);
          for (let i = 1; i <= rings; i++) {
            const row = ring[i], inner = ring[i - 1];
            row.forEach((p, j) => link(p, row[(j + 1) % row.length]));
            if (i === 1) { row.forEach((p) => link(inner[0], p)); continue; }
            // 内側と外側の輪を角度順にジッパーのように三角形でつなぐ
            const ang = (p) => (Math.atan2(p[2], p[0]) + 2 * Math.PI) % (2 * Math.PI);
            const ai = inner.map(ang), ao = row.map(ang);
            const unwrap = (arr, k) => arr[k % arr.length] + 2 * Math.PI * Math.floor(k / arr.length);
            let p = 0, q = 0;
            while (ao[q] < ai[0] - 1e-9) q++;
            const q0 = q;
            link(inner[0], row[q0 % row.length]);
            while (p < inner.length || q < q0 + row.length) {
              const nextIn = p < inner.length ? unwrap(ai, p + 1) : Infinity;
              const nextOut = q < q0 + row.length ? unwrap(ao, q + 1) : Infinity;
              if (nextIn <= nextOut) p++; else q++;
              link(inner[p % inner.length], row[q % row.length]);
            }
          }
          return m;
        },
        sup: (x, y) => (Math.abs(y) < 1e-6 ? "pin" : null),
        lat: (nodes) => nodes.map((n, k) => [k, n.sup ? 0 : 2.5]).filter((a) => a[1]),
        view: 0.5,
      },
      space: {
        space: true,
        build() {
          // 立体トラス：上弦 3m グリッド・せい 1.8m、四隅の柱で支持
          const m = [], s = 3, n = 6, top = 8, bot = 6.2, X = (i) => i * s - (n * s) / 2;
          for (let i = 0; i <= n; i++) for (let j = 0; j < n; j++) {
            m.push([[[X(j), top, X(i)], [X(j + 1), top, X(i)]], 99, SEC.sch, true]);
            m.push([[[X(i), top, X(j)], [X(i), top, X(j + 1)]], 99, SEC.sch, true]);
          }
          const B = (i) => X(i) + s / 2;
          for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            if (j < n - 1) { m.push([[[B(j), bot, B(i)], [B(j + 1), bot, B(i)]], 99, SEC.sch]); m.push([[[B(i), bot, B(j)], [B(i), bot, B(j + 1)]], 99, SEC.sch]); }
            [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([a, b]) => m.push([[[B(j), bot, B(i)], [X(j + a), top, X(i + b)]], 99, SEC.sdi]));
          }
          [[0, 0], [n, 0], [0, n], [n, n]].forEach(([a, b]) => m.push([[[X(a), 0, X(b)], [X(a), top, X(b)]], 2, SEC.scol]));
          return m;
        },
        sup: (x, y) => (Math.abs(y) < 1e-6 ? "fix" : null),
        lat: (nodes) => nodes.map((nd, k) => [k, nd.y === 8 ? 3 : 0]).filter((a) => a[1]),
        view: 0.55,
      },
      hp: {
        space: true,
        build() {
          // HPシェル（ラチス）：z = uv の鞍形、低い2隅で支持
          const m = [], n = 8, h = 16, f = (u, v) => [u * h / 2, 5.5 + 3.6 * u * v, v * h / 2];
          const U = (i) => -1 + (2 * i) / n;
          // 縁梁を先に置く（同じ位置の格子材より優先される）
          [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]].forEach(([a, b, c, d]) => {
            for (let i = 0; i < n; i++) m.push([[f(a + (c - a) * i / n, b + (d - b) * i / n), f(a + (c - a) * (i + 1) / n, b + (d - b) * (i + 1) / n)], 99, SEC.hpEdge, true]);
          });
          for (let i = 0; i <= n; i++) for (let j = 0; j < n; j++) {
            m.push([[f(U(j), U(i)), f(U(j + 1), U(i))], 99, SEC.hp, true]);
            m.push([[f(U(i), U(j)), f(U(i), U(j + 1))], 99, SEC.hp, true]);
            if (i < n) m.push([[f(U(j), U(i)), f(U(j + 1), U(i + 1))], 99, SEC.hp, true]);
          }
          [[1, -1], [-1, 1], [1, 1], [-1, -1]].forEach(([a, b]) => { const t = f(a, b); m.push([[[t[0], 0, t[2]], t], 2, SEC.scol]); });
          return m;
        },
        sup: (x, y) => (Math.abs(y) < 1e-6 ? "fix" : null),
        lat: (nodes) => nodes.map((nd, k) => [k, nd.y > 2 ? 1.5 : 0]).filter((a) => a[1]),
        view: 0.45,
      },
    };

    /* ── モデルを組み立てて、荷重ケースを解いておく ── */
    const kk = (x, y, z) => [x, y, z].map((v) => +v.toFixed(3)).join(",");
    const build = (pre) => {
      const nodes = [], key = new Map(), els = [], seen = new Set();
      const node = (x, y, z) => {
        const k = kk(x, y, z);
        if (!key.has(k)) { key.set(k, nodes.length); nodes.push({ x, y, z, sup: pre.sup(+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)) }); }
        return key.get(k);
      };
      pre.build().forEach(([pts, step, s, load]) => {
        for (let p = 0; p < pts.length - 1; p++) {
          const a = pts[p], b = pts[p + 1];
          const nseg = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
          let prev = node(...a);
          for (let i = 1; i <= nseg; i++) {
            const cur = node(...a.map((v, d) => v + (b[d] - v) * i / nseg));
            const id = Math.min(prev, cur) + "-" + Math.max(prev, cur);
            if (cur !== prev && !seen.has(id)) { seen.add(id); els.push({ i: prev, j: cur, ...s, load: !!load }); }
            prev = cur;
          }
        }
      });
      // 自由度：平面の架構は面外（uz, θx, θy）を拘束
      const dof = []; let n = 0;
      nodes.forEach((nd, k) => {
        const f = [false, false, false, false, false, false];
        if (nd.sup === "fix") f.fill(true);
        if (nd.sup === "pin") f[0] = f[1] = f[2] = true;
        if (nd.sup === "roller") f[1] = f[2] = true;
        if (!pre.space) f[2] = f[3] = f[4] = true;
        dof[k] = f.map((fx) => (fx ? -1 : n++));
      });
      els.forEach((e) => {
        const a = nodes[e.i], b = nodes[e.j];
        const d = [b.x - a.x, b.y - a.y, b.z - a.z], L = Math.hypot(...d), ex = d.map((v) => v / L);
        const ref = Math.abs(ex[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
        const dt = ref[0] * ex[0] + ref[1] * ex[1] + ref[2] * ex[2];
        let ey = ref.map((v, i) => v - dt * ex[i]); const ny = Math.hypot(...ey); ey = ey.map((v) => v / ny);
        const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
        e.L = L; e.R = [ex, ey, ez];
        const EA = E * e.A / L, EI = E * e.I, GJ = G * 2 * e.I / L;
        const a12 = 12 * EI / L ** 3, a6 = 6 * EI / L ** 2, a4 = 4 * EI / L, a2 = 2 * EI / L;
        const k = Array.from({ length: 12 }, () => new Float64Array(12));
        const put = (r, c, v) => { k[r][c] = v; k[c][r] = v; };
        put(0, 0, EA); put(6, 6, EA); put(0, 6, -EA);
        put(3, 3, GJ); put(9, 9, GJ); put(3, 9, -GJ);
        put(1, 1, a12); put(7, 7, a12); put(1, 7, -a12); put(1, 5, a6); put(1, 11, a6); put(5, 7, -a6); put(7, 11, -a6);
        put(5, 5, a4); put(11, 11, a4); put(5, 11, a2);
        put(2, 2, a12); put(8, 8, a12); put(2, 8, -a12); put(2, 4, -a6); put(2, 10, -a6); put(4, 8, a6); put(8, 10, a6);
        put(4, 4, a4); put(10, 10, a4); put(4, 10, a2);
        e.k = k; e.map = [...dof[e.i], ...dof[e.j]];
      });
      const toLocal = (e, g) => {
        const out = new Float64Array(12);
        for (let b = 0; b < 4; b++) for (let r = 0; r < 3; r++) out[b * 3 + r] = e.R[r][0] * g[b * 3] + e.R[r][1] * g[b * 3 + 1] + e.R[r][2] * g[b * 3 + 2];
        return out;
      };

      // 全体剛性マトリクス（K = Tᵀ k T）
      const K = new Float64Array(n * n);
      els.forEach((e) => {
        const T = Array.from({ length: 12 }, () => new Float64Array(12));
        for (let b = 0; b < 4; b++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[b * 3 + r][b * 3 + c] = e.R[r][c];
        const kT = Array.from({ length: 12 }, (_, r) => { const row = new Float64Array(12); for (let c = 0; c < 12; c++) { let v = 0; for (let t = 0; t < 12; t++) v += e.k[r][t] * T[t][c]; row[c] = v; } return row; });
        for (let p = 0; p < 12; p++) {
          const P_ = e.map[p]; if (P_ < 0) continue;
          for (let q = 0; q < 12; q++) {
            const Q_ = e.map[q]; if (Q_ < 0) continue;
            let v = 0; for (let r = 0; r < 12; r++) v += T[r][p] * kT[r][q];
            K[P_ * n + Q_] += v;
          }
        }
      });
      // LU分解（部分ピボット）を一度だけ行い、荷重ごとに前進・後退代入
      const piv = new Int32Array(n);
      for (let k = 0; k < n; k++) {
        let m = k, mv = Math.abs(K[k * n + k]);
        for (let i = k + 1; i < n; i++) { const v = Math.abs(K[i * n + k]); if (v > mv) { mv = v; m = i; } }
        piv[k] = m;
        if (m !== k) for (let j = 0; j < n; j++) { const t = K[k * n + j]; K[k * n + j] = K[m * n + j]; K[m * n + j] = t; }
        const d = K[k * n + k];
        for (let i = k + 1; i < n; i++) {
          const f = (K[i * n + k] /= d);
          if (f) for (let j = k + 1; j < n; j++) K[i * n + j] -= f * K[k * n + j];
        }
      }
      const solve = (F) => {
        const x = Float64Array.from(F);
        for (let k = 0; k < n; k++) { const m = piv[k]; if (m !== k) { const t = x[k]; x[k] = x[m]; x[m] = t; } }
        for (let i = 0; i < n; i++) { let s = x[i]; for (let j = 0; j < i; j++) s -= K[i * n + j] * x[j]; x[i] = s; }
        for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let j = i + 1; j < n; j++) s -= K[i * n + j] * x[j]; x[i] = s / K[i * n + i]; }
        return x;
      };

      const md = { pre, nodes, key, els, dof, n, toLocal, space: !!pre.space };
      md.loadNodes = [...new Set(els.filter((e) => e.load).flatMap((e) => [e.i, e.j]))].filter((k) => !nodes[k].sup);
      if (md.space) {
        md.demoNodes = md.loadNodes.slice().sort((a, b) => nodes[a].x - nodes[b].x || nodes[a].z - nodes[b].z);
        const cz = md.demoNodes.map((k) => nodes[k].z), zm = (Math.min(...cz) + Math.max(...cz)) / 2;
        const near = md.demoNodes.filter((k) => Math.abs(nodes[k].z - zm) < 2.1);
        md.demoNodes = near.length > 3 ? near : md.demoNodes;
      } else {
        const topY = Math.max(...md.loadNodes.map((k) => nodes[k].y));
        md.demoNodes = md.loadNodes.filter((k) => nodes[k].y === topY).sort((a, b) => nodes[a].x - nodes[b].x);
      }
      md.vCase = new Map();
      md.loadNodes.forEach((k) => { const F = new Float64Array(n); F[dof[k][1]] = -P; md.vCase.set(k, solve(F)); });
      const F = new Float64Array(n);
      const lat = typeof pre.lat === "function" ? pre.lat(nodes) : pre.lat.map(([x, y, z, q]) => [key.get(kk(x, y, z)), q]);
      lat.forEach(([k, q]) => { if (dof[k][0] >= 0) F[dof[k][0]] += q; });
      md.lat = lat; md.Qsum = Math.round(lat.reduce((s, l) => s + l[1], 0));
      md.hCase = solve(F);
      // 表示スケールの基準（荷重位置で図の大きさが変わるよう、モデルとケースごとに固定）
      md.ref = { v: { M: 0, Q: 0, N: 0, d: 0 }, h: peaks(md, md.hCase) };
      md.vCase.forEach((u) => { const p = peaks(md, u); for (const k in p) md.ref.v[k] = Math.max(md.ref.v[k], p[k]); });
      const xs = nodes.map((nd) => nd.x), ys = nodes.map((nd) => nd.y), zs = nodes.map((nd) => nd.z);
      md.box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: Math.min(...zs), z1: Math.max(...zs) };
      md.c = [(md.box.x0 + md.box.x1) / 2, (md.box.y0 + md.box.y1) / 2, (md.box.z0 + md.box.z1) / 2];
      md.rad = Math.max(...nodes.map((nd) => Math.hypot(nd.x - md.c[0], nd.y - md.c[1], nd.z - md.c[2])));
      return md;
    };

    // 部材の応力（局所座標）。Mi, Mj は局所 z 軸まわり（平面の架構で使う）、Mmax は合成
    function forces(md, u, e) {
      const g = e.map.map((d) => (d < 0 ? 0 : u[d]));
      const ul = md.toLocal(e, g), f = new Float64Array(12);
      for (let r = 0; r < 12; r++) { let s = 0; for (let t = 0; t < 12; t++) s += e.k[r][t] * ul[t]; f[r] = s; }
      return {
        N: -f[0], Q: md.space ? Math.hypot(f[1], f[2]) : f[1], Mi: -f[5], Mj: f[11],
        Mmax: Math.max(Math.hypot(f[4], f[5]), Math.hypot(f[10], f[11])),
      };
    }
    function peaks(md, u) {
      let M = 0, Q = 0, N = 0, d = 0;
      md.els.forEach((e) => {
        const r = forces(md, u, e);
        M = Math.max(M, r.Mmax); Q = Math.max(Q, Math.abs(r.Q)); N = Math.max(N, Math.abs(r.N));
      });
      md.nodes.forEach((nd, k) => { const [a, b, c] = md.dof[k]; d = Math.max(d, Math.hypot(a < 0 ? 0 : u[a], b < 0 ? 0 : u[b], c < 0 ? 0 : u[c])); });
      return { M, Q, N, d };
    }

    const PITCH = 0.5;
    const models = {};
    const getModel = (id) => (models[id] ||= build(PRESETS[id]));

    /* ── 状態 ── */
    const st = {
      md: null, id: "tree", load: "v", dia: "M", target: 0, hover: false, t0: performance.now(),
      u: null, visible: true, W: 0, H: 0, dpr: 1, k: 1, ox: 0, oy: 0, col: {}, yaw: 0.6, yawT: performance.now(),
    };
    const setModel = (id) => {
      st.id = id; st.md = getModel(id);
      st.u = new Float64Array(st.md.n);
      st.target = st.md.demoNodes[Math.floor(st.md.demoNodes.length * 0.3)];
      st.t0 = performance.now();
      document.querySelectorAll("[data-model]").forEach((b) => b.classList.toggle("on", b.dataset.model === id));
      resize();
      if (reduceMotion) still();
    };

    const recolor = () => {
      st.col = { ink: css("--ink"), ink2: css("--ink-2"), ink3: css("--ink-3"), line: css("--line"), acc: css("--acc"), accSoft: css("--acc-soft"), blue: css("--blue"), paper: css("--paper") };
      if (reduceMotion && st.md) draw(performance.now());
    };

    function resize() {
      if (!st.md) return;
      const r = canvas.getBoundingClientRect();
      st.dpr = Math.min(window.devicePixelRatio || 1, 2);
      st.W = r.width; st.H = r.height;
      canvas.width = Math.round(r.width * st.dpr); canvas.height = Math.round(r.height * st.dpr);
      const small = r.width < 520;
      if (st.md.space) {
        const span = Math.cos(PITCH) + Math.sin(PITCH);
        st.k = Math.min((r.width * 0.86) / (2 * st.md.rad), (r.height * 0.8) / (span * 2 * st.md.rad) * 1.25);
        st.ox = r.width / 2; st.oy = r.height * 0.5;
      } else {
        const pl = small ? 22 : 48, pr = small ? 42 : 66, pt = small ? 64 : 84, pb = small ? 46 : 58;
        const { x0, x1, y0, y1 } = st.md.box, wx = x1 - x0, wy = y1 - y0;
        st.k = Math.min((r.width - pl - pr) / wx, (r.height - pt - pb) / wy);
        st.ox = pl + ((r.width - pl - pr) - wx * st.k) / 2 - x0 * st.k;
        st.oy = r.height - pb - ((r.height - pt - pb) - wy * st.k) / 2 + y0 * st.k;
      }
      if (reduceMotion) draw(performance.now());
    }
    // 投影：平面は正面図、空間は回転させた平行投影
    const proj = (x, y, z) => {
      if (!st.md.space) return [st.ox + x * st.k, st.oy - y * st.k, 0];
      const [cx, cy, cz] = st.md.c, X = x - cx, Y = y - cy, Z = z - cz;
      const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
      const px = X * c - Z * s, d = X * s + Z * c;
      return [st.ox + px * st.k, st.oy - (Y * Math.cos(PITCH) + d * Math.sin(PITCH)) * st.k, d];
    };
    const still = () => { st.u = Float64Array.from(st.load === "v" ? st.md.vCase.get(st.target) : st.md.hCase); draw(performance.now()); };

    // 入力：一番近い載荷点に荷重を移す
    const pick = (ev) => {
      const r = canvas.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top, { nodes } = st.md;
      let best = st.target, bd = Infinity;
      st.md.loadNodes.forEach((k) => {
        const [X, Y] = proj(nodes[k].x, nodes[k].y, nodes[k].z);
        const d = (X - px) ** 2 + ((Y - py) * (st.md.space ? 1 : 1.6)) ** 2;
        if (d < bd) { bd = d; best = k; }
      });
      st.target = best; st.hover = true;
      if (st.load !== "v") setLoad("v");
      if (reduceMotion) still();
    };
    canvas.addEventListener("pointermove", pick);
    canvas.addEventListener("pointerdown", pick);
    canvas.addEventListener("pointerleave", () => { st.hover = false; st.t0 = performance.now(); });

    const setLoad = (l) => {
      st.load = l;
      document.querySelectorAll("[data-load]").forEach((b) => b.classList.toggle("on", b.dataset.load === l));
      if (reduceMotion) still();
    };
    document.querySelectorAll("[data-load]").forEach((b) => b.addEventListener("click", () => setLoad(b.dataset.load)));
    document.querySelectorAll("[data-model]").forEach((b) => b.addEventListener("click", () => setModel(b.dataset.model)));
    document.querySelectorAll("[data-dia]").forEach((b) => b.addEventListener("click", () => {
      st.dia = b.dataset.dia;
      document.querySelectorAll("[data-dia]").forEach((x) => x.classList.toggle("on", x === b));
      if (reduceMotion) draw(performance.now());
    }));

    // 目標の変位（時間で動かす：自動デモ・地震の揺れ）
    const targetU = (t) => {
      const md = st.md;
      if (st.load === "h") return { u: md.hCase, s: reduceMotion ? 1 : Math.sin((t - st.t0) / 1000 * Math.PI * 1.25) };
      if (!st.hover && !reduceMotion) {
        const ph = ((t - st.t0) / 7000) % 2, f = ph < 1 ? ph : 2 - ph;
        st.target = md.demoNodes[Math.round(f * f * (3 - 2 * f) * (md.demoNodes.length - 1))];
      }
      return { u: md.vCase.get(st.target), s: 1 };
    };

    const fmt = (v, d = 1) => v.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d });
    const where = (nd) => {
      if (st.md.space) return `(${fmt(nd.x)}, ${fmt(nd.z)}) m`;
      const ax = st.md.pre.axes.find(([x]) => Math.abs(x - nd.x) < 1e-6);
      const lv = st.md.pre.levels.find(([y]) => Math.abs(y - nd.y) < 1e-6);
      return `${ax ? ax[1] : `x=${fmt(nd.x)}m`}${lv ? " " + lv[1] : ""}`;
    };
    const ro = { load: $("#ro-load"), m: $("#ro-m"), d: $("#ro-d"), s: $("#ro-s") };
    let roLast = "";

    const arrow = (ax, ay, bx, by) => {
      const ang = Math.atan2(by - ay, bx - ax);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by);
      ctx.lineTo(bx - 9 * Math.cos(ang - 0.4), by - 9 * Math.sin(ang - 0.4));
      ctx.lineTo(bx - 9 * Math.cos(ang + 0.4), by - 9 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill();
    };

    function draw(t) {
      const { col, dpr, md } = st;
      const { u: tu, s } = targetU(t);
      // ばねのように追従させる
      const a = reduceMotion ? 1 : 0.18;
      for (let i = 0; i < md.n; i++) st.u[i] += (tu[i] * s - st.u[i]) * a;
      if (md.space && !st.hover && !reduceMotion) st.yaw += (t - st.yawT) * 0.00012;
      st.yawT = t;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, st.W, st.H);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const res = md.space ? draw3(t, s) : draw2(t, s);

      // 数値表示（実際の値）
      const pk = peaks(md, st.load === "v" ? md.vCase.get(st.target) : md.hCase);
      const roTxt = [res.loadTxt, `${fmt(pk.M)} kN·m`, `${fmt(pk.d * 1000, 2)} mm`, `変形 ×${Math.round(res.amp)}`];
      const joined = roTxt.join("|");
      if (joined !== roLast) { roLast = joined; ro.load.textContent = roTxt[0]; ro.m.textContent = roTxt[1]; ro.d.textContent = roTxt[2]; ro.s.textContent = roTxt[3]; }
    }

    const disp = (k, amp) => {
      const [a1, b1, c1] = st.md.dof[k], u = st.u;
      return [a1 < 0 ? 0 : u[a1] * amp, b1 < 0 ? 0 : u[b1] * amp, c1 < 0 ? 0 : u[c1] * amp];
    };

    /* 平面の架構：正面図に応力図を重ねる */
    function draw2(t, s) {
      const { col, md } = st;
      const { nodes, els, pre } = md;
      const u = st.u, R = md.ref[st.load], { x0, x1, y1 } = md.box, span = x1 - x0;
      const small = st.W < 520;
      const sx = (x) => st.ox + x * st.k, sy = (y) => st.oy - y * st.k;

      // 通り芯（一点鎖線）と符号
      ctx.font = `500 ${small ? 9 : 11}px "IBM Plex Mono", monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeStyle = col.line; ctx.lineWidth = 1;
      ctx.setLineDash([14, 4, 2, 4]);
      const topY = sy(y1) - (small ? 34 : 46), br = small ? 9 : 11;
      pre.axes.forEach(([x]) => { ctx.beginPath(); ctx.moveTo(sx(x), topY + br); ctx.lineTo(sx(x), st.oy + 8); ctx.stroke(); });
      pre.levels.forEach(([y]) => { ctx.beginPath(); ctx.moveTo(sx(x0) - 14, sy(y)); ctx.lineTo(sx(x1) + 18, sy(y)); ctx.stroke(); });
      ctx.setLineDash([]);
      pre.axes.forEach(([x, name]) => {
        ctx.beginPath(); ctx.arc(sx(x), topY, br, 0, Math.PI * 2);
        ctx.fillStyle = col.paper; ctx.fill(); ctx.strokeStyle = col.ink; ctx.stroke();
        ctx.fillStyle = col.ink; ctx.fillText(name, sx(x), topY + 0.5);
      });
      ctx.textAlign = "left"; ctx.fillStyle = col.ink3;
      pre.levels.forEach(([y, name]) => ctx.fillText(name, sx(x1) + 22, sy(y) - (y === 0 ? 0 : 7)));

      // 寸法線
      const dimY = st.oy + (small ? 26 : 32);
      ctx.strokeStyle = col.ink3; ctx.fillStyle = col.ink2; ctx.textAlign = "center";
      const dims = pre.dims;
      ctx.beginPath(); ctx.moveTo(sx(dims[0]), dimY); ctx.lineTo(sx(dims[dims.length - 1]), dimY); ctx.stroke();
      dims.forEach((x, i) => {
        ctx.beginPath(); ctx.moveTo(sx(x) - 4, dimY + 4); ctx.lineTo(sx(x) + 4, dimY - 4); ctx.stroke();
        if (i) ctx.fillText(Math.round((x - dims[i - 1]) * 1000).toLocaleString("en-US"), (sx(x) + sx(dims[i - 1])) / 2, dimY - 9);
      });

      // 支点（固定端はハッチ、ピンは三角）
      ctx.strokeStyle = col.ink; ctx.lineWidth = 1;
      nodes.forEach((nd) => {
        if (!nd.sup) return;
        const X = sx(nd.x), Y = sy(nd.y);
        if (nd.sup !== "fix") {
          ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - 8, Y + 12); ctx.lineTo(X + 8, Y + 12); ctx.closePath(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(X - 12, Y + 12); ctx.lineTo(X + 12, Y + 12); ctx.stroke();
          return;
        }
        ctx.beginPath(); ctx.moveTo(X - 12, Y); ctx.lineTo(X + 12, Y); ctx.stroke();
        for (let h = -10; h <= 10; h += 5) { ctx.beginPath(); ctx.moveTo(X + h, Y); ctx.lineTo(X + h - 5, Y + 6); ctx.stroke(); }
      });

      // 元の形（細線）
      ctx.strokeStyle = col.line; ctx.lineWidth = 2;
      els.forEach((e) => { ctx.beginPath(); ctx.moveTo(sx(nodes[e.i].x), sy(nodes[e.i].y)); ctx.lineTo(sx(nodes[e.j].x), sy(nodes[e.j].y)); ctx.stroke(); });

      // 応力図（引張側に描く）
      const refV = R[st.dia] || 1;
      const sc = (st.dia === "M" ? 0.13 : 0.08) * span / refV;
      let peak = { v: 0 };
      ctx.fillStyle = col.accSoft; ctx.strokeStyle = col.acc; ctx.lineWidth = 1.3;
      els.forEach((e) => {
        const r = forces(md, u, e), A = nodes[e.i], B = nodes[e.j];
        const nx = e.R[1][0], ny = e.R[1][1];
        let vi, vj, sign;
        if (st.dia === "M") { vi = r.Mi; vj = r.Mj; sign = -1; } else if (st.dia === "Q") { vi = vj = r.Q; sign = 1; } else { vi = vj = r.N; sign = 1; }
        const pi = { x: A.x + sign * nx * vi * sc, y: A.y + sign * ny * vi * sc };
        const pj = { x: B.x + sign * nx * vj * sc, y: B.y + sign * ny * vj * sc };
        ctx.beginPath();
        ctx.moveTo(sx(A.x), sy(A.y)); ctx.lineTo(sx(pi.x), sy(pi.y)); ctx.lineTo(sx(pj.x), sy(pj.y)); ctx.lineTo(sx(B.x), sy(B.y));
        ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(sx(pi.x), sy(pi.y)); ctx.lineTo(sx(pj.x), sy(pj.y)); ctx.stroke();
        [[vi, pi], [vj, pj]].forEach(([v, p]) => {
          if (Math.abs(v) > Math.abs(peak.v)) { const g = Math.sign(sign * v) || 1; peak = { v, x: p.x, y: p.y, dx: nx * g, dy: ny * g }; }
        });
      });

      // 変形（倍率をかけて誇張表示）
      const amp = (0.05 * span) / (R.d || 1);
      ctx.strokeStyle = col.ink; ctx.lineWidth = 2.4;
      els.forEach((e) => {
        const A = nodes[e.i], B = nodes[e.j], da = disp(e.i, amp), db = disp(e.j, amp);
        ctx.beginPath(); ctx.moveTo(sx(A.x + da[0]), sy(A.y + da[1])); ctx.lineTo(sx(B.x + db[0]), sy(B.y + db[1])); ctx.stroke();
      });

      // 最大値のラベル
      if (Math.abs(peak.v) > refV * 0.02) {
        const txt = `${st.dia}=${fmt(Math.abs(peak.v))}${st.dia === "M" ? "kN·m" : "kN"}`;
        ctx.font = `600 ${small ? 10 : 11.5}px "IBM Plex Mono", monospace`;
        const tw = ctx.measureText(txt).width + 10;
        const X = Math.min(Math.max(sx(peak.x) + peak.dx * (tw / 2 + 4), tw / 2 + 2), st.W - tw / 2 - 2);
        const Y = Math.min(sy(peak.y) - peak.dy * 14, st.oy - 12);
        ctx.fillStyle = col.paper; ctx.fillRect(X - tw / 2, Y - 9, tw, 18);
        ctx.fillStyle = col.acc; ctx.textAlign = "center"; ctx.fillText(txt, X, Y);
      }

      // 荷重の矢印
      ctx.strokeStyle = col.acc; ctx.fillStyle = col.acc; ctx.lineWidth = 2.2;
      ctx.font = `600 ${small ? 10 : 12}px "IBM Plex Mono", monospace`;
      let loadTxt;
      if (st.load === "v") {
        const nd = nodes[st.target], d = disp(st.target, amp), X = sx(nd.x + d[0]), Y = sy(nd.y + d[1]) - 4;
        arrow(X, Y - 46, X, Y);
        ctx.textAlign = "center"; ctx.fillText(`P=${P}kN`, X, Y - 56);
        loadTxt = `P=${P}kN @ ${where(nd)}`;
      } else {
        const qmax = Math.max(...md.lat.map((l) => l[1]));
        md.lat.forEach(([k, q]) => {
          const nd = nodes[k], d = disp(k, amp), X = sx(nd.x + d[0]), Y = sy(nd.y + d[1]);
          const len = (18 + 26 * q / qmax) * (Math.sign(s) || 1);
          arrow(X - len, Y, X - Math.sign(len) * 4, Y);
        });
        loadTxt = `Q=${md.Qsum}kN（水平）`;
      }
      return { loadTxt, amp };
    }

    /* 空間構造：回転する立体図。部材を応力で色分けする */
    function draw3(t, s) {
      const { col, md } = st;
      const { nodes, els } = md;
      const u = st.u, R = md.ref[st.load], small = st.W < 520;
      const amp = (0.06 * md.rad) / (R.d || 1);
      const refV = R[st.dia] || 1;

      // 地面のグリッド
      ctx.strokeStyle = col.line; ctx.lineWidth = 1;
      const g = Math.ceil(md.rad / 3) * 3;
      for (let v = -g; v <= g; v += 3) {
        let a = proj(md.c[0] - g, 0, md.c[2] + v), b = proj(md.c[0] + g, 0, md.c[2] + v);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        a = proj(md.c[0] + v, 0, md.c[2] - g); b = proj(md.c[0] + v, 0, md.c[2] + g);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }

      // 部材（奥から順に描く）
      const list = els.map((e) => {
        const A = nodes[e.i], B = nodes[e.j], da = disp(e.i, amp), db = disp(e.j, amp);
        const pa = proj(A.x + da[0], A.y + da[1], A.z + da[2]), pb = proj(B.x + db[0], B.y + db[1], B.z + db[2]);
        const r = forces(md, u, e), v = st.dia === "M" ? r.Mmax : st.dia === "Q" ? Math.abs(r.Q) : r.N;
        return { e, pa, pb, v, d: (pa[2] + pb[2]) / 2 };
      }).sort((a, b) => b.d - a.d);
      const dmax = md.rad;
      let peak = null;
      list.forEach(({ pa, pb, v, d }) => {
        const f = Math.min(1, Math.abs(v) / refV);
        const fade = 0.55 + 0.45 * (1 - (d + dmax) / (2 * dmax));
        ctx.globalAlpha = fade;
        ctx.strokeStyle = col.line; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
        if (f > 0.02) {
          ctx.globalAlpha = fade * (0.25 + 0.75 * f);
          ctx.strokeStyle = st.dia === "N" && v < 0 ? col.blue : col.acc;
          ctx.lineWidth = 1 + 3.2 * f;
          ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
        }
        if (!peak || Math.abs(v) > Math.abs(peak.v)) peak = { v, x: (pa[0] + pb[0]) / 2, y: (pa[1] + pb[1]) / 2 };
      });
      ctx.globalAlpha = 1;

      // 支点
      ctx.strokeStyle = col.ink; ctx.lineWidth = 1;
      nodes.forEach((nd) => {
        if (!nd.sup) return;
        const [X, Y] = proj(nd.x, nd.y, nd.z);
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - 5, Y + 8); ctx.lineTo(X + 5, Y + 8); ctx.closePath(); ctx.stroke();
      });

      // 最大値のラベル
      ctx.font = `600 ${small ? 10 : 11.5}px "IBM Plex Mono", monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (peak && Math.abs(peak.v) > refV * 0.02) {
        const txt = `${st.dia}=${fmt(Math.abs(peak.v))}${st.dia === "M" ? "kN·m" : "kN"}`;
        const tw = ctx.measureText(txt).width + 10, X = Math.min(Math.max(peak.x, tw / 2 + 2), st.W - tw / 2 - 2), Y = peak.y - 16;
        ctx.fillStyle = col.paper; ctx.fillRect(X - tw / 2, Y - 9, tw, 18);
        ctx.fillStyle = col.acc; ctx.fillText(txt, X, Y);
      }

      // 凡例
      ctx.font = `500 ${small ? 9 : 10.5}px "IBM Plex Mono", monospace`; ctx.textAlign = "left";
      const lg = st.dia === "N" ? [[col.acc, "引張"], [col.blue, "圧縮"]] : [[col.acc, st.dia === "M" ? "曲げモーメントの大きさ" : "せん断力の大きさ"]];
      lg.forEach(([c, l], i) => {
        const y = st.H - 16 - i * 16;
        ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(34, y); ctx.stroke();
        ctx.fillStyle = col.ink2; ctx.fillText(l, 40, y);
      });
      ctx.textAlign = "right"; ctx.fillStyle = col.ink3;
      ctx.fillText(st.hover ? "荷重を移動中" : "ゆっくり回転中・カーソルで載荷", st.W - 12, st.H - 16);

      // 荷重の矢印
      ctx.strokeStyle = col.acc; ctx.fillStyle = col.acc; ctx.lineWidth = 2.2; ctx.textAlign = "center";
      ctx.font = `600 ${small ? 10 : 12}px "IBM Plex Mono", monospace`;
      let loadTxt;
      if (st.load === "v") {
        const nd = nodes[st.target], d = disp(st.target, amp), [X, Y] = proj(nd.x + d[0], nd.y + d[1], nd.z + d[2]);
        arrow(X, Y - 46, X, Y - 4);
        ctx.fillText(`P=${P}kN`, X, Y - 56);
        loadTxt = `P=${P}kN @ ${where(nd)}`;
      } else {
        const ex = proj(md.c[0] + 1, md.c[1], md.c[2]), e0 = proj(md.c[0], md.c[1], md.c[2]);
        const dx = ex[0] - e0[0], dy = ex[1] - e0[1], dl = Math.hypot(dx, dy) || 1, sg = Math.sign(s) || 1;
        const tips = md.lat.filter((_, i) => i % Math.max(1, Math.floor(md.lat.length / 6)) === 0);
        tips.forEach(([k]) => {
          const nd = nodes[k], d = disp(k, amp), [X, Y] = proj(nd.x + d[0], nd.y + d[1], nd.z + d[2]);
          arrow(X - (dx / dl) * 34 * sg, Y - (dy / dl) * 34 * sg, X - (dx / dl) * 4 * sg, Y - (dy / dl) * 4 * sg);
        });
        loadTxt = `Q=${md.Qsum}kN（水平）`;
      }
      return { loadTxt, amp };
    }

    const loop = (t) => { if (st.visible && st.md) draw(t); requestAnimationFrame(loop); };
    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver(([en]) => { st.visible = en.isIntersecting; }).observe(canvas);
    recolor();
    setModel("tree");
    if (!reduceMotion) requestAnimationFrame(loop);
    document.fonts && document.fonts.ready.then(() => reduceMotion && draw(performance.now()));
    return { recolor };
  })();

  try { const t = localStorage.getItem("tectonica-theme"); if (t === "blue") setTheme("blue"); } catch (_) { /* 何もしない */ }

  /* ───────────────────── 2. 作品 ───────────────────── */
  // 各作品：写真のあとに、その案件の実際のスケッチ・検討図を横に並べる
  const P = (src, cap) => ({ src: `img/${src}.jpg`, cap, kind: "photo" });
  const S = (src, cap, tag = "SKETCH") => ({ src: `img/draw/${src}.jpg`, cap, kind: "draw", tag });
  const WORKS = [
    { no: "0338", t: "花重リノベーション", by: "マル・アーキテクチャ／東京藝術大学", loc: "東京都台東区", aw: ["日本建築学会作品選奨 2025", "東京建築賞 最優秀賞", "AACA賞2024 優秀賞", "グッドデザイン賞2024"], credit: "Photo: Takuya Seki", cls: "wide", dim: "RENOVATION / WOOD",
      slides: [P("hanaju-1"), P("hanaju-2"), S("hanaju-node", "鉄骨の接合部", "DETAIL"), S("hanaju-print", "接合部の初期案（3Dプリント模型）", "MODEL"), S("hanaju-print2", "柱・梁受け・梁を組み合わせた模型", "MODEL")] },
    { no: "0336", t: "Karuizawa Commongrounds", by: "Klein Dytham architecture", loc: "長野県軽井沢町", aw: ["WAF 2023 Small Project of the Year"], cls: "narrow", dim: "KARUIZAWA",
      slides: [P("kcg-1"), P("kcg-2"), S("kcg-model", "初期検討の解析モデル（3D）", "MODEL"), S("kcg-plan", "耐震要素の配置計画（手書きの検討）")] },
    { no: "0312", t: "神奈川歯科大学 キャンパスセンター", by: "アトリエMEME", loc: "神奈川県横須賀市", aw: ["The Architecture MasterPrize 2024", "神奈川建築コンクール2025 優秀賞", "Tecture Award 2024"], cls: "narrow", dim: "YOKOSUKA",
      slides: [P("kdu-1"), P("kdu-2")] },
    { no: "0408", t: "東京藝術大学 芸術未来研究場 本部", by: "MARU。architecture", loc: "東京都台東区", pub: "新建築 2025年4月号／GA JAPAN 189・191", credit: "Photo: Takuya Seki", cls: "wide", dim: "UENO",
      slides: [P("geidai-1"), P("geidai-2"), S("geidai-sketch", "改修部の詳細スケッチ（新設壁・既存躯体）"), S("geidai-mullion", "マリオンの変形図", "STUDY")] },
    { no: "0412", t: "ハニヤスの家 — HANIYASU HOUSE", by: "AATISMO", loc: "神奈川県", aw: ["FRAME 2026 monthly award"], pub: "GA HOUSES 204／住宅特集 2026年2月号", cls: "wide", dim: "2025",
      slides: [P("haniyasu-1"), P("haniyasu-2"), S("haniyasu-sketch", "構造打合せのスケッチ（曲面の架構と足元）"), S("haniyasu-memo", "打合せメモ", "MEMO")] },
    { no: "0337", t: "古川製作所 新社屋＋工場", by: "スキーマ建築計画", pub: "新建築 2025年1月号／GA JAPAN 190", cls: "narrow", dim: "OFFICE + FACTORY",
      slides: [P("furukawa-1"), P("furukawa-2"), S("furukawa-frame", "鉄骨の伏図", "DRAWING")] },
    { no: "0500", t: "HOAM", by: "山田紗子建築設計事務所", loc: "2026", cls: "full", dim: "PAVILION",
      slides: [P("process/09-0829-dusk"), P("process/08-0829"), S("hoam-sketch", "最初のスケッチ：マストで重さ（weight）を吊る"), S("hoam-model", "解析モデル：ステンレスのマストとFRPのシェル", "MODEL"), S("hoam-study", "マスト断面の比較検討（M図・変形）", "STUDY")] },
  ];
  const MINI = [
    { t: "daita2019", by: "山田紗子建築設計事務所", em: "第36回 吉岡賞・住宅建築賞2020" },
    { t: "森の段床", by: "SUGAWARADAISUKE", em: "第45回 東京建築賞 最優秀賞" },
    { t: "やま仙（ウガンダ）", by: "TERRAIN architects", em: "グッドデザイン賞2020 金賞" },
    { t: "大阪・関西万博 休憩所3", by: "山田紗子建築設計事務所", em: "新建築 2025年12月号" },
  ];
  $("#works-grid").innerHTML = WORKS.map((w) => {
    const nDraw = w.slides.filter((s) => s.kind === "draw").length;
    return `
    <article class="work ${w.cls} rv">
      <div class="strip-wrap">
        <div class="strip" tabindex="0" aria-label="${esc(w.t)} の写真とスケッチ">
          ${w.slides.map((s, i) => `<figure class="slide ${s.kind}"><img src="${s.src}" alt="${esc(w.t)}${s.cap ? "：" + esc(s.cap) : ""}" loading="lazy">${s.cap ? `<figcaption><i>${s.tag || "PHOTO"}</i>${esc(s.cap)}</figcaption>` : ""}</figure>`).join("")}
        </div>
        <span class="dim">← ${esc(w.dim)} →</span>
        ${w.slides.length > 1 ? `<div class="pager"><button type="button" class="prev" aria-label="前へ">←</button><span class="cnt">1 / ${w.slides.length}</span><button type="button" class="next" aria-label="次へ">→</button></div>` : ""}
        ${nDraw ? `<span class="hintx">→ スケッチ・検討図 ${nDraw}</span>` : ""}
      </div>
      <div class="meta">
        <span class="no">${w.no}</span>
        <h3>${esc(w.t)}</h3>
        <p class="by">意匠設計：${esc(w.by)}${w.loc ? `　／　${esc(w.loc)}` : ""}</p>
        <div>
          ${w.aw ? `<ul class="aw">${w.aw.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
          ${w.pub ? `<p class="by">掲載：${esc(w.pub)}</p>` : ""}
          ${w.credit ? `<p class="credit">${esc(w.credit)}</p>` : ""}
        </div>
      </div>
    </article>`;
  }).join("") +
    `<div class="mini rv">${MINI.map((m) => `<div><b>${esc(m.t)}</b><span>${esc(m.by)}</span><em>${esc(m.em)}</em></div>`).join("")}</div>`;


  document.querySelectorAll(".strip-wrap").forEach((wrap) => {
    const strip = wrap.querySelector(".strip"), cnt = wrap.querySelector(".cnt"), n = strip.children.length;
    const idx = () => Math.round(strip.scrollLeft / strip.clientWidth);
    const go = (i) => strip.scrollTo({ left: Math.max(0, Math.min(n - 1, i)) * strip.clientWidth, behavior: reduceMotion ? "auto" : "smooth" });
    wrap.querySelector(".prev")?.addEventListener("click", () => go(idx() - 1));
    wrap.querySelector(".next")?.addEventListener("click", () => go(idx() + 1));
    strip.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { go(idx() + 1); e.preventDefault(); }
      if (e.key === "ArrowLeft") { go(idx() - 1); e.preventDefault(); }
    });
    strip.addEventListener("scroll", () => {
      const i = idx();
      if (cnt) cnt.textContent = `${i + 1} / ${n}`;
      wrap.classList.toggle("on-draw", strip.children[i]?.classList.contains("draw"));
      wrap.classList.toggle("moved", i > 0);
    }, { passive: true });
  });

  /* ───────────────────── 2b. 建方の記録（工程表で写真を送る） ───────────────────── */
  (() => {
    const STEPS = [
      ["01-0813-mast", 13, "マスト建方", "湾曲したマストが自立。根元のコーンから先端の吊り点まで、一本の曲線でつながる。"],
      ["02-0813-shell", 13, "シェル取付開始", "吊り点まわりからシェルのピースを取り付けはじめる。"],
      ["03-0820", 20, "シェル取付", "仮設の架台で受けながら、シェルを少しずつ閉じていく。"],
      ["04-0820-up", 20, "シェル取付", "下から見上げる。マストの曲線とシェルの縁が近づいていく。"],
      ["05-0821", 21, "シェル閉合", "半球が閉じた。高所作業車で仕上げを進める。"],
      ["06-0823", 23, "仮設撤去", "架台を外し、シェルがマストだけで吊られた状態になる。"],
      ["07-0823-wide", 23, "仮設撤去", "林の向こうから。周囲の木々と同じくらいのスケール。"],
      ["08-0829", 29, "完成", "芝が入り、ベンチが置かれて完成。"],
      ["09-0829-dusk", 29, "点灯", "夕暮れ、シェルの内側が光る。"],
    ];
    const PHASES = [[13, 16, "マスト・シェル取付", false], [16, 21, "シェル取付・閉合", false], [21, 24, "仮設撤去", false], [24, 29, "外構・仕上げ", false], [29, 30, "完成", true]];
    const D0 = 12.5, D1 = 30;
    const pct = (d) => ((d - D0) / (D1 - D0)) * 100;
    const stage = $("#stage"), gantt = $("#gantt"), cap = $("#cap");
    stage.innerHTML = STEPS.map(([f], i) => `<img src="img/process/${f}.jpg" alt="HOAM 現場写真 ${i + 1}" loading="lazy">`).join("") + `<span class="stamp" id="stamp"></span>`;
    let g = `<div class="axis"></div>`;
    for (let d = 13; d <= 29; d++) g += `<span class="day" style="left:${pct(d)}%"></span>` + (d % 2 || d === 29 ? `<span class="dl" style="left:${pct(d)}%">${d === 13 ? "8/" : ""}${d}</span>` : "");
    PHASES.forEach(([a, b, l, acc], i) => {
      const y = 8 + (i % 2) * 14;
      g += `<span class="gbar${acc ? " acc" : ""}" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%;top:${y + 12}px"></span>`;
      if (!acc) g += `<span class="bl" style="left:${pct(a)}%;top:${y + 12}px">${l}</span>`;
    });
    gantt.innerHTML = g + `<span class="head" id="head"></span>`;
    // 同じ日の写真は少しずらして並べる
    const pos = STEPS.map(([, d], i) => d + 0.5 * STEPS.slice(0, i).filter((s) => s[1] === d).length);
    const imgs = [...stage.querySelectorAll("img")], head = $("#head"), stamp = $("#stamp");
    let cur = -1;
    const show = (i) => {
      i = Math.max(0, Math.min(STEPS.length - 1, i));
      if (i === cur) return; cur = i;
      imgs.forEach((im, k) => { im.classList.toggle("on", k === i); if (Math.abs(k - i) <= 1) im.loading = "eager"; });
      head.style.left = pct(pos[i]) + "%";
      const [, d, t, txt] = STEPS[i];
      stamp.textContent = `2026.08.${d}`;
      cap.innerHTML = `<b>${esc(t)}</b>${esc(txt)}`;
      gantt.setAttribute("aria-valuenow", i + 1);
      gantt.setAttribute("aria-valuetext", `8月${d}日 ${t}`);
    };
    const fromX = (x) => {
      const r = gantt.getBoundingClientRect(), d = D0 + ((x - r.left) / r.width) * (D1 - D0);
      let best = 0; pos.forEach((p, k) => { if (Math.abs(p - d) < Math.abs(pos[best] - d)) best = k; });
      show(best);
    };
    let drag = false;
    gantt.addEventListener("pointerdown", (e) => { drag = true; gantt.setPointerCapture(e.pointerId); fromX(e.clientX); });
    gantt.addEventListener("pointermove", (e) => { if (drag || e.pointerType === "mouse") fromX(e.clientX); });
    gantt.addEventListener("pointerup", () => { drag = false; });
    gantt.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { show(cur + 1); e.preventDefault(); }
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { show(cur - 1); e.preventDefault(); }
    });
    show(0);

    // 動きを控える設定では動画を止めておく
    if (reduceMotion) { const v = $(".shake video"); v.removeAttribute("autoplay"); v.pause(); v.controls = true; }
  })();

  /* ───────────────────── 3. 部材リスト ───────────────────── */
  const PEEK = { 412: "haniyasu-1", 408: "geidai-1", 337: "furukawa-1", 312: "kdu-1", 226: "omishima-1", 338: "hanaju-1", 336: "kcg-1" };
  const projects = DATA.projects.slice();
  if (!projects.some((p) => p.no === 338)) projects.push({ no: 338, t: "花重リノベーション", a: "マル・アーキテクチャ", s: "東京", y: "2023" });
  if (!projects.some((p) => p.no === 336)) projects.push({ no: 336, t: "Karuizawa Commongrounds", a: "Klein Dytham architecture", s: "長野", y: "2022" });
  projects.sort((a, b) => b.no - a.no);

  const KANTO = ["埼玉", "千葉", "栃木", "群馬", "茨城"];
  const REGIONS = [
    ["all", "すべて", () => true],
    ["tokyo", "東京", (p) => p.s === "東京"],
    ["kanagawa", "神奈川", (p) => p.s === "神奈川"],
    ["kanto", "関東その他", (p) => KANTO.includes(p.s)],
    ["local", "その他の地域", (p) => p.s && p.s !== "東京" && p.s !== "神奈川" && !KANTO.includes(p.s) && p.s !== "ウガンダ"],
    ["abroad", "海外", (p) => p.s === "ウガンダ"],
  ];
  const list = { q: "", r: "all", all: false };
  $("#chips").innerHTML = REGIONS.map(([k, l]) => `<button type="button" data-r="${k}" class="${k === "all" ? "on" : ""}">${l}</button>`).join("");
  $("#total").textContent = projects.length;

  const renderRows = () => {
    const q = list.q.trim().toLowerCase();
    const reg = REGIONS.find((r) => r[0] === list.r)[2];
    const hits = projects.filter((p) => reg(p) && (!q || `${p.t} ${p.a} ${p.s}`.toLowerCase().includes(q)));
    const shown = list.all || q || list.r !== "all" ? hits : hits.slice(0, 24);
    $("#hits").textContent = hits.length;
    $("#rows").innerHTML = shown.map((p) => `
      <tr${PEEK[p.no] ? ` class="has-img" data-img="${PEEK[p.no]}"` : ""}>
        <td>${String(p.no).padStart(4, "0")}</td><td>${esc(p.t)}</td><td>${esc(p.a)}</td><td>${esc(p.s || "—")}</td>
        <td>${esc(p.y || "—")}</td>
      </tr>`).join("") || `<tr><td colspan="5">該当するプロジェクトはありません。</td></tr>`;
    $("#more").hidden = shown.length >= hits.length;
  };
  $("#q").addEventListener("input", (e) => { list.q = e.target.value; renderRows(); });
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    list.r = b.dataset.r;
    document.querySelectorAll("#chips button").forEach((x) => x.classList.toggle("on", x === b));
    renderRows();
  });
  $("#more").addEventListener("click", () => { list.all = true; renderRows(); });
  renderRows();

  // 写真のあるプロジェクトはカーソル位置に小さくプレビュー
  const peek = $("#peek"), peekImg = $("#peek img");
  $("#rows").addEventListener("pointermove", (e) => {
    const tr = e.target.closest("tr[data-img]");
    if (!tr) { peek.classList.remove("on"); return; }
    const src = `img/${tr.dataset.img}.jpg`;
    if (!peekImg.src.endsWith(src)) peekImg.src = src;
    const x = Math.min(e.clientX, innerWidth - 300);
    peek.style.left = x + "px"; peek.style.top = e.clientY + "px";
    peek.classList.add("on");
  });
  $("#rows").addEventListener("pointerleave", () => peek.classList.remove("on"));

  /* ───────────────────── 4. 受賞・掲載 ───────────────────── */
  const aw = DATA.awards;
  const renderAwards = (all) => {
    $("#awards").innerHTML = (all ? aw : aw.slice(0, 10)).map((a) => `<li><b>${esc(a.a)}</b><span>${esc(a.w)}（${esc(a.r)}）</span></li>`).join("");
    $("#more-aw").hidden = all || aw.length <= 10;
  };
  renderAwards(false);
  $("#more-aw").addEventListener("click", () => renderAwards(true));

  // 年ごとの掲載件数を「分布荷重」として描く
  (() => {
    const svg = $("#pubchart");
    const cnt = {};
    DATA.pubs.forEach((p) => { const y = +p.y; if (y >= 2012) cnt[y] = (cnt[y] || 0) + 1; });
    const years = []; for (let y = 2012; y <= 2026; y++) years.push(y);
    const max = Math.max(1, ...years.map((y) => cnt[y] || 0));
    const W = 640, H = 250, L = 40, Rr = 40, beamY = 196, top = 34, sL = 14, sR = W - 14;
    const dx = (W - L - Rr) / (years.length - 1);
    const len = (c) => (beamY - 8 - top) * c / max;
    const xs = years.map((_, i) => L + i * dx);
    let env = `M${xs[0]},${beamY - 8}`;
    years.forEach((y, i) => { env += ` L${xs[i]},${beamY - 8 - len(cnt[y] || 0)}`; });
    env += ` L${xs[xs.length - 1]},${beamY - 8} Z`;
    let g = `<path class="env" d="${env}"/>`;
    years.forEach((y, i) => {
      const c = cnt[y] || 0, x = xs[i], y0 = beamY - 8 - len(c);
      g += `<g class="col"><title>${y}年：${c}件</title>`;
      if (c) g += `<line class="ar" x1="${x}" y1="${y0}" x2="${x}" y2="${beamY - 9}"/><path class="ah" d="M${x},${beamY - 3} l-4,-8 h8 z"/>`;
      g += `<text class="v" x="${x}" y="${y0 - 8}" text-anchor="middle">${c || ""}</text>`;
      g += `<text x="${x}" y="${beamY + 30}" text-anchor="middle">${String(y).slice(2)}</text></g>`;
    });
    g += `<line class="beam" x1="${sL}" y1="${beamY}" x2="${sR}" y2="${beamY}"/>`;
    g += `<path class="sup" d="M${sL},${beamY + 2} l-9,14 h18 z M${sL - 13},${beamY + 19} h26"/>`;
    g += `<path class="sup" d="M${sR},${beamY + 2} l-9,14 h18 z M${sR - 13},${beamY + 23} h26"/><circle class="sup" cx="${sR - 5}" cy="${beamY + 19.5}" r="1.6"/><circle class="sup" cx="${sR + 5}" cy="${beamY + 19.5}" r="1.6"/>`;
    g += `<text x="${sR}" y="${top - 6}" text-anchor="end">2012–2026</text>`;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = g;
  })();

  // メディア（TV）
  $("#tv").innerHTML = "渡辺篤史の建もの探訪" + [["山崎の住宅", "2016.11"], ["ノーマルビルディング", "2016.04"], ["柳崎の住宅", "2015.11"]]
    .map(([w, d]) => `<span>${d}　${esc(w)}</span>`).join("");

  /* ───────────────────── 数字・ナビ・出現 ───────────────────── */
  const counts = { awards: DATA.awards.length, pubs: DATA.pubs.length };
  document.querySelectorAll("[data-count]").forEach((el) => {
    const v = counts[el.dataset.count]; if (v == null) return;
    el.textContent = reduceMotion ? v : "0";
    if (reduceMotion) return;
    new IntersectionObserver(([en], ob) => {
      if (!en.isIntersecting) return; ob.disconnect();
      const t0 = performance.now();
      const step = (t) => { const f = Math.min(1, (t - t0) / 1100); el.textContent = Math.round(v * (1 - (1 - f) ** 3)); if (f < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }).observe(el);
  });

  const navLinks = [...document.querySelectorAll(".axes a")];
  const secObs = new IntersectionObserver((ents) => ents.forEach((en) => {
    if (en.isIntersecting) navLinks.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + en.target.id));
  }), { rootMargin: "-45% 0px -50% 0px" });
  document.querySelectorAll("main section[id]").forEach((s) => secObs.observe(s));

  const rvObs = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); rvObs.unobserve(en.target); } }), { rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll(".rv, .sec-h, .tenets li, .svc li").forEach((el) => { el.classList.add("rv"); rvObs.observe(el); });

  const d = new Date();
  $("#tb-date").textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
})();
