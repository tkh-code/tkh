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

    // 単位：kN, m
    const E = 2.05e8;
    const P = 100;   // 鉛直集中荷重

    /* ── 構造モデル ──
     * members: [点列, 分割長さ, 断面, 載荷できるか]
     * supports: { "x,y": "fix" | "pin" }
     * lat: 地震力 [x, y, Q]
     */
    const SEC = {
      trunk: { A: 6.0e-2, I: 1.6e-3 }, branch: { A: 1.2e-2, I: 1.5e-4 }, roof: { A: 1.2e-2, I: 3.0e-4 },
      arch: { A: 2.4e-2, I: 6.0e-4 }, deck: { A: 1.2e-2, I: 2.5e-4 }, strut: { A: 4.0e-3, I: 2.0e-5 },
      core: { A: 8.0e-2, I: 3.0e-3 }, chord: { A: 2.0e-2, I: 8.0e-4 }, post: { A: 1.6e-2, I: 6.0e-4 },
      col: { A: 2.8e-2, I: 4.0e-4 }, beam: { A: 1.2e-2, I: 5.0e-4 },
    };
    const line = (x1, y1, x2, y2) => [[x1, y1], [x2, y2]];
    const PRESETS = {
      tree: {
        name: "樹状柱の大屋根",
        build() {
          const m = [];
          const keys = [0, 2, 6, 10, 14, 18, 22, 24];
          for (let i = 0; i < keys.length - 1; i++) m.push([line(keys[i], 7, keys[i + 1], 7), 0.5, SEC.roof, true]);
          [6, 18].forEach((x) => {
            m.push([line(x, 0, x, 3.2), 0.8, SEC.trunk]);
            [-4, 0, 4].forEach((d) => m.push([line(x, 3.2, x + d, 7), 0.8, SEC.branch]));
          });
          return m;
        },
        supports: { "6,0": "fix", "18,0": "fix" },
        axes: [[6, "X1"], [18, "X2"]], levels: [[0, "GL"], [7, "RFL"]], dims: [0, 6, 18, 24],
        lat: [[0, 7, 30], [12, 7, 30], [24, 7, 30]],
      },
      arch: {
        name: "上路式アーチ",
        build() {
          const m = [], pts = [];
          for (let x = 0; x <= 32; x += 2) pts.push([x, 7 * (1 - ((x - 16) / 16) ** 2)]);
          for (let i = 0; i < pts.length - 1; i++) m.push([[pts[i], pts[i + 1]], 1, SEC.arch]);
          for (let x = 0; x < 32; x += 2) m.push([line(x, 8.5, x + 2, 8.5), 0.5, SEC.deck, true]);
          pts.forEach(([x, y]) => m.push([line(x, y, x, 8.5), 9, SEC.strut]));
          return m;
        },
        supports: { "0,0": "pin", "32,0": "pin" },
        axes: [[0, "A1"], [16, "C"], [32, "A2"]], levels: [[0, "GL"], [8.5, "路面"]], dims: [0, 16, 32],
        lat: [[0, 8.5, 40], [32, 8.5, 40]],
      },
      box: {
        name: "片持ちフィーレンデール",
        build() {
          const m = [];
          [0, 4].forEach((x) => [[0, 5], [5, 8.6]].forEach(([a, b]) => m.push([line(x, a, x, b), 1, SEC.core])));
          for (let x = 0; x < 18; x += 2) {
            m.push([line(x, 8.6, x + 2, 8.6), 0.5, SEC.chord, true]);
            m.push([line(x, 5, x + 2, 5), 0.5, SEC.chord, true]);
          }
          for (let x = 2; x <= 18; x += 2) if (x !== 4) m.push([line(x, 5, x, 8.6), 0.9, SEC.post]);
          return m;
        },
        supports: { "0,0": "fix", "4,0": "fix" },
        axes: [[0, "X1"], [4, "X2"]], levels: [[0, "GL"], [5, "2FL"], [8.6, "RFL"]], dims: [0, 4, 18],
        lat: [[0, 5, 60], [0, 8.6, 60]],
      },
      rahmen: {
        name: "ラーメン",
        build() {
          const m = [], XS = [0, 6, 13.2, 19.2], LV = [0, 4.2, 7.8];
          for (let s = 0; s < 2; s++) XS.forEach((x) => m.push([line(x, LV[s], x, LV[s + 1]), 1.05, SEC.col]));
          for (let f = 1; f < 3; f++) for (let b = 0; b < 3; b++) m.push([line(XS[b], LV[f], XS[b + 1], LV[f]), 0.75, SEC.beam, true]);
          m.push([line(19.2, 7.8, 21.6, 7.8), 0.8, SEC.beam, true]);
          return m;
        },
        supports: { "0,0": "fix", "6,0": "fix", "13.2,0": "fix", "19.2,0": "fix" },
        axes: [[0, "X1"], [6, "X2"], [13.2, "X3"], [19.2, "X4"]], levels: [[0, "1FL"], [4.2, "2FL"], [7.8, "RFL"]], dims: [0, 6, 13.2, 19.2, 21.6],
        lat: [[0, 4.2, 80], [0, 7.8, 120]],
      },
    };

    /* ── モデルを組み立てて、荷重ケースを解いておく ── */
    const kk = (x, y) => (+x.toFixed(3)) + "," + (+y.toFixed(3));
    const build = (pre) => {
      const nodes = [], key = new Map(), els = [];
      const node = (x, y) => {
        const k = kk(x, y);
        if (!key.has(k)) { key.set(k, nodes.length); nodes.push({ x, y, sup: pre.supports[k] || null }); }
        return key.get(k);
      };
      pre.build().forEach(([pts, step, sec, load]) => {
        for (let p = 0; p < pts.length - 1; p++) {
          const [x1, y1] = pts[p], [x2, y2] = pts[p + 1];
          const nseg = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / step));
          let prev = node(x1, y1);
          for (let i = 1; i <= nseg; i++) {
            const cur = node(x1 + (x2 - x1) * i / nseg, y1 + (y2 - y1) * i / nseg);
            els.push({ i: prev, j: cur, ...sec, load: !!load });
            prev = cur;
          }
        }
      });
      els.forEach((e) => {
        const a = nodes[e.i], b = nodes[e.j];
        e.L = Math.hypot(b.x - a.x, b.y - a.y); e.c = (b.x - a.x) / e.L; e.s = (b.y - a.y) / e.L;
      });
      const dof = []; let n = 0;
      nodes.forEach((nd, k) => {
        const fx = nd.sup === "fix" || nd.sup === "pin";
        dof[k] = [fx ? -1 : n++, fx ? -1 : n++, nd.sup === "fix" ? -1 : n++];
      });
      els.forEach((e) => {
        const { L } = e, EA = E * e.A / L, EI = E * e.I;
        const a = 12 * EI / L ** 3, b = 6 * EI / L ** 2, c = 4 * EI / L, d = 2 * EI / L;
        e.k = [[EA, 0, 0, -EA, 0, 0], [0, a, b, 0, -a, b], [0, b, c, 0, -b, d], [-EA, 0, 0, EA, 0, 0], [0, -a, -b, 0, a, -b], [0, b, d, 0, -b, c]];
        e.map = [...dof[e.i], ...dof[e.j]];
      });

      // 全体剛性マトリクス
      const K = new Float64Array(n * n);
      els.forEach((e) => {
        const { c, s } = e;
        const T = [[c, s, 0, 0, 0, 0], [-s, c, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0], [0, 0, 0, c, s, 0], [0, 0, 0, -s, c, 0], [0, 0, 0, 0, 0, 1]];
        for (let p = 0; p < 6; p++) {
          const P_ = e.map[p]; if (P_ < 0) continue;
          for (let q = 0; q < 6; q++) {
            const Q_ = e.map[q]; if (Q_ < 0) continue;
            let v = 0;
            for (let r = 0; r < 6; r++) for (let t = 0; t < 6; t++) v += T[r][p] * e.k[r][t] * T[t][q];
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
        for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) x[i] -= K[i * n + j] * x[j];
        for (let i = n - 1; i >= 0; i--) { for (let j = i + 1; j < n; j++) x[i] -= K[i * n + j] * x[j]; x[i] /= K[i * n + i]; }
        return x;
      };

      const md = { pre, nodes, key, els, dof, n };
      md.loadNodes = [...new Set(els.filter((e) => e.load).flatMap((e) => [e.i, e.j]))]
        .filter((k) => !nodes[k].sup).sort((a, b) => nodes[a].y - nodes[b].y || nodes[a].x - nodes[b].x);
      const topY = Math.max(...md.loadNodes.map((k) => nodes[k].y));
      md.demoNodes = md.loadNodes.filter((k) => nodes[k].y === topY).sort((a, b) => nodes[a].x - nodes[b].x);
      md.vCase = new Map();
      md.loadNodes.forEach((k) => { const F = new Float64Array(n); F[dof[k][1]] = -P; md.vCase.set(k, solve(F)); });
      const F = new Float64Array(n);
      pre.lat.forEach(([x, y, q]) => { F[dof[key.get(kk(x, y))][0]] += q; });
      md.hCase = solve(F);
      md.Qsum = pre.lat.reduce((s, l) => s + l[2], 0);
      // 表示スケールの基準（荷重位置で図の大きさが変わるよう、モデルとケースごとに固定）
      md.ref = { v: { M: 0, Q: 0, N: 0, d: 0 }, h: peaks(md, md.hCase) };
      md.vCase.forEach((u) => { const p = peaks(md, u); for (const k in p) md.ref.v[k] = Math.max(md.ref.v[k], p[k]); });
      const xs = nodes.map((nd) => nd.x), ys = nodes.map((nd) => nd.y);
      md.box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      return md;
    };

    // 部材の応力（N, Q, M：i端・j端）
    function forces(md, u, e) {
      const g = e.map.map((d) => (d < 0 ? 0 : u[d]));
      const { c, s } = e;
      const ul = [c * g[0] + s * g[1], -s * g[0] + c * g[1], g[2], c * g[3] + s * g[4], -s * g[3] + c * g[4], g[5]];
      const f = e.k.map((row) => row.reduce((acc, v, t) => acc + v * ul[t], 0));
      return { N: -f[0], Q: f[1], Mi: -f[2], Mj: f[5] };
    }
    function peaks(md, u) {
      let M = 0, Q = 0, N = 0, d = 0;
      md.els.forEach((e) => {
        const r = forces(md, u, e);
        M = Math.max(M, Math.abs(r.Mi), Math.abs(r.Mj)); Q = Math.max(Q, Math.abs(r.Q)); N = Math.max(N, Math.abs(r.N));
      });
      md.nodes.forEach((nd, k) => { const [a, b] = md.dof[k]; if (a >= 0) d = Math.max(d, Math.hypot(u[a], u[b])); });
      return { M, Q, N, d };
    }

    const models = {};
    const getModel = (id) => (models[id] ||= build(PRESETS[id]));

    /* ── 状態 ── */
    const st = {
      md: null, load: "v", dia: "M", target: 0, hover: false, t0: performance.now(),
      u: null, visible: true, W: 0, H: 0, dpr: 1, k: 1, ox: 0, oy: 0, col: {},
    };
    const setModel = (id) => {
      st.md = getModel(id);
      st.u = new Float64Array(st.md.n);
      st.target = st.md.demoNodes[Math.floor(st.md.demoNodes.length * 0.3)];
      st.t0 = performance.now();
      document.querySelectorAll("[data-model]").forEach((b) => b.classList.toggle("on", b.dataset.model === id));
      resize();
      if (reduceMotion) still();
    };

    const recolor = () => {
      st.col = { ink: css("--ink"), ink2: css("--ink-2"), ink3: css("--ink-3"), line: css("--line"), acc: css("--acc"), accSoft: css("--acc-soft"), paper: css("--paper") };
      if (reduceMotion && st.md) draw(performance.now());
    };

    function resize() {
      if (!st.md) return;
      const r = canvas.getBoundingClientRect();
      st.dpr = Math.min(window.devicePixelRatio || 1, 2);
      st.W = r.width; st.H = r.height;
      canvas.width = Math.round(r.width * st.dpr); canvas.height = Math.round(r.height * st.dpr);
      const small = r.width < 520;
      const pl = small ? 22 : 48, pr = small ? 42 : 66, pt = small ? 64 : 84, pb = small ? 46 : 58;
      const { x0, x1, y0, y1 } = st.md.box, wx = x1 - x0, wy = y1 - y0;
      st.k = Math.min((r.width - pl - pr) / wx, (r.height - pt - pb) / wy);
      st.ox = pl + ((r.width - pl - pr) - wx * st.k) / 2 - x0 * st.k;
      st.oy = r.height - pb - ((r.height - pt - pb) - wy * st.k) / 2 + y0 * st.k;
      if (reduceMotion) draw(performance.now());
    }
    const sx = (x) => st.ox + x * st.k;
    const sy = (y) => st.oy - y * st.k;
    const still = () => { st.u = Float64Array.from(st.load === "v" ? st.md.vCase.get(st.target) : st.md.hCase); draw(performance.now()); };

    // 入力：一番近い載荷点に荷重を移す
    const pick = (ev) => {
      const r = canvas.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top, { nodes } = st.md;
      let best = st.target, bd = Infinity;
      st.md.loadNodes.forEach((k) => {
        const d = (sx(nodes[k].x) - px) ** 2 + ((sy(nodes[k].y) - py) * 1.6) ** 2;
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
      const ax = st.md.pre.axes.find(([x]) => Math.abs(x - nd.x) < 1e-6);
      const lv = st.md.pre.levels.find(([y]) => Math.abs(y - nd.y) < 1e-6);
      return `${ax ? ax[1] : `x=${fmt(nd.x)}m`}${lv ? " " + lv[1] : ""}`;
    };
    const ro = { load: $("#ro-load"), m: $("#ro-m"), d: $("#ro-d"), s: $("#ro-s") };
    let roLast = "";

    function draw(t) {
      const { col, dpr, md } = st;
      const { nodes, els, dof, pre } = md;
      const { u: tu, s } = targetU(t);
      // ばねのように追従させる
      const a = reduceMotion ? 1 : 0.18;
      for (let i = 0; i < md.n; i++) st.u[i] += (tu[i] * s - st.u[i]) * a;
      const u = st.u, R = md.ref[st.load], { x0, x1, y1 } = md.box, span = x1 - x0;
      const small = st.W < 520;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, st.W, st.H);
      ctx.lineCap = "round"; ctx.lineJoin = "round";

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
        if (nd.sup === "pin") {
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

      // 応力図
      const refV = R[st.dia] || 1;
      const sc = (st.dia === "M" ? 0.13 : 0.08) * span / refV;     // 値 → ワールド座標の長さ
      let peak = { v: 0 };
      ctx.fillStyle = col.accSoft; ctx.strokeStyle = col.acc; ctx.lineWidth = 1.3;
      els.forEach((e) => {
        const r = forces(md, u, e), A = nodes[e.i], B = nodes[e.j];
        const nx = -e.s, ny = e.c;
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
      const dp = (k) => { const [a1, b1] = dof[k]; return a1 < 0 ? [0, 0] : [u[a1] * amp, u[b1] * amp]; };
      els.forEach((e) => {
        const A = nodes[e.i], B = nodes[e.j], da = dp(e.i), db = dp(e.j);
        ctx.beginPath(); ctx.moveTo(sx(A.x + da[0]), sy(A.y + da[1])); ctx.lineTo(sx(B.x + db[0]), sy(B.y + db[1])); ctx.stroke();
      });

      // 最大値のラベル
      if (Math.abs(peak.v) > refV * 0.02) {
        const unit = st.dia === "M" ? "kN·m" : "kN";
        const txt = `${st.dia}=${fmt(Math.abs(peak.v))}${unit}`;
        ctx.font = `600 ${small ? 10 : 11.5}px "IBM Plex Mono", monospace`;
        const tw = ctx.measureText(txt).width + 10;
        const X = Math.min(Math.max(sx(peak.x) + peak.dx * (tw / 2 + 4), tw / 2 + 2), st.W - tw / 2 - 2);
        const Y = Math.min(sy(peak.y) - peak.dy * 14, st.oy - 12);
        ctx.fillStyle = col.paper; ctx.fillRect(X - tw / 2, Y - 9, tw, 18);
        ctx.fillStyle = col.acc; ctx.textAlign = "center"; ctx.fillText(txt, X, Y);
      }

      // 荷重の矢印
      ctx.strokeStyle = col.acc; ctx.fillStyle = col.acc; ctx.lineWidth = 2.2;
      const arrow = (ax, ay, bx, by) => {
        const ang = Math.atan2(by - ay, bx - ax);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.lineTo(bx - 9 * Math.cos(ang - 0.4), by - 9 * Math.sin(ang - 0.4));
        ctx.lineTo(bx - 9 * Math.cos(ang + 0.4), by - 9 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill();
      };
      ctx.font = `600 ${small ? 10 : 12}px "IBM Plex Mono", monospace`;
      let loadTxt;
      if (st.load === "v") {
        const nd = nodes[st.target], d = dp(st.target), X = sx(nd.x + d[0]), Y = sy(nd.y + d[1]) - 4;
        arrow(X, Y - 46, X, Y);
        ctx.textAlign = "center"; ctx.fillText(`P=${P}kN`, X, Y - 56);
        loadTxt = `P=${P}kN @ ${where(nd)}`;
      } else {
        const qmax = Math.max(...pre.lat.map((l) => l[2]));
        pre.lat.forEach(([x, y, q]) => {
          const k = md.key.get(kk(x, y)), d = dp(k), X = sx(x + d[0]), Y = sy(y + d[1]);
          const len = (18 + 26 * q / qmax) * (Math.sign(s) || 1);
          arrow(X - len, Y, X - Math.sign(len) * 4, Y);
        });
        loadTxt = `Q=${md.Qsum}kN（水平）`;
      }

      // 数値表示（実際の値）
      const pk = peaks(md, st.load === "v" ? md.vCase.get(st.target) : md.hCase);
      const roTxt = [loadTxt, `${fmt(pk.M)} kN·m`, `${fmt(pk.d * 1000, 2)} mm`, `変形 ×${Math.round(amp)}`];
      const joined = roTxt.join("|");
      if (joined !== roLast) { roLast = joined; ro.load.textContent = roTxt[0]; ro.m.textContent = roTxt[1]; ro.d.textContent = roTxt[2]; ro.s.textContent = roTxt[3]; }
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
