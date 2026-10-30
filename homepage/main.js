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
      logo: sec(3.0e-2, 1.2e-3),
      lat: sec(4.0e-3, 1.5e-5), sch: sec(3.0e-3, 6.0e-6), sdi: sec(2.0e-3, 3.0e-6), scol: sec(3.0e-2, 4.0e-4), hp: sec(3.5e-3, 1.2e-5),
    };
    const L2 = (x1, y1, x2, y2) => [[x1, y1, 0], [x2, y2, 0]];

    /* ── 構造モデル ──
     * params: [キー, 名前, 最小, 最大, 刻み, 初期値, 単位]。this.p に今の値が入る
     * build(): [点列[x,y,z], 分割長さ, 断面, 載荷できるか]。axes・levels・dims・lat もここで決める
     * sup: (x,y,z) => "fix" | "pin" | "roller" | null
     * lat: 地震力（x方向） [x, y, z, Q] または (nodes) => [[節点, Q]]
     */
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const uniq = (xs) => [...new Set(xs.map((v) => +v.toFixed(3)))].sort((a, b) => a - b);
    const parab = (x, L, f) => f * (1 - ((x - L / 2) / (L / 2)) ** 2);
    const XN = (i) => `X${i + 1}`;
    const PRESETS = {
      /* 平面の架構 */
      tree: {
        params: [["L", "全長", 12, 36, 1, 24, "m"], ["H", "高さ", 4, 10, 0.5, 7, "m"], ["T", "幹の高さ", 1, 6, 0.2, 3.2, "m"], ["S", "枝の広がり", 1, 6, 0.5, 4, "m"], ["N", "樹の数", 1, 3, 1, 2, "本"]],
        build() {
          const { L, H, N, S } = this.p, T = Math.min(this.p.T, H - 1), m = [];
          const xs = Array.from({ length: N }, (_, i) => +(L * (2 * i + 1) / (2 * N)).toFixed(3));
          const tips = xs.flatMap((x) => [-S, 0, S].map((d) => Math.min(L, Math.max(0, x + d))));
          const keys = uniq([0, L, ...tips]);
          for (let i = 0; i < keys.length - 1; i++) m.push([L2(keys[i], H, keys[i + 1], H), 0.5, SEC.roof, true]);
          xs.forEach((x) => {
            m.push([L2(x, 0, x, T), 0.8, SEC.trunk]);
            uniq([-S, 0, S].map((d) => Math.min(L, Math.max(0, x + d)))).forEach((tx) => m.push([L2(x, T, tx, H), 0.8, SEC.branch]));
          });
          this.axes = xs.map((x, i) => [x, XN(i)]); this.levels = [[0, "GL"], [H, "RFL"]]; this.dims = uniq([0, ...xs, L]);
          this.lat = uniq([0, ...xs, L]).map((x) => [x, H, 0, 90 / (N + 2)]);
          return m;
        },
        sup: (x, y) => (y === 0 ? "fix" : null),
      },
      arch: {
        params: [["L", "スパン", 16, 48, 2, 32, "m"], ["f", "ライズ", 2, 14, 0.5, 7, "m"], ["e", "路面との離れ", 0.5, 5, 0.5, 1.5, "m"], ["n", "束の数", 4, 24, 2, 16, "分割"]],
        build() {
          const { L, f, e, n } = this.p, D = f + e, m = [], pts = [];
          for (let i = 0; i <= n; i++) { const x = (L * i) / n; pts.push([x, parab(x, L, f), 0]); }
          for (let i = 0; i < n; i++) {
            m.push([[pts[i], pts[i + 1]], 1, SEC.arch]);
            m.push([L2(pts[i][0], D, pts[i + 1][0], D), 0.5, SEC.deck, true]);
          }
          pts.forEach(([x, y]) => m.push([L2(x, y, x, D), 99, SEC.strut]));
          this.axes = [[0, "A1"], [L / 2, "C"], [L, "A2"]]; this.levels = [[0, "GL"], [D, "路面"]]; this.dims = [0, L / 2, L];
          this.lat = [[0, D, 0, 40], [L, D, 0, 40]];
          return m;
        },
        sup: (x, y) => (y === 0 ? "pin" : null),
      },
      bstring: {
        params: [["L", "スパン", 12, 36, 1, 24, "m"], ["H", "柱の高さ", 4, 10, 0.5, 8, "m"], ["s", "サグ", 0.4, 4, 0.1, 1.9, "m"], ["n", "束の数", 1, 7, 1, 3, "本"]],
        build() {
          const { L, H, s, n } = this.p, m = [], xs = Array.from({ length: n + 2 }, (_, i) => (L * i) / (n + 1));
          const cab = xs.map((x) => [x, H - parab(x, L, s)]);
          for (let i = 0; i < xs.length - 1; i++) {
            m.push([L2(xs[i], H, xs[i + 1], H), 0.5, SEC.sbeam, true]);
            m.push([L2(...cab[i], ...cab[i + 1]), 99, SEC.cable]);
          }
          cab.slice(1, -1).forEach(([x, y]) => m.push([L2(x, y, x, H), 2, SEC.strut]));
          [0, L].forEach((x) => m.push([L2(x, 0, x, H), 1, SEC.col]));
          this.axes = [[0, "X1"], [L, "X2"]]; this.levels = [[0, "GL"], [H, "RFL"]]; this.dims = xs;
          this.lat = [[0, H, 0, 40], [L, H, 0, 40]];
          return m;
        },
        sup: (x, y) => (y === 0 ? "fix" : null),
      },
      truss: {
        params: [["L", "スパン", 12, 36, 1, 24, "m"], ["d", "せい", 1, 4, 0.2, 2.4, "m"], ["n", "パネル数", 4, 16, 2, 8, ""], ["H", "柱の高さ", 3, 6, 0.5, 4, "m"]],
        build() {
          const { L, d, n, H } = this.p, w = L / n, T = H + d, m = [];
          for (let i = 0; i < n; i++) {
            const x = i * w;
            m.push([L2(x, T, x + w, T), 99, SEC.tchord, true]);
            m.push([L2(x, H, x + w, H), 99, SEC.tchord]);
            m.push([L2(x, i % 2 ? T : H, x + w, i % 2 ? H : T), 99, SEC.tdiag]);
            if (i) m.push([L2(x, H, x, T), 99, SEC.tdiag]);
          }
          [0, L].forEach((x) => { m.push([L2(x, 0, x, H), 1, SEC.col]); m.push([L2(x, H, x, T), 1.2, SEC.col]); });
          this.axes = [[0, "X1"], [L, "X2"]]; this.levels = [[0, "GL"], [T, "RFL"]]; this.dims = [0, L];
          this.lat = [[0, T, 0, 60]];
          return m;
        },
        sup: (x, y) => (y === 0 ? "fix" : null),
      },
      susp: {
        params: [["L", "スパン", 16, 40, 2, 30, "m"], ["s", "サグ", 1, 6, 0.2, 3.2, "m"], ["H", "マストの高さ", 6, 14, 0.5, 10, "m"], ["b", "控えの開き", 3, 10, 0.5, 7, "m"]],
        build() {
          const { L, s, H, b } = this.p, n = Math.round(L / 2), m = [], pts = [];
          for (let i = 0; i <= n; i++) { const x = (L * i) / n; pts.push([x, H - parab(x, L, s), 0]); }
          for (let i = 0; i < n; i++) m.push([[pts[i], pts[i + 1]], 1, SEC.hang, true]);
          [0, L].forEach((x) => m.push([L2(x, 0, x, H), 1, SEC.mast]));
          m.push([L2(-b, 0, 0, H), 99, SEC.cable]);
          m.push([L2(L + b, 0, L, H), 99, SEC.cable]);
          this.axes = [[0, "X1"], [L, "X2"]]; this.levels = [[0, "GL"], [H, "頂部"]]; this.dims = [-b, 0, L / 2, L, L + b];
          this.lat = [[0, H, 0, 40]];
          return m;
        },
        sup(x, y) { return y === 0 ? (near(x, 0) || near(x, this.p.L) ? "fix" : "pin") : null; },
      },
      box: {
        params: [["C", "はね出し", 6, 24, 0.5, 14, "m"], ["H1", "下弦の高さ", 3, 7, 0.2, 5, "m"], ["d", "せい", 2, 6, 0.2, 3.6, "m"], ["p", "束の間隔", 1, 4, 0.5, 2, "m"]],
        build() {
          const { C, H1, d, p } = this.p, E = 4 + C, T = H1 + d, m = [];
          [0, 4].forEach((x) => [[0, H1], [H1, T]].forEach(([a, b]) => m.push([L2(x, a, x, b), 1, SEC.core])));
          const posts = []; for (let x = p; x < E + 1e-6; x += p) if (!near(x, 4)) posts.push(Math.min(x, E));
          if (!posts.some((x) => near(x, E))) posts.push(E);
          const keys = uniq([0, 4, ...posts]);
          for (let i = 0; i < keys.length - 1; i++) {
            m.push([L2(keys[i], T, keys[i + 1], T), 0.5, SEC.chord, true]);
            m.push([L2(keys[i], H1, keys[i + 1], H1), 0.5, SEC.chord, true]);
          }
          uniq(posts).forEach((x) => m.push([L2(x, H1, x, T), 0.9, SEC.post]));
          this.axes = [[0, "X1"], [4, "X2"]]; this.levels = [[0, "GL"], [H1, "2FL"], [T, "RFL"]]; this.dims = [0, 4, E];
          this.lat = [[0, H1, 0, 60], [0, T, 0, 60]];
          return m;
        },
        sup: (x, y) => (y === 0 ? "fix" : null),
      },
      rahmen: {
        params: [["B", "スパン", 4, 10, 0.2, 6.6, "m"], ["nb", "スパン数", 1, 5, 1, 3, ""], ["nf", "階数", 1, 6, 1, 2, "層"], ["h", "階高", 3, 5, 0.1, 3.9, "m"], ["c", "はね出し", 0, 4, 0.2, 2.4, "m"]],
        build() {
          const { B, nb, nf, h, c } = this.p, m = [];
          const XS = Array.from({ length: nb + 1 }, (_, i) => +(i * B).toFixed(3)), LV = Array.from({ length: nf + 1 }, (_, j) => +(j * h).toFixed(3));
          for (let s = 0; s < nf; s++) XS.forEach((x) => m.push([L2(x, LV[s], x, LV[s + 1]), h / 4, SEC.col]));
          for (let f = 1; f <= nf; f++) for (let b = 0; b < nb; b++) m.push([L2(XS[b], LV[f], XS[b + 1], LV[f]), 0.75, SEC.beam, true]);
          const X1 = XS[nb];
          if (c > 0) m.push([L2(X1, LV[nf], X1 + c, LV[nf]), 0.8, SEC.beam, true]);
          this.axes = XS.map((x, i) => [x, XN(i)]);
          this.levels = LV.map((y, j) => [y, j === nf ? "RFL" : `${j + 1}FL`]);
          this.dims = c > 0 ? [...XS, X1 + c] : XS;
          this.lat = LV.slice(1).map((y, j) => [0, y, 0, 60 * (j + 1)]);
          return m;
        },
        sup: (x, y) => (y === 0 ? "fix" : null),
      },

      /* 空間構造 */
      dome: {
        space: true,
        params: [["D", "スパン", 12, 40, 1, 24, "m"], ["f", "ライズ", 1.5, 14, 0.5, 6, "m"], ["rings", "リング数", 2, 6, 1, 4, ""]],
        build() {
          // 単層ラチスドーム：球面、6分割の三角形網
          const { D, rings } = this.p, a = D / 2, rise = Math.min(this.p.f, a), R = (a * a + rise * rise) / (2 * rise), m = [];
          const cy = rise - R, P3 = (r, ang) => [r * Math.cos(ang), cy + Math.sqrt(Math.max(0, R * R - r * r)), r * Math.sin(ang)];
          const ring = [[P3(0, 0)]];
          for (let i = 1; i <= rings; i++) {
            const r = a * i / rings, n = 6 * i, row = [];
            for (let j = 0; j < n; j++) row.push(P3(r, (2 * Math.PI * j) / n + (i % 2 ? 0 : Math.PI / (6 * i))));
            if (i === rings) row.forEach((p) => { p[1] = 0; });
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
      },
      space: {
        space: true,
        params: [["n", "グリッド数", 3, 9, 1, 6, ""], ["s", "グリッド", 2, 4, 0.5, 3, "m"], ["d", "せい", 0.8, 3, 0.2, 1.8, "m"], ["H", "高さ", 5, 10, 0.5, 8, "m"]],
        build() {
          // 立体トラス：上弦グリッド・下弦は半グリッドずらし、四隅の柱で支持
          const { n, s, d, H } = this.p, m = [], top = H, bot = H - d, X = (i) => i * s - (n * s) / 2;
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
        lat(nodes) { return nodes.map((nd, k) => [k, near(nd.y, this.p.H) ? 3 : 0]).filter((a) => a[1]); },
      },
      hp: {
        space: true,
        params: [["h", "大きさ", 10, 24, 1, 16, "m"], ["k", "ねじれ", 0, 6, 0.2, 3.6, "m"], ["n", "分割数", 4, 12, 2, 8, ""], ["H", "中心の高さ", 4, 8, 0.5, 5.5, "m"]],
        build() {
          // HPシェル（ラチス）：z = uv の鞍形。4 隅の柱で支持
          const { h, n, H } = this.p, k = Math.min(this.p.k, H - 1), m = [], f = (u, v) => [u * h / 2, H + k * u * v, v * h / 2];
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
      },
      /* ロゴの t：アイソメ図の 3 軸（x の腕・y の柱・z の脚）をそのまま架構にしたもの。脚の先端だけで立つ */
      logo: {
        space: true,
        params: [["H", "柱", 4, 14, 0.5, 10, "m"], ["A", "腕", 1, 6, 0.5, 3, "m"], ["F", "脚", 1, 6, 0.5, 3, "m"]],
        build() {
          const { H, A, F } = this.p;
          return [
            [[[0, 0, 0], [0, H, 0]], 1, SEC.logo],
            [[[-A, H, 0], [0, H, 0]], 0.5, SEC.logo, true],
            [[[0, 0, 0], [0, 0, F]], 0.5, SEC.logo],
          ];
        },
        sup(x, y, z) { return y === 0 && near(z, this.p.F) ? "fix" : null; },
        yaw: -Math.PI / 4, still: true, bar: 1.1, fit: 0.8,   // ロゴと同じ向きで止めて、太い部材で描く
        lat: (nodes) => nodes.map((nd, k) => [k, nd.y > 0 ? 4 : 0]).filter((a) => a[1]),
      },
      /* 自由に描く：1m グリッドに線を引いた架構。GL 上の点は固定端 */
      draw: {
        lines: [[[2, 0], [2, 6]], [[2, 6], [14, 6]], [[14, 6], [14, 0]], [[14, 6], [20, 9]]],
        build() {
          return this.lines.map(([a, b]) => [[[a[0], a[1], 0], [b[0], b[1], 0]], 1, Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) ? SEC.col : SEC.beam, true]);
        },
        sup: (x, y) => (y === 0 ? "fix" : null),
        axes: [], levels: [[0, "GL"]], dims: [0, 24],
        // 線の端点に、高さに比例した水平力（合計 100kN）
        lat(nodes) {
          const ends = new Set(this.lines.flat().map(([x, y]) => kk(x, y, 0)));
          const pts = nodes.map((nd, k) => [k, nd]).filter(([, nd]) => !nd.sup && nd.y > 0 && ends.has(kk(nd.x, nd.y, 0)));
          const sum = pts.reduce((a, [, nd]) => a + nd.y, 0) || 1;
          return pts.map(([k, nd]) => [k, (100 * nd.y) / sum]);
        },
        box: { x0: 0, x1: 24, y0: 0, y1: 10 },
        max: 40,
      },
    };

    Object.values(PRESETS).forEach((pre) => { if (pre.params) pre.p = Object.fromEntries(pre.params.map((q) => [q[0], q[5]])); });

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

      // 部材ごとの全体座標系の剛性（K = Tᵀ k T）と、断面係数・質量
      els.forEach((e) => {
        const T = Array.from({ length: 12 }, () => new Float64Array(12));
        for (let b = 0; b < 4; b++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[b * 3 + r][b * 3 + c] = e.R[r][c];
        const kT = Array.from({ length: 12 }, (_, r) => { const row = new Float64Array(12); for (let c = 0; c < 12; c++) { let v = 0; for (let t = 0; t < 12; t++) v += e.k[r][t] * T[t][c]; row[c] = v; } return row; });
        e.KG = new Float64Array(144);
        for (let p = 0; p < 12; p++) for (let q = 0; q < 12; q++) { let v = 0; for (let r = 0; r < 12; r++) v += T[r][p] * kT[r][q]; e.KG[p * 12 + q] = v; }
        e.Z = (2 * e.I) / Math.sqrt((12 * e.I) / e.A);
        e.mass = 7.85 * e.A * e.L;
      });
      // 組み立てて LU 分解（部分ピボット）。alive で外した部材は除く。不安定なら singular
      const assemble = (alive) => {
        const K = new Float64Array(n * n);
        els.forEach((e, idx) => {
          if (alive && !alive[idx]) return;
          for (let p = 0; p < 12; p++) {
            const P_ = e.map[p]; if (P_ < 0) continue;
            for (let q = 0; q < 12; q++) { const Q_ = e.map[q]; if (Q_ >= 0) K[P_ * n + Q_] += e.KG[p * 12 + q]; }
          }
        });
        const Kc = alive ? null : Float64Array.from(K);
        let dmax = 0; for (let i = 0; i < n; i++) dmax = Math.max(dmax, Math.abs(K[i * n + i]));
        const piv = new Int32Array(n); let singular = false;
        for (let k = 0; k < n; k++) {
          let m = k, mv = Math.abs(K[k * n + k]);
          for (let i = k + 1; i < n; i++) { const v = Math.abs(K[i * n + k]); if (v > mv) { mv = v; m = i; } }
          if (mv < 1e-9 * dmax) { singular = true; break; }
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
        return { solve, Kc, singular };
      };
      const base = assemble(null), solve = base.solve;
      if (!els.length || base.singular) {
        const bx = pre.box || { x0: Math.min(...nodes.map((d) => d.x)), x1: Math.max(...nodes.map((d) => d.x)), y0: 0, y1: Math.max(...nodes.map((d) => d.y)) };
        return { pre, nodes, els, n: 0, unstable: true, space: false, box: { ...bx, z0: 0, z1: 0 } };
      }

      const md = { pre, nodes, key, els, dof, n, toLocal, space: !!pre.space, assemble, solve, Kc: base.Kc };
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
      md.mass = new Float64Array(n);
      const addMass = (k, m) => { for (let d = 0; d < 3; d++) if (dof[k][d] >= 0) md.mass[dof[k][d]] += m; };
      els.forEach((e) => { addMass(e.i, e.mass / 2); addMass(e.j, e.mass / 2); });
      md.loadNodes.forEach((k) => addMass(k, 2));
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
      if (pre.box) Object.assign(md.box, pre.box);
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

    // 検定比（軸力と曲げの組み合わせ）。鋼材 F=235N/mm²
    const FY = 235000;
    const util = (md, u, e) => { const r = forces(md, u, e); return Math.abs(r.N) / (e.A * FY) + r.Mmax / (e.Z * FY); };

    // 固有値解析：サブスペース法で低次の4モードを求める（K φ = ω² M φ）
    function modes(md) {
      if (md.modes) return md.modes;
      const { n, solve, Kc, mass } = md, p = Math.min(6, n);
      let X = Array.from({ length: p }, (_, j) => { const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = mass[i] ? Math.sin(i * (j + 1) * 0.37 + j * 1.3) + 0.05 : 0; return x; });
      let lam = [];
      const dot = (a, b, w) => { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i] * (w ? w[i] : 1); return s; };
      for (let it = 0; it < 28; it++) {
        const Y = X.map((x) => solve(x.map((v, i) => v * mass[i])));
        const KY = Y.map((y) => { const r = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; const row = i * n; for (let c = 0; c < n; c++) s += Kc[row + c] * y[c]; r[i] = s; } return r; });
        const Kr = Y.map((ya) => KY.map((kb) => dot(ya, kb)));
        const Mr = Y.map((ya) => Y.map((yb) => dot(ya, yb, mass)));
        const { vals, vecs } = geig(Kr, Mr);
        X = vecs.map((q) => { const x = new Float64Array(n); q.forEach((c, a) => { for (let i = 0; i < n; i++) x[i] += c * Y[a][i]; }); return x; });
        lam = vals;
      }
      const ref = md.ref.v.d;
      md.modes = lam.slice(0, 4).map((l, k) => {
        const x = X[k]; let mx = 0;
        md.nodes.forEach((_, nd) => { const [a, b, c] = md.dof[nd]; mx = Math.max(mx, Math.hypot(a < 0 ? 0 : x[a], b < 0 ? 0 : x[b], c < 0 ? 0 : x[c])); });
        const u = x.map((v) => (v / mx) * ref);
        return { T: (2 * Math.PI) / Math.sqrt(Math.max(l, 1e-9)), u, ref: peaks(md, u) };
      });
      return md.modes;
    }
    // 小さな一般化固有値問題（コレスキー分解＋ヤコビ法）
    function geig(A, B) {
      const p = A.length, L = Array.from({ length: p }, () => new Float64Array(p));
      for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) {
        let s = B[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-30)) : s / L[j][j];
      }
      const inv = Array.from({ length: p }, () => new Float64Array(p));
      for (let c = 0; c < p; c++) for (let i = 0; i < p; i++) { let s = i === c ? 1 : 0; for (let k = 0; k < i; k++) s -= L[i][k] * inv[k][c]; inv[i][c] = s / L[i][i]; }
      const C = Array.from({ length: p }, (_, i) => Float64Array.from({ length: p }, (_, j) => { let s = 0; for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) s += inv[i][a] * A[a][b] * inv[j][b]; return s; }));
      const V = Array.from({ length: p }, (_, i) => Float64Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)));
      for (let sweep = 0; sweep < 40; sweep++) {
        let off = 0;
        for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) off += C[i][j] ** 2;
        if (off < 1e-20) break;
        for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) {
          if (Math.abs(C[i][j]) < 1e-30) continue;
          const th = 0.5 * Math.atan2(2 * C[i][j], C[j][j] - C[i][i]), c = Math.cos(th), s = Math.sin(th);
          for (let k = 0; k < p; k++) { const a = C[k][i], b = C[k][j]; C[k][i] = c * a - s * b; C[k][j] = s * a + c * b; }
          for (let k = 0; k < p; k++) { const a = C[i][k], b = C[j][k]; C[i][k] = c * a - s * b; C[j][k] = s * a + c * b; }
          for (let k = 0; k < p; k++) { const a = V[k][i], b = V[k][j]; V[k][i] = c * a - s * b; V[k][j] = s * a + c * b; }
        }
      }
      const order = [...Array(p).keys()].sort((a, b) => C[a][a] - C[b][b]);
      return {
        vals: order.map((i) => C[i][i]),
        vecs: order.map((i) => Float64Array.from({ length: p }, (_, r) => { let s = 0; for (let k = 0; k < p; k++) s += inv[k][r] * V[k][i]; return s; })),
      };
    }

    const PITCH = 0.5;
    const models = {};
    const getModel = (id) => (models[id] ||= build(PRESETS[id]));

    /* ── 状態 ── */
    const st = {
      md: null, id: "tree", load: "v", dia: "M", target: 0, hover: false, t0: performance.now(),
      u: null, visible: true, W: 0, H: 0, dpr: 1, k: 1, ox: 0, oy: 0, col: {}, yaw: 0.6, yawT: performance.now(),
      mode: 0, drag: null, brk: null, edit: null,
    };
    const useModel = (md) => {
      st.md = md; st.u = new Float64Array(md.n);
      st.t0 = performance.now(); st.brk = null; st.drag = null; st.mode = 0;
      if (md.unstable) return;
      if (md.pre.yaw !== undefined) st.yaw = md.pre.yaw;
      st.target = md.demoNodes[Math.floor(md.demoNodes.length * 0.3)];
      if (st.load === "m") modes(md);
    };
    // 描いた線から架構を組み直す
    const rebuildDraw = () => {
      const pre = PRESETS.draw, xs = [...new Set(pre.lines.flat().map((p) => p[0]))].sort((a, b) => a - b);
      pre.dims = xs.length > 1 ? xs : [0, 24];
      useModel(build(pre));
      if (reduceMotion) st.md.unstable ? draw(performance.now()) : still();
    };
    // 形状パラメータ：スライダーを動かすと、その場で組み直して解き直す
    const paramBox = $("#params"), paramList = $("#params .pl");
    const decimals = (step) => (String(step).split(".")[1] || "").length;
    const pval = (q, v) => `${v.toFixed(decimals(q[4]))}${q[6] ? " " + q[6] : ""}`;
    const renderParams = (id) => {
      const pre = PRESETS[id];
      paramBox.hidden = !pre.params;
      if (!pre.params) return;
      paramList.innerHTML = pre.params.map((q) => `<label><span>${q[1]}</span><input type="range" min="${q[2]}" max="${q[3]}" step="${q[4]}" value="${pre.p[q[0]]}" data-k="${q[0]}"><b>${pval(q, pre.p[q[0]])}</b></label>`).join("");
    };
    let pend = 0;
    const rebuild = () => {
      pend = 0;
      models[st.id] = build(PRESETS[st.id]);
      useModel(models[st.id]);
      resize();
      if (reduceMotion) still();
    };
    const queueRebuild = () => { if (!pend) pend = requestAnimationFrame(rebuild); };
    paramList.addEventListener("input", (ev) => {
      const el = ev.target, pre = PRESETS[st.id], q = pre.params.find((x) => x[0] === el.dataset.k);
      pre.p[q[0]] = +el.value; el.nextElementSibling.textContent = pval(q, +el.value);
      queueRebuild();
    });
    paramBox.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => {
      const pre = PRESETS[st.id];
      pre.params.forEach((q) => {
        if (b.dataset.p === "reset") { pre.p[q[0]] = q[5]; return; }
        const k = Math.round((Math.random() * (q[3] - q[2])) / q[4]);
        pre.p[q[0]] = +(q[2] + k * q[4]).toFixed(6);
      });
      renderParams(st.id); queueRebuild();
    }));

    const setModel = (id) => {
      st.id = id;
      renderParams(id);
      st.edit = id === "draw" ? { cur: null } : null;
      document.querySelector(".seg.edit").hidden = id !== "draw";
      canvas.classList.toggle("pen", id === "draw");
      document.querySelectorAll("[data-model]").forEach((b) => b.classList.toggle("on", b.dataset.model === id));
      if (id === "draw") { rebuildDraw(); resize(); return; }
      useModel(getModel(id));
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
        st.k *= st.md.pre.fit || 1;
        st.ox = r.width / 2; st.oy = r.height * (st.md.pre.fit ? 0.6 : 0.54);
      } else {
        const pl = small ? 22 : 48, pr = small ? 42 : 66, pt = small ? 84 : 108, pb = small ? 46 : 58;
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
    const still = () => { if (st.md.unstable) { draw(performance.now()); return; } st.u = Float64Array.from(st.load === "v" ? st.md.vCase.get(st.target) : st.md.hCase); draw(performance.now()); };

    // 入力：ホバーで載荷点を移す／ドラッグで引っぱる／クリックで次のモード・破壊開始
    const ptr = (ev) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    const nearest = (px, py, list) => {
      const { nodes } = st.md; let best = list[0], bd = Infinity;
      list.forEach((k) => {
        const [X, Y] = proj(nodes[k].x, nodes[k].y, nodes[k].z);
        const d = (X - px) ** 2 + ((Y - py) * (st.md.space ? 1 : 1.6)) ** 2;
        if (d < bd) { bd = d; best = k; }
      });
      return best;
    };
    const freeNodes = (md) => (md.free ||= md.nodes.map((_, k) => k).filter((k) => md.dof[k][1] >= 0));
    // 引っぱる点の柔性（単位力に対する変位）を求めておく
    const dragBasis = (md, k) => {
      md.dragCache ||= new Map();
      if (!md.dragCache.has(k)) {
        const unit = (d) => { if (md.dof[k][d] < 0) return null; const F = new Float64Array(md.n); F[md.dof[k][d]] = 1; return md.solve(F); };
        md.dragCache.set(k, { ux: md.space ? null : unit(0), uy: unit(1) });
      }
      return md.dragCache.get(k);
    };
    // 画面 → 1m グリッド上の点（描くモード）
    const toGrid = (px, py) => {
      const b = PRESETS.draw.box, cl = (v, a, z) => Math.min(z, Math.max(a, Math.round(v)));
      return [cl((px - st.ox) / st.k, b.x0, b.x1), cl((st.oy - py) / st.k, b.y0, b.y1)];
    };
    const drawing = () => st.edit && (st.md.unstable || st.load === "v" || st.load === "h");
    canvas.addEventListener("pointermove", (ev) => {
      const [px, py] = ptr(ev);
      if (st.edit) {
        st.edit.hov = toGrid(px, py);
        if (st.edit.cur) st.edit.cur.b = st.edit.hov;
        if (reduceMotion) draw(performance.now());
        if (st.edit.cur || st.md.unstable) return;
      }
      if (st.drag) { st.drag.px = px; st.drag.py = py; return; }
      st.hover = true;
      if (st.load === "v") { st.target = nearest(px, py, st.md.loadNodes); if (reduceMotion) still(); }
    });
    canvas.addEventListener("pointerdown", (ev) => {
      const [px, py] = ptr(ev);
      st.hover = true;
      if (drawing()) {
        const a = toGrid(px, py);
        st.edit.cur = { a, b: a };
        try { canvas.setPointerCapture(ev.pointerId); } catch (_) { /* 捕捉できなくても続ける */ }
        return;
      }
      if (st.load === "m") { st.mode = (st.mode + 1) % modes(st.md).length; st.t0 = performance.now(); return; }
      if (st.load === "b") { if (!st.brk || st.brk.phase === "done") startBreak(nearest(px, py, st.md.loadNodes)); return; }
      if (st.load !== "v") return;
      const k = nearest(px, py, freeNodes(st.md));
      st.drag = { k, x0: px, y0: py, px, py, basis: dragBasis(st.md, k), F: [0, 0] };
      try { canvas.setPointerCapture(ev.pointerId); } catch (_) { /* 捕捉できなくても続ける */ }
    });
    const endDraw = () => {
      const c = st.edit && st.edit.cur;
      if (!c) return false;
      st.edit.cur = null;
      const pre = PRESETS.draw, same = (p, q) => p[0] === q[0] && p[1] === q[1];
      const dup = pre.lines.some(([p, q]) => (same(p, c.a) && same(q, c.b)) || (same(p, c.b) && same(q, c.a)));
      if (!same(c.a, c.b) && !dup && pre.lines.length < pre.max) { pre.lines.push([c.a, c.b]); rebuildDraw(); }
      return true;
    };
    const endDrag = () => {
      if (endDraw()) return; if (st.drag) { st.target = st.md.loadNodes.includes(st.drag.k) ? st.drag.k : st.target; st.drag = null; } };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", () => { if (st.edit) st.edit.hov = null; if (!st.drag && !(st.edit && st.edit.cur)) { st.hover = false; st.t0 = performance.now(); } });

    // 壊してみる：選んだ点の荷重を増やし、検定比が1を超えた部材から破断させて組み直す
    function startBreak(k) {
      const md = st.md, now = performance.now();
      st.brk = { k, alive: new Uint8Array(md.els.length).fill(1), P: 0, broken: [], phase: "ramp", last: now, wait: 0.6 };
      breakSolve(md.solve);
    }
    function breakSolve(solve) {
      const b = st.brk, md = st.md, F = new Float64Array(md.n);
      F[md.dof[b.k][1]] = -1;
      b.unit = solve(F);
      let mu = 0, me = -1;
      md.els.forEach((e, i) => { if (!b.alive[i]) return; const v = util(md, b.unit, e); if (v > mu) { mu = v; me = i; } });
      b.nextP = 1 / mu; b.nextEl = me;
      if (!b.rate) { b.rate = b.nextP / 2.2; b.ref = peaks(md, b.unit.map((v) => v * b.nextP)); }
    }
    function breakU(t) {
      const b = st.brk, md = st.md;
      const dt = Math.min(0.1, (t - b.last) / 1000); b.last = t;
      if (b.phase === "ramp") {
        if (b.wait > 0) b.wait -= dt;
        else {
          // 組み直した直後にすでに限界を超えている部材は、荷重を下げずに連鎖して破断させる
          b.P = Math.max(b.P, Math.min(b.P + b.rate * dt, b.nextP));
          if (b.P >= b.nextP) {
            b.alive[b.nextEl] = 0; b.broken.push({ el: b.nextEl, P: b.P, t });
            b.wait = 0.3;
            const asm = md.assemble(b.alive);
            if (asm.singular || b.broken.length >= 40) { b.phase = "collapse"; b.tc = t; b.Pu = b.P; }
            else {
              const prev = b.unit; breakSolve(asm.solve);
              let dm = 0; b.unit.forEach((v) => { dm = Math.max(dm, Math.abs(v)); });
              if (dm * b.P > 40 * b.ref.d) { b.unit = prev; b.phase = "collapse"; b.tc = t; b.Pu = b.P; }
            }
          }
        }
      }
      if (b.phase === "collapse" && t - b.tc > 2600) b.phase = "done";
      const fall = b.phase === "ramp" ? 0 : Math.min(2.6, (t - b.tc) / 1000);
      return { u: b.unit, s: b.P * (1 + 2.5 * fall * fall) };
    }

    const setLoad = (l) => {
      st.load = l; st.brk = null; st.drag = null; st.mode = 0; st.t0 = performance.now();
      if (l === "m" && !st.md.unstable) modes(st.md);
      document.querySelectorAll("[data-load]").forEach((b) => b.classList.toggle("on", b.dataset.load === l));
      if (reduceMotion) still();
    };
    document.querySelectorAll("[data-load]").forEach((b) => b.addEventListener("click", () => setLoad(b.dataset.load)));
    document.querySelectorAll("[data-model]").forEach((b) => b.addEventListener("click", () => setModel(b.dataset.model)));
    document.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
      const L = PRESETS.draw.lines;
      if (b.dataset.edit === "undo") L.pop(); else L.length = 0;
      rebuildDraw();
    }));
    document.querySelectorAll("[data-dia]").forEach((b) => b.addEventListener("click", () => {
      st.dia = b.dataset.dia;
      document.querySelectorAll("[data-dia]").forEach((x) => x.classList.toggle("on", x === b));
      if (reduceMotion) draw(performance.now());
    }));

    // 目標の変位（時間で動かす：自動デモ・地震の揺れ）
    const ampOf = (md) => (md.space ? 0.06 * md.rad : 0.05 * (md.box.x1 - md.box.x0)) / (refNow().d || 1);
    const refNow = () => {
      const md = st.md;
      if (st.load === "m") return modes(md)[st.mode].ref;
      if (st.load === "b") return st.brk ? st.brk.ref : md.ref.v;
      return md.ref[st.load];
    };
    const targetU = (t) => {
      const md = st.md;
      if (st.drag) {
        // 指の動き（画面）→ 変位（実寸）→ 必要な力
        const d = st.drag, amp = ampOf(md), ex = (d.px - d.x0) / st.k / amp, ey = -(d.py - d.y0) / st.k / amp;
        const { ux, uy } = d.basis, iy = md.dof[d.k][1], ix = md.dof[d.k][0];
        let Fx = 0, Fy = 0;
        if (ux && uy) {
          const a = ux[ix], b = uy[ix], c = ux[iy], e = uy[iy], det = a * e - b * c;
          Fx = (e * ex - b * ey) / det; Fy = (-c * ex + a * ey) / det;
        } else if (uy) Fy = (ey / Math.cos(PITCH)) / uy[iy];
        const mag = Math.hypot(Fx, Fy), cap = 3000;
        if (mag > cap) { Fx *= cap / mag; Fy *= cap / mag; }
        d.F = [Fx, Fy];
        const u = new Float64Array(md.n);
        for (let i = 0; i < md.n; i++) u[i] = (ux ? ux[i] * Fx : 0) + uy[i] * Fy;
        return { u, s: 1 };
      }
      if (st.load === "m") {
        const ms = modes(md), M = ms[st.mode];
        const per = Math.max(0.5, 1.8 * (M.T / ms[0].T));
        return { u: M.u, s: reduceMotion ? 1 : Math.sin(((t - st.t0) / 1000) * (2 * Math.PI / per)) };
      }
      if (st.load === "b") return st.brk ? breakU(t) : { u: new Float64Array(md.n), s: 0 };
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
    const roL = [...document.querySelectorAll(".readout em")];

    // キャンバス左上のメッセージ
    function message(t) {
      const { col } = st, small = st.W < 520;
      let main = "", sub = "", hot = false;
      if (st.edit && (st.load === "v" || st.load === "h")) {
        const L = PRESETS.draw.lines.length;
        main = st.edit.cur ? "離したところまで部材を引きます" : L >= PRESETS.draw.max ? `部材は ${PRESETS.draw.max} 本までです` : "線を描き足すと、その場で解き直します";
        sub = `部材 ${L} 本｜GL に接する点は固定端｜${st.load === "v" ? "カーソルの位置に P=100kN" : "水平力 Q=100kN"}`;
        hot = !!st.edit.cur;
      } else if (st.load === "v") { main = st.drag ? `F = ${fmt(Math.hypot(...st.drag.F), 0)} kN で引っぱっています` : "ドラッグすると、その点を引っぱれます"; sub = st.drag ? "指を離すと戻ります" : "カーソルを置くと、その位置に P=100kN"; hot = !!st.drag; }
      if (st.load === "h") { main = "地震力で左右に揺らしています"; sub = "Ai分布に近い水平力"; }
      if (st.load === "m") { const M = modes(st.md)[st.mode]; main = `${st.mode + 1}次モード　T = ${fmt(M.T, 3)} s`; sub = "クリックで次のモード →"; }
      if (st.load === "b") {
        const b = st.brk;
        if (!b) { main = "どこに載せて壊しますか？"; sub = "構造をクリックすると、その点の荷重を増やしていきます"; hot = true; }
        else if (b.phase === "ramp") { main = `P = ${fmt(b.P, 0)} kN`; sub = b.broken.length ? `部材が ${b.broken.length} 本破断。力の流れが組み変わっています` : "検定比が 1 を超えた部材から破断します"; hot = true; }
        else { main = `崩壊！　Pu = ${fmt(b.Pu, 0)} kN`; sub = b.phase === "done" ? "クリックでもう一度" : `${b.broken.length} 本の部材が破断しました`; hot = true; }
      }
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.font = `600 ${small ? 12 : 14}px "IBM Plex Mono", "Noto Sans JP", monospace`;
      ctx.fillStyle = hot ? col.acc : col.ink; ctx.fillText(main, 14, small ? 22 : 26);
      ctx.font = `400 ${small ? 9.5 : 11}px "Noto Sans JP", monospace`;
      ctx.fillStyle = col.ink3; ctx.fillText(sub, 14, small ? 38 : 44);
      ctx.textBaseline = "middle";
    }
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
      if (md.unstable) { drawEdit(); return; }
      const { u: tu, s } = targetU(t);
      // ばねのように追従させる
      const a = reduceMotion ? 1 : 0.18;
      for (let i = 0; i < md.n; i++) st.u[i] += (tu[i] * s - st.u[i]) * a;
      if (md.space && !md.pre.still && !st.hover && !st.drag && !reduceMotion) st.yaw += (t - st.yawT) * 0.00012;
      st.yawT = t;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, st.W, st.H);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const res = md.space ? draw3(t, s) : draw2(t, s);
      message(t);

      // 数値表示（実際の値）
      const uNow = tu.map((v) => v * (st.load === "m" ? 1 : s));
      const pk = peaks(md, uNow);
      let lab = ["LOAD", "M<sub>max</sub>", "δ<sub>max</sub>", "SCALE"];
      let roTxt = [res.loadTxt, `${fmt(pk.M)} kN·m`, `${fmt(pk.d * 1000, 2)} mm`, `変形 ×${Math.round(res.amp)}`];
      if (st.load === "m") {
        const M = modes(md)[st.mode];
        lab = ["MODE", "固有周期 T", "振動数 f", "SCALE"];
        roTxt = [`${st.mode + 1}次モード`, `${fmt(M.T, 3)} s`, `${fmt(1 / M.T, 2)} Hz`, "形のみ（振幅は任意）"];
      } else if (st.load === "b") {
        const b = st.brk;
        lab = ["LOAD", "破断した部材", "δ<sub>max</sub>", "崩壊荷重 P<sub>u</sub>"];
        roTxt = [res.loadTxt, b ? `${b.broken.length} 本` : "—", !b ? "—" : b.phase === "ramp" ? `${fmt(pk.d * 1000, 1)} mm` : "∞（崩壊）", b && b.Pu ? `${fmt(b.Pu, 0)} kN` : "—"];
      }
      const joined = roTxt.join("|") + lab.join("|");
      if (joined !== roLast) {
        roLast = joined;
        ro.load.textContent = roTxt[0]; ro.m.textContent = roTxt[1]; ro.d.textContent = roTxt[2]; ro.s.textContent = roTxt[3];
        roL.forEach((el, i) => { el.innerHTML = lab[i]; });
      }
    }

    const disp = (k, amp) => {
      const [a1, b1, c1] = st.md.dof[k], u = st.u;
      return [a1 < 0 ? 0 : u[a1] * amp, b1 < 0 ? 0 : u[b1] * amp, c1 < 0 ? 0 : u[c1] * amp];
    };

    // 色を混ぜる（#rrggbb どうし）
    const mix = (a, b, t) => {
      const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return t > 0.5 ? b : a;
      const A = p(a), B = p(b);
      return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
    };
    // 破断した部材：赤い破線で落ちていく
    function drawBroken(brk, P2, amp) {
      const { col, md } = st, now = performance.now();
      ctx.setLineDash([6, 4]); ctx.strokeStyle = col.acc; ctx.lineWidth = 2.4;
      brk.broken.forEach(({ el, t }) => {
        const e = md.els[el], tb = (now - t) / 1000;
        if (tb > 1.6) return;
        const A = md.nodes[e.i], B = md.nodes[e.j], da = disp(e.i, amp), db = disp(e.j, amp);
        const pa = P2(A.x + da[0], A.y + da[1], A.z + da[2]), pb = P2(B.x + db[0], B.y + db[1], B.z + db[2]);
        const dy = 260 * tb * tb, rot = tb * 0.8;
        const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2 + dy, hx = (pb[0] - pa[0]) / 2, hy = (pb[1] - pa[1]) / 2;
        const c = Math.cos(rot), s = Math.sin(rot);
        ctx.globalAlpha = Math.max(0, 1 - tb / 1.6);
        ctx.beginPath(); ctx.moveTo(mx - (hx * c - hy * s), my - (hx * s + hy * c)); ctx.lineTo(mx + (hx * c - hy * s), my + (hx * s + hy * c)); ctx.stroke();
      });
      ctx.globalAlpha = 1; ctx.setLineDash([]);
    }
    // 引っぱる力・壊す荷重の矢印。該当しないときは null
    function specialLoad(at) {
      const { md } = st;
      if (st.drag) {
        const [X, Y] = at(st.drag.k), [Fx, Fy] = st.drag.F, m = Math.hypot(Fx, Fy);
        if (m > 0.5) {
          const dx = Fx / m, dy = -Fy / m, L = 26 + Math.min(40, m / 15);
          arrow(X - dx * L, Y - dy * L, X - dx * 4, Y - dy * 4);
          ctx.textAlign = "center"; ctx.fillText(`F=${fmt(m, 0)}kN`, X - dx * (L + 16), Y - dy * (L + 16));
        }
        ctx.beginPath(); ctx.arc(X, Y, 6, 0, Math.PI * 2); ctx.stroke();
        return `F=${fmt(m, 0)}kN @ ${where(md.nodes[st.drag.k])}`;
      }
      if (st.load === "m") return "";
      if (st.load === "b") {
        if (!st.brk) return "—";
        const [X, Y] = at(st.brk.k), len = 30 + Math.min(50, st.brk.P / (st.brk.rate * 0.12));
        arrow(X, Y - len - 4, X, Y - 4);
        ctx.textAlign = "center"; ctx.fillText(`P=${fmt(st.brk.P, 0)}kN`, X, Y - len - 14);
        return `P=${fmt(st.brk.P, 0)}kN @ ${where(md.nodes[st.brk.k])}`;
      }
      return null;
    }

    /* 平面の架構：正面図に応力図を重ねる */
    function draw2(t, s) {
      const { col, md } = st;
      const { nodes, els, pre } = md;
      const u = st.u, R = refNow(), { x0, x1, y1 } = md.box, span = x1 - x0;
      const small = st.W < 520, brk = st.load === "b" ? st.brk : null;
      const sx = (x) => st.ox + x * st.k, sy = (y) => st.oy - y * st.k;
      if (st.edit) editGrid(sx, sy);

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

      // 応力図（引張側に描く）。壊してみるでは描かない
      const refV = R[st.dia] || 1;
      const elsDia = brk ? [] : els;
      const sc = (st.dia === "M" ? 0.13 : 0.08) * span / refV;
      let peak = { v: 0 };
      ctx.fillStyle = col.accSoft; ctx.strokeStyle = col.acc; ctx.lineWidth = 1.3;
      elsDia.forEach((e) => {
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

      // 変形（倍率をかけて誇張表示）。壊してみるでは検定比で色を付け、破断した部材は落とす
      const amp = ampOf(md);
      ctx.strokeStyle = col.ink; ctx.lineWidth = 2.4;
      els.forEach((e, idx) => {
        const A = nodes[e.i], B = nodes[e.j], da = disp(e.i, amp), db = disp(e.j, amp);
        if (brk) {
          if (!brk.alive[idx]) return;
          const r = Math.min(1, util(md, u, e));
          ctx.strokeStyle = r > 0.5 ? mix(col.ink, col.acc, (r - 0.5) * 2) : col.ink; ctx.lineWidth = 2 + 3 * r * r;
        }
        ctx.beginPath(); ctx.moveTo(sx(A.x + da[0]), sy(A.y + da[1])); ctx.lineTo(sx(B.x + db[0]), sy(B.y + db[1])); ctx.stroke();
      });
      if (brk) drawBroken(brk, (x, y, z) => [sx(x), sy(y)], amp);

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
      let loadTxt = "";
      const spec = specialLoad((k) => { const nd = nodes[k], d = disp(k, amp); return [sx(nd.x + d[0]), sy(nd.y + d[1])]; });
      if (spec !== null) loadTxt = spec;
      else if (st.load === "v") {
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
      if (st.edit) editOverlay(sx, sy);
      return { loadTxt, amp };
    }

    /* 描くモード：グリッド・引きかけの線・不安定なときの表示 */
    function editGrid(sx, sy) {
      const { col } = st, b = PRESETS.draw.box;
      ctx.fillStyle = col.line;
      for (let x = b.x0; x <= b.x1; x++) for (let y = b.y0; y <= b.y1; y++) ctx.fillRect(sx(x) - 1, sy(y) - 1, 2, 2);
    }
    function editOverlay(sx, sy) {
      const { col } = st, e = st.edit;
      if (!e) return;
      ctx.strokeStyle = col.acc; ctx.fillStyle = col.acc; ctx.lineWidth = 2.4;
      if (e.cur) {
        ctx.setLineDash([7, 5]);
        ctx.beginPath(); ctx.moveTo(sx(e.cur.a[0]), sy(e.cur.a[1])); ctx.lineTo(sx(e.cur.b[0]), sy(e.cur.b[1])); ctx.stroke();
        ctx.setLineDash([]);
        const L = Math.hypot(e.cur.b[0] - e.cur.a[0], e.cur.b[1] - e.cur.a[1]);
        if (L) { ctx.font = `600 11px "IBM Plex Mono", monospace`; ctx.textAlign = "center"; ctx.fillText(`${fmt(L * 1000, 0)}`, (sx(e.cur.a[0]) + sx(e.cur.b[0])) / 2, (sy(e.cur.a[1]) + sy(e.cur.b[1])) / 2 - 12); }
        [e.cur.a, e.cur.b].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(sx(x), sy(y), 4, 0, Math.PI * 2); ctx.fill(); });
      } else if (e.hov && (st.md.unstable || st.load === "v" || st.load === "h")) {
        ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(sx(e.hov[0]), sy(e.hov[1]), 6, 0, Math.PI * 2); ctx.stroke();
      }
    }
    function drawEdit() {
      const { col, dpr } = st, b = PRESETS.draw.box, small = st.W < 520;
      const sx = (x) => st.ox + x * st.k, sy = (y) => st.oy - y * st.k;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, st.W, st.H);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      if (st.edit) editGrid(sx, sy);
      ctx.strokeStyle = col.ink3; ctx.lineWidth = 1; ctx.setLineDash([14, 4, 2, 4]);
      ctx.beginPath(); ctx.moveTo(sx(b.x0) - 14, sy(0)); ctx.lineTo(sx(b.x1) + 18, sy(0)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `500 ${small ? 9 : 11}px "IBM Plex Mono", monospace`; ctx.textBaseline = "middle"; ctx.textAlign = "left";
      ctx.fillStyle = col.ink3; ctx.fillText("GL", sx(b.x1) + 22, sy(0));
      const L = st.edit ? PRESETS.draw.lines : [];
      ctx.strokeStyle = col.acc; ctx.lineWidth = 2.4; ctx.setLineDash([6, 4]);
      L.forEach(([a, c]) => { ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(c[0]), sy(c[1])); ctx.stroke(); });
      ctx.setLineDash([]);
      editOverlay(sx, sy);
      const cur = st.edit && st.edit.cur;
      const main = !st.edit ? "この形では不安定です。パラメータを戻してください" : cur ? "離したところまで部材を引きます" : L.length ? "不安定です。GL（地面）までつないでください" : "線を引いて、構造をつくってください";
      ctx.textBaseline = "alphabetic";
      ctx.font = `600 ${small ? 12 : 14}px "IBM Plex Mono", "Noto Sans JP", monospace`;
      ctx.fillStyle = (L.length || !st.edit) && !cur ? col.acc : col.ink; ctx.fillText(main, 14, small ? 22 : 26);
      ctx.font = `400 ${small ? 9.5 : 11}px "Noto Sans JP", monospace`;
      ctx.fillStyle = col.ink3; ctx.fillText(st.edit ? "ドラッグで部材を引きます。1m グリッドに吸着し、GL 上の点は固定端になります" : "支点や部材のつながりが足りず、つり合いがとれません", 14, small ? 38 : 44);
      ctx.textBaseline = "middle";
      const lab = ["LOAD", "部材", "状態", "SCALE"], txt = ["—", `${L.length} 本`, L.length ? "不安定" : "—", "—"];
      ro.load.textContent = txt[0]; ro.m.textContent = txt[1]; ro.d.textContent = txt[2]; ro.s.textContent = txt[3];
      roL.forEach((el, i) => { el.innerHTML = lab[i]; });
      roLast = "";
    }

    /* 空間構造：回転する立体図。部材を応力で色分けする */
    function draw3(t, s) {
      const { col, md } = st;
      const { nodes, els } = md;
      const u = st.u, R = refNow(), small = st.W < 520, brk = st.load === "b" ? st.brk : null;
      const amp = ampOf(md);
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
      const list = els.filter((_, idx) => !brk || brk.alive[idx]).map((e) => {
        const A = nodes[e.i], B = nodes[e.j], da = disp(e.i, amp), db = disp(e.j, amp);
        const pa = proj(A.x + da[0], A.y + da[1], A.z + da[2]), pb = proj(B.x + db[0], B.y + db[1], B.z + db[2]);
        if (brk) return { e, pa, pb, v: Math.min(1, util(md, u, e)), d: (pa[2] + pb[2]) / 2, util: true };
        const r = forces(md, u, e), v = st.dia === "M" ? r.Mmax : st.dia === "Q" ? Math.abs(r.Q) : r.N;
        return { e, pa, pb, v, d: (pa[2] + pb[2]) / 2 };
      }).sort((a, b) => b.d - a.d);
      const dmax = md.rad;
      let peak = null;
      // 太い部材（ロゴ）は先に全部塗ってから応力を重ねる
      if (md.pre.bar) {
        ctx.strokeStyle = col.ink; ctx.lineWidth = md.pre.bar * st.k; ctx.lineCap = "square";
        list.forEach(({ pa, pb }) => { ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke(); });
        ctx.lineCap = "round";
      }
      list.forEach(({ pa, pb, v, d, util: isU }) => {
        const f = isU ? (v > 0.3 ? (v - 0.3) / 0.7 : 0) : Math.min(1, Math.abs(v) / refV);
        const fade = 0.55 + 0.45 * (1 - (d + dmax) / (2 * dmax));
        ctx.globalAlpha = fade;
        if (!md.pre.bar) {
          ctx.strokeStyle = col.line; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
        }
        if (f > 0.02) {
          ctx.globalAlpha = fade * (0.25 + 0.75 * f);
          ctx.strokeStyle = st.dia === "N" && v < 0 ? col.blue : col.acc;
          ctx.lineWidth = md.pre.bar ? 2 + md.pre.bar * st.k * 0.5 * f : 1 + 3.2 * f;
          if (md.pre.bar) ctx.globalAlpha = 0.35 + 0.65 * f;
          ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
        }
        if (!isU && (!peak || Math.abs(v) > Math.abs(peak.v))) peak = { v, x: (pa[0] + pb[0]) / 2, y: (pa[1] + pb[1]) / 2 };
      });
      ctx.globalAlpha = 1;
      if (brk) drawBroken(brk, proj, amp);
      // ロゴの ▶
      if (md.pre.bar && !brk) {
        const [X, Y] = proj(0, md.pre.p.H - 1.4, 0), h = md.pre.bar * st.k * 0.62;
        ctx.fillStyle = col.ink;
        ctx.beginPath(); ctx.moveTo(X + h * 1.3, Y - h); ctx.lineTo(X + h * 1.3, Y + h); ctx.lineTo(X + h * 3, Y); ctx.closePath(); ctx.fill();
      }

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
      const lg = brk ? [[col.acc, "検定比（太く赤いほど限界に近い）"]] : st.dia === "N" ? [[col.acc, "引張"], [col.blue, "圧縮"]] : [[col.acc, st.dia === "M" ? "曲げモーメントの大きさ" : "せん断力の大きさ"]];
      lg.forEach(([c, l], i) => {
        const y = st.H - 16 - i * 16;
        ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(34, y); ctx.stroke();
        ctx.fillStyle = col.ink2; ctx.fillText(l, 40, y);
      });
      ctx.textAlign = "right"; ctx.fillStyle = col.ink3;
      ctx.fillText(md.pre.still ? "ロゴのアイソメ図と同じ向き" : st.hover || st.drag ? "回転を止めています" : "ゆっくり回転中", st.W - 12, st.H - 16);

      // 荷重の矢印
      ctx.strokeStyle = col.acc; ctx.fillStyle = col.acc; ctx.lineWidth = 2.2; ctx.textAlign = "center";
      ctx.font = `600 ${small ? 10 : 12}px "IBM Plex Mono", monospace`;
      let loadTxt = "";
      const spec = specialLoad((k) => { const nd = nodes[k], d = disp(k, amp); return proj(nd.x + d[0], nd.y + d[1], nd.z + d[2]); });
      if (spec !== null) loadTxt = spec;
      else if (st.load === "v") {
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

  /* ───────────────────── このページを地震で揺らす ─────────────────────
   * 各セクションを 1 層とみなした 9 層のせん断型モデル。
   * 模擬地震波を入力して時刻歴応答（モード重ね合わせ＋ニューマーク β 法）を求め、
   * セクションを各階の変位どおりに動かす。免震では最下層に積層ゴムの層を足す。
   */
  const quake = (() => {
    const btn = $(".quake-btn"), panel = $("#quake"), cv = $("#q-cv"), qx = cv.getContext("2d");
    const secs = [...document.querySelectorAll("main > section")].reverse();   // 1F（事務所）→ 9F（トップ）
    const NAMES = { office: "事務所", services: "業務", record: "受賞・掲載", index: "部材リスト", process: "建方", works: "作品", about: "理念" };
    const names = secs.map((el) => NAMES[el.id] || (el.classList.contains("ticks") ? "数字" : "トップ"));
    const H = 4;            // 階高 m
    const DT = 0.01, DUR = 26;
    const st = { on: false, iso: false, res: null, t0: 0, raf: 0, scale: 1 };

    // 乱数（毎回同じ波になるよう種を固定）
    const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    // 模擬地震波：白色雑音を地盤（金井・田治見型）と長周期カットのフィルタに通し、包絡線をかける。最大 350 gal
    const wave = (() => {
      const r = rng(1995), n = Math.round(DUR / DT), a = new Float64Array(n);
      const wg = 9, zg = 0.5, wf = 1.2, zf = 0.6;
      let x = 0, v = 0, y = 0, w = 0;
      for (let i = 0; i < n; i++) {
        const t = i * DT, g = Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
        const acc = -g * 30 - 2 * zg * wg * v - wg * wg * x; v += acc * DT; x += v * DT;
        const ag = -(2 * zg * wg * v + wg * wg * x);
        const acc2 = ag - 2 * zf * wf * w - wf * wf * y; w += acc2 * DT; y += w * DT;
        const env = t < 2 ? (t / 2) ** 2 : t < 10 ? 1 : Math.exp(-0.25 * (t - 10));
        a[i] = acc2 * env;   // 高域通過後の加速度
      }
      let mx = 0; a.forEach((v_) => { mx = Math.max(mx, Math.abs(v_)); });
      return a.map((v_) => (v_ / mx) * 3.5);
    })();

    // 対称な固有値問題（ヤコビ法）
    const jacobi = (A) => {
      const n = A.length, V = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)));
      for (let sw = 0; sw < 60; sw++) {
        let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
        if (off < 1e-18) break;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          if (Math.abs(A[i][j]) < 1e-30) continue;
          const th = 0.5 * Math.atan2(2 * A[i][j], A[j][j] - A[i][i]), c = Math.cos(th), s = Math.sin(th);
          for (let k = 0; k < n; k++) { const a = A[k][i], b = A[k][j]; A[k][i] = c * a - s * b; A[k][j] = s * a + c * b; }
          for (let k = 0; k < n; k++) { const a = A[i][k], b = A[j][k]; A[i][k] = c * a - s * b; A[j][k] = s * a + c * b; }
          for (let k = 0; k < n; k++) { const a = V[k][i], b = V[k][j]; V[k][i] = c * a - s * b; V[k][j] = s * a + c * b; }
        }
      }
      return { w2: A.map((r, i) => r[i]), V };
    };

    // 応答を計算する（各階の地面に対する変位の時刻歴）
    const solve = (iso) => {
      const hs = secs.map((el) => el.offsetHeight), avg = hs.reduce((a, b) => a + b, 0) / hs.length;
      const m = hs.map((h) => 400 * Math.min(2, Math.max(0.6, h / avg)));   // t：セクションの高さに比例
      const N = secs.length;
      // 剛性は上ほど小さく、1次周期が 1.0 秒になるように合わせる
      let k = m.map((_, i) => 1 - 0.55 * (i / N));
      const build = (kk, mm) => {
        const n = mm.length, K = mm.map(() => new Array(n).fill(0));
        for (let i = 0; i < n; i++) { K[i][i] += kk[i]; if (i > 0) { K[i - 1][i - 1] += kk[i]; K[i - 1][i] -= kk[i]; K[i][i - 1] -= kk[i]; } }
        return jacobi(K.map((r, i) => r.map((v, j) => v / Math.sqrt(mm[i] * mm[j]))));
      };
      const w1 = Math.min(...build(k, m).w2);
      k = k.map((v) => v * ((2 * Math.PI / 1.0) ** 2 / w1));
      let mm = m, kk = k, zeta = () => 0.03;
      if (iso) {
        // 免震層：基礎上の床 600t、全体で周期 4 秒、減衰 20%
        const Mt = m.reduce((a, b) => a + b, 0) + 600;
        mm = [600, ...m]; kk = [(2 * Math.PI / 4) ** 2 * Mt, ...k];
        zeta = (i) => (i === 0 ? 0.2 : 0.03);
      }
      const n = mm.length, { w2, V } = build(kk, mm);
      const order = w2.map((_, i) => i).sort((a, b) => w2[a] - w2[b]);
      const steps = wave.length, U = Array.from({ length: n }, () => new Float32Array(steps));
      order.forEach((mi, rank) => {
        const w = Math.sqrt(w2[mi]), phi = V.map((r, i) => r[mi] / Math.sqrt(mm[i]));
        const Mn = phi.reduce((a, p, i) => a + mm[i] * p * p, 0), Ln = phi.reduce((a, p, i) => a + mm[i] * p, 0), G = Ln / Mn;
        const z = zeta(rank), c = 2 * z * w, kq = w * w;
        // ニューマーク β 法（平均加速度）
        const b = 0.25, gm = 0.5, ke = kq + gm / (b * DT) * c + 1 / (b * DT * DT);
        let q = 0, qd = 0, qa = -G * wave[0];
        for (let s = 1; s < steps; s++) {
          const f = -G * wave[s] + (q / (b * DT * DT) + qd / (b * DT) + (1 / (2 * b) - 1) * qa) + c * (gm / (b * DT) * q + (gm / b - 1) * qd + DT * (gm / (2 * b) - 1) * qa);
          const qn = f / ke, qan = (qn - q) / (b * DT * DT) - qd / (b * DT) - (1 / (2 * b) - 1) * qa;
          qd = qd + DT * ((1 - gm) * qa + gm * qan); q = qn; qa = qan;
          for (let i = 0; i < n; i++) U[i][s] += phi[i] * q;
        }
      });
      const off = iso ? 1 : 0, floors = U.slice(off), base = iso ? U[0] : null;
      // 層間変形角の最大値（各層）
      const drift = floors.map((u, i) => { let mx = 0; const lo = i ? floors[i - 1] : base; for (let s = 0; s < steps; s++) mx = Math.max(mx, Math.abs(u[s] - (lo ? lo[s] : 0)) / H); return mx; });
      const roof = floors[floors.length - 1]; let rmax = 0; roof.forEach((v) => { rmax = Math.max(rmax, Math.abs(v)); });
      let bmax = 0; if (base) base.forEach((v) => { bmax = Math.max(bmax, Math.abs(v)); });
      return { floors, base, drift, rmax, bmax, T1: 2 * Math.PI / Math.sqrt(w2[order[0]]) };
    };

    let ref = null;   // 表示の倍率の基準：耐震・免震で大きいほうの屋上の最大変位
    const run = () => {
      st.res = solve(st.iso);
      ref ||= { rmax: Math.max(solve(false).rmax, solve(true).rmax) };
      st.scale = 70 / ref.rmax;             // px/m：屋上の最大変位が 70px
      st.t0 = performance.now(); st.on = true;
      panel.querySelectorAll("[data-q]").forEach((b) => b.classList.toggle("on", (b.dataset.q === "iso") === st.iso));
      document.documentElement.classList.add("quaking");
      cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(tick);
    };
    const place = (s) => {
      if (reduceMotion) return;
      const { floors, base } = st.res;
      secs.forEach((el, i) => {
        if (s < 0) { el.style.transform = ""; return; }
        const u = floors[i][s], lo = i ? floors[i - 1][s] : base ? base[s] : 0;
        const x = Math.max(-100, Math.min(100, ((u + lo) / 2) * st.scale));
        const sk = Math.max(-6, Math.min(6, (-(u - lo) / H) * 520));   // 層間変形角 1/100 で約 3°
        el.style.transform = `translateX(${x.toFixed(1)}px) skewX(${sk.toFixed(2)}deg)`;
      });
    };
    const tick = (now) => {
      const t = (now - st.t0) / 1000, s = Math.min(wave.length - 1, Math.floor(t / DT));
      place(s); paint(s);
      if (t < DUR) st.raf = requestAnimationFrame(tick);
      else { st.on = false; place(-1); paint(wave.length - 1, true); document.documentElement.classList.remove("quaking"); }
    };

    const fmt = (v, d = 1) => v.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d });
    const inv = (r) => (r > 0 ? `1/${Math.round(1 / r)}` : "—");
    // パネル：建物の立面（揺れ）・層間変形角・地震波
    function paint(s, end) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
      if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
      const W = r.width, Hh = r.height, small = W < 600;
      const col = { ink: css("--ink"), ink3: css("--ink-3"), line: css("--line"), acc: css("--acc"), paper: css("--paper"), blue: css("--blue") };
      qx.setTransform(dpr, 0, 0, dpr, 0, 0); qx.clearRect(0, 0, W, Hh);
      qx.lineCap = "round"; qx.lineJoin = "round";
      const { floors, base, drift } = st.res, N = floors.length;
      const mono = (w, z) => `${w} ${z}px "IBM Plex Mono", "Noto Sans JP", monospace`;

      // 立面
      const bw = small ? 64 : 96, bx = 14 + 26, top = 46, bot = Hh - 16, fh = (bot - top - (base ? 8 : 0)) / N;
      const sc = (small ? 22 : 30) / ref.rmax;
      const gx = bx + bw / 2;
      qx.strokeStyle = col.ink3; qx.lineWidth = 1;
      qx.beginPath(); qx.moveTo(bx - 14, bot); qx.lineTo(bx + bw + 14, bot); qx.stroke();
      for (let h = bx - 12; h < bx + bw + 12; h += 6) { qx.beginPath(); qx.moveTo(h, bot); qx.lineTo(h - 5, bot + 6); qx.stroke(); }
      const xb = base ? base[s] * sc : 0, yb = bot - (base ? 8 : 0);
      if (base) {
        qx.strokeStyle = col.acc; qx.beginPath();
        for (let i = 0; i < 5; i++) { const x0 = bx + 6 + i * (bw - 12) / 4; qx.moveTo(x0, bot); qx.lineTo(x0 + xb, yb); }
        qx.stroke();
      }
      let prev = xb;
      // いま画面にある階
      const vis = secs.findIndex((el) => { const b = el.getBoundingClientRect(); return b.top < innerHeight * 0.5 && b.bottom > innerHeight * 0.5; });
      for (let i = 0; i < N; i++) {
        const x = floors[i][s] * sc, y0 = yb - i * fh, y1 = yb - (i + 1) * fh;
        const dr = Math.abs(floors[i][s] - (i ? floors[i - 1][s] : base ? base[s] : 0)) / H;
        qx.fillStyle = i === vis ? col.acc + "33" : "transparent";
        qx.beginPath(); qx.moveTo(bx + prev, y0); qx.lineTo(bx + bw + prev, y0); qx.lineTo(bx + bw + x, y1); qx.lineTo(bx + x, y1); qx.closePath(); qx.fill();
        qx.strokeStyle = dr > 0.01 ? col.acc : col.ink; qx.lineWidth = dr > 0.01 ? 2 : 1.4;
        qx.beginPath(); qx.moveTo(bx + prev, y0); qx.lineTo(bx + x, y1); qx.moveTo(bx + bw + prev, y0); qx.lineTo(bx + bw + x, y1); qx.stroke();
        qx.strokeStyle = col.ink; qx.lineWidth = 1.4; qx.beginPath(); qx.moveTo(bx + x - 3, y1); qx.lineTo(bx + bw + x + 3, y1); qx.stroke();
        qx.fillStyle = col.ink3; qx.font = mono(500, 9); qx.textAlign = "right"; qx.textBaseline = "middle";
        qx.fillText(`${i + 1}F`, bx - 6, (y0 + y1) / 2);
        prev = x;
      }

      // 層間変形角（最大値）
      const dx = bx + bw + (small ? 26 : 40), dw = small ? 70 : 150, dmax = 1 / 80;
      qx.font = mono(500, 9); qx.textAlign = "left"; qx.fillStyle = col.ink3; qx.textBaseline = "alphabetic";
      qx.fillText(small ? "層間変形角" : "最大層間変形角", dx, top - 10);
      qx.strokeStyle = col.ink3; qx.setLineDash([3, 3]);
      const lx = dx + (dw * (1 / 100)) / dmax;
      qx.beginPath(); qx.moveTo(lx, top - 4); qx.lineTo(lx, bot); qx.stroke(); qx.setLineDash([]);
      qx.fillText("1/100", lx + 3, bot - 2);
      for (let i = 0; i < N; i++) {
        const y1 = yb - (i + 1) * fh, w = Math.min(dw, (dw * (end ? drift[i] : runMax(i, s))) / dmax);
        qx.fillStyle = (end ? drift[i] : runMax(i, s)) > 0.01 ? col.acc : col.ink;
        qx.fillRect(dx, y1 + fh * 0.3, w, fh * 0.4);
      }

      // 地震波と屋上の変位
      const L = Hh - top - 6, wx = dx + dw + (small ? 14 : 34), ww = W - wx - 14, wy = top + L * 0.26, wh = L * 0.2;
      if (ww > 60) {
        const n = wave.length, px = (i) => wx + (i / (n - 1)) * ww;
        qx.strokeStyle = col.line; qx.lineWidth = 1; qx.beginPath();
        for (let i = 0; i < n; i += 2) { const y = wy - (wave[i] / 3.5) * wh; i ? qx.lineTo(px(i), y) : qx.moveTo(px(i), y); }
        qx.stroke();
        qx.strokeStyle = col.ink; qx.beginPath();
        for (let i = 0; i <= s; i += 2) { const y = wy - (wave[i] / 3.5) * wh; i ? qx.lineTo(px(i), y) : qx.moveTo(px(i), y); }
        qx.stroke();
        const ry = top + L * 0.76, roof = floors[N - 1];
        qx.strokeStyle = col.acc; qx.lineWidth = 1.6; qx.beginPath();
        for (let i = 0; i <= s; i += 2) { const y = ry - (roof[i] / ref.rmax) * wh; i ? qx.lineTo(px(i), y) : qx.moveTo(px(i), y); }
        qx.stroke();
        qx.strokeStyle = col.acc; qx.lineWidth = 1; qx.beginPath(); qx.moveTo(px(s), top - 2); qx.lineTo(px(s), Hh - 10); qx.stroke();
        qx.font = mono(500, 9); qx.fillStyle = col.ink3; qx.textAlign = "left";
        qx.fillText(small ? "地動加速度" : "地動加速度（模擬波・最大 350 gal）", wx, wy - wh - 3);
        qx.fillText("屋上の変位", wx, ry - wh - 3);
      }

      // 見出し
      let dm = 0, di = 0; (end ? drift : drift.map((_, i) => runMax(i, s))).forEach((v, i) => { if (v > dm) { dm = v; di = i; } });
      qx.textAlign = "left"; qx.textBaseline = "alphabetic"; qx.font = mono(600, small ? 11 : 13);
      qx.fillStyle = dm > 0.01 ? col.acc : col.ink;
      const head = end
        ? `${st.iso ? "免震" : "耐震"}：最大層間変形角 ${inv(dm)}（${di + 1}F ${names[di]}）${st.iso ? `　免震層 ${fmt(st.res.bmax * 100, 0)}cm` : ""}`
        : `t = ${fmt(s * DT, 1)} s　屋上 ${fmt(floors[N - 1][s] * 100, 1)} cm`;
      qx.fillText(head, 14, 18);
      if (!small) {
        qx.textAlign = "right"; qx.font = mono(400, 10); qx.fillStyle = col.ink3;
        qx.fillText(`このページ＝9層の建物　1次周期 ${fmt(st.res.T1, 2)} s`, W - 14, 18);
      }
    }
    // s ステップまでの層間変形角の最大（表示用に間引いて求める）
    const runCache = new Map();
    function runMax(i, s) {
      const key = `${st.iso}|${i}`, { floors, base } = st.res;
      let c = runCache.get(key); if (!c || c.res !== st.res) { c = { res: st.res, s: 0, v: 0 }; runCache.set(key, c); }
      if (s < c.s) { c.s = 0; c.v = 0; }
      const lo = i ? floors[i - 1] : base;
      for (; c.s <= s; c.s++) c.v = Math.max(c.v, Math.abs(floors[i][c.s] - (lo ? lo[c.s] : 0)) / H);
      return c.v;
    }

    btn.addEventListener("click", () => { panel.hidden = false; btn.setAttribute("aria-expanded", "true"); run(); });
    panel.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => { st.iso = b.dataset.q === "iso"; run(); }));
    $(".q-again").addEventListener("click", run);
    $(".q-close").addEventListener("click", () => {
      cancelAnimationFrame(st.raf); st.on = false; if (st.res) place(-1);
      document.documentElement.classList.remove("quaking");
      panel.hidden = true; btn.setAttribute("aria-expanded", "false");
    });
    addEventListener("resize", () => { if (!panel.hidden && st.res && !st.on) paint(wave.length - 1, true); });
    return {};
  })();

  const d = new Date();
  $("#tb-date").textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
})();
