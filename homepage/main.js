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
    const COL = { A: 2.8e-2, I: 4.0e-4 };
    const BEAM = { A: 1.2e-2, I: 5.0e-4 };
    const XS = [0, 6.0, 13.2, 19.2];          // 通り芯 X1〜X4
    const CANT = 2.4;                          // R階の片持ち
    const LV = [0, 4.2, 7.8];                  // 1FL, 2FL, RFL
    const LV_NAME = ["1FL", "2FL", "RFL"];
    const P = 100;                             // 鉛直集中荷重
    const QH = [0, 80, 120];                   // 各階の水平力（地震）

    const nodes = [];
    const key = new Map();
    const node = (x, y) => {
      const k = x.toFixed(3) + "," + y.toFixed(3);
      if (!key.has(k)) { key.set(k, nodes.length); nodes.push({ x, y, fixed: y === 0 }); }
      return key.get(k);
    };
    const els = [];
    const member = (x1, y1, x2, y2, n, sec, kind, label) => {
      let prev = node(x1, y1);
      for (let i = 1; i <= n; i++) {
        const cur = node(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n);
        els.push({ i: prev, j: cur, ...sec, kind, label });
        prev = cur;
      }
    };
    for (let s = 0; s < LV.length - 1; s++)
      XS.forEach((x) => member(x, LV[s], x, LV[s + 1], 4, COL, "col"));
    for (let f = 1; f < LV.length; f++)
      for (let b = 0; b < XS.length - 1; b++)
        member(XS[b], LV[f], XS[b + 1], LV[f], 8, BEAM, "beam", { f, b });
    member(XS[3], LV[2], XS[3] + CANT, LV[2], 3, BEAM, "beam", { f: 2, b: 3 });

    els.forEach((e) => {
      const a = nodes[e.i], b = nodes[e.j];
      e.L = Math.hypot(b.x - a.x, b.y - a.y);
      e.c = (b.x - a.x) / e.L; e.s = (b.y - a.y) / e.L;
    });

    // 自由度番号
    const dof = [];
    let n = 0;
    nodes.forEach((nd, k) => { dof[k] = nd.fixed ? [-1, -1, -1] : [n++, n++, n++]; });

    const localK = (e) => {
      const { L } = e, EA = E * e.A / L, EI = E * e.I;
      const a = 12 * EI / L ** 3, b = 6 * EI / L ** 2, c = 4 * EI / L, d = 2 * EI / L;
      return [
        [EA, 0, 0, -EA, 0, 0],
        [0, a, b, 0, -a, b],
        [0, b, c, 0, -b, d],
        [-EA, 0, 0, EA, 0, 0],
        [0, -a, -b, 0, a, -b],
        [0, b, d, 0, -b, c],
      ];
    };
    const toLocal = (e, g) => {   // T·g（6成分）
      const { c, s } = e;
      return [c * g[0] + s * g[1], -s * g[0] + c * g[1], g[2], c * g[3] + s * g[4], -s * g[3] + c * g[4], g[5]];
    };
    els.forEach((e) => { e.k = localK(e); e.map = [...dof[e.i], ...dof[e.j]]; });

    // 全体剛性マトリクスの組み立て
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

    // 部材の応力（N, Q, M：i端・j端）
    const forces = (u, e) => {
      const g = e.map.map((d) => (d < 0 ? 0 : u[d]));
      const ul = toLocal(e, g), f = e.k.map((row) => row.reduce((s, v, t) => s + v * ul[t], 0));
      return { N: -f[0], Q: f[1], Mi: -f[2], Mj: f[5] };
    };
    const peaks = (u) => {
      let M = 0, Q = 0, N = 0, d = 0;
      els.forEach((e) => {
        const r = forces(u, e);
        M = Math.max(M, Math.abs(r.Mi), Math.abs(r.Mj)); Q = Math.max(Q, Math.abs(r.Q)); N = Math.max(N, Math.abs(r.N));
      });
      nodes.forEach((nd, k) => { const [a, b] = dof[k]; if (a >= 0) d = Math.max(d, Math.hypot(u[a], u[b])); });
      return { M, Q, N, d };
    };

    // 鉛直荷重：梁上の全節点について解いておく
    const beamNodes = [...new Set(els.filter((e) => e.kind === "beam").flatMap((e) => [e.i, e.j]))];
    const vCase = new Map();
    beamNodes.forEach((k) => { const F = new Float64Array(n); F[dof[k][1]] = -P; vCase.set(k, solve(F)); });
    // 地震力：各階の柱頭に等分配
    const F = new Float64Array(n);
    for (let f = 1; f < LV.length; f++) XS.forEach((x) => { F[dof[key.get(x.toFixed(3) + "," + LV[f].toFixed(3))][0]] += QH[f] / XS.length; });
    const hCase = solve(F);

    // 表示スケールの基準（荷重位置で図の大きさが変わるよう、ケースごとに固定）
    const ref = { v: { M: 0, Q: 0, N: 0, d: 0 }, h: peaks(hCase) };
    vCase.forEach((u) => { const p = peaks(u); for (const k in p) ref.v[k] = Math.max(ref.v[k], p[k]); });

    /* ── 状態 ── */
    const st = {
      load: "v", dia: "M",
      target: beamNodes[0], hover: false, t0: performance.now(),
      u: new Float64Array(n), visible: true, W: 0, H: 0, dpr: 1, k: 1, ox: 0, oy: 0, col: {},
    };
    const roofNodes = beamNodes.filter((k) => nodes[k].y === LV[2]).sort((a, b) => nodes[a].x - nodes[b].x);
    st.target = roofNodes[Math.floor(roofNodes.length * 0.3)];

    const recolor = () => {
      st.col = { ink: css("--ink"), ink2: css("--ink-2"), ink3: css("--ink-3"), line: css("--line"), acc: css("--acc"), accSoft: css("--acc-soft"), blue: css("--blue"), paper: css("--paper") };
      if (reduceMotion) draw(performance.now());
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      st.dpr = Math.min(window.devicePixelRatio || 1, 2);
      st.W = r.width; st.H = r.height;
      canvas.width = Math.round(r.width * st.dpr); canvas.height = Math.round(r.height * st.dpr);
      const small = r.width < 520;
      const pl = small ? 22 : 48, pr = small ? 40 : 64, pt = small ? 64 : 84, pb = small ? 46 : 58;
      const wx = XS[3] + CANT, wy = LV[2];
      st.k = Math.min((r.width - pl - pr) / wx, (r.height - pt - pb) / wy);
      st.ox = pl + ((r.width - pl - pr) - wx * st.k) / 2;
      st.oy = r.height - pb - ((r.height - pt - pb) - wy * st.k) / 2;
      if (reduceMotion) draw(performance.now());
    };
    const sx = (x) => st.ox + x * st.k;
    const sy = (y) => st.oy - y * st.k;

    // 入力：一番近い梁上の節点に荷重を移す
    const pick = (ev) => {
      const r = canvas.getBoundingClientRect();
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      let best = st.target, bd = Infinity;
      beamNodes.forEach((k) => {
        const d = (sx(nodes[k].x) - px) ** 2 + ((sy(nodes[k].y) - py) * 1.6) ** 2;
        if (d < bd) { bd = d; best = k; }
      });
      st.target = best; st.hover = true;
      if (st.load !== "v") setLoad("v");
      if (reduceMotion) { st.u = Float64Array.from(vCase.get(best)); draw(performance.now()); }
    };
    canvas.addEventListener("pointermove", pick);
    canvas.addEventListener("pointerdown", pick);
    canvas.addEventListener("pointerleave", () => { st.hover = false; st.t0 = performance.now(); });

    const setLoad = (l) => {
      st.load = l;
      document.querySelectorAll("[data-load]").forEach((b) => b.classList.toggle("on", b.dataset.load === l));
      if (reduceMotion) { st.u = Float64Array.from(l === "v" ? vCase.get(st.target) : hCase); draw(performance.now()); }
    };
    document.querySelectorAll("[data-load]").forEach((b) => b.addEventListener("click", () => setLoad(b.dataset.load)));
    document.querySelectorAll("[data-dia]").forEach((b) => b.addEventListener("click", () => {
      st.dia = b.dataset.dia;
      document.querySelectorAll("[data-dia]").forEach((x) => x.classList.toggle("on", x === b));
      if (reduceMotion) draw(performance.now());
    }));

    // 目標の変位（時間で動かす：自動デモ・地震の揺れ）
    const targetU = (t) => {
      if (st.load === "h") {
        const s = reduceMotion ? 1 : Math.sin((t - st.t0) / 1000 * Math.PI * 1.25);
        return { u: hCase, s };
      }
      if (!st.hover && !reduceMotion) {
        const ph = ((t - st.t0) / 7000) % 2, f = ph < 1 ? ph : 2 - ph;
        const eased = f * f * (3 - 2 * f);
        st.target = roofNodes[Math.round(eased * (roofNodes.length - 1))];
      }
      return { u: vCase.get(st.target), s: 1 };
    };

    const fmt = (v, d = 1) => v.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d });
    const axisName = (x) => {
      for (let b = 0; b < XS.length; b++) if (Math.abs(x - XS[b]) < 1e-6) return "X" + (b + 1);
      for (let b = 0; b < XS.length - 1; b++) if (x > XS[b] && x < XS[b + 1]) return `X${b + 1}–X${b + 2}`;
      return "X4 片持ち";
    };
    const ro = { load: $("#ro-load"), m: $("#ro-m"), d: $("#ro-d"), s: $("#ro-s") };
    let roLast = "";

    function draw(t) {
      const { col, dpr } = st;
      const { u: tu, s } = targetU(t);
      // ばねのように追従させる
      const a = reduceMotion ? 1 : 0.18;
      for (let i = 0; i < n; i++) st.u[i] += (tu[i] * s - st.u[i]) * a;
      const u = st.u, R = ref[st.load];

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, st.W, st.H);
      ctx.lineCap = "round"; ctx.lineJoin = "round";

      // 通り芯（一点鎖線）と符号
      ctx.font = `500 ${st.W < 520 ? 9 : 11}px "IBM Plex Mono", monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeStyle = col.line; ctx.lineWidth = 1;
      ctx.setLineDash([14, 4, 2, 4]);
      const topY = sy(LV[2]) - (st.W < 520 ? 34 : 46);
      XS.forEach((x) => { ctx.beginPath(); ctx.moveTo(sx(x), topY + 11); ctx.lineTo(sx(x), st.oy + 8); ctx.stroke(); });
      LV.forEach((y) => { ctx.beginPath(); ctx.moveTo(sx(0) - 14, sy(y)); ctx.lineTo(sx(XS[3] + CANT) + 18, sy(y)); ctx.stroke(); });
      ctx.setLineDash([]);
      const br = st.W < 520 ? 9 : 11;
      XS.forEach((x, i) => {
        ctx.beginPath(); ctx.arc(sx(x), topY, br, 0, Math.PI * 2);
        ctx.fillStyle = col.paper; ctx.fill(); ctx.strokeStyle = col.ink; ctx.stroke();
        ctx.fillStyle = col.ink; ctx.fillText("X" + (i + 1), sx(x), topY + 0.5);
      });
      ctx.textAlign = "left"; ctx.fillStyle = col.ink3;
      LV.forEach((y, i) => ctx.fillText(LV_NAME[i], sx(XS[3] + CANT) + 22, sy(y) - (i === 0 ? 0 : 7)));

      // 寸法線
      const dimY = st.oy + (st.W < 520 ? 26 : 32);
      ctx.strokeStyle = col.ink3; ctx.fillStyle = col.ink2; ctx.textAlign = "center";
      const dims = [...XS, XS[3] + CANT];
      ctx.beginPath(); ctx.moveTo(sx(0), dimY); ctx.lineTo(sx(dims[dims.length - 1]), dimY); ctx.stroke();
      dims.forEach((x, i) => {
        ctx.beginPath(); ctx.moveTo(sx(x) - 4, dimY + 4); ctx.lineTo(sx(x) + 4, dimY - 4); ctx.stroke();
        if (i) ctx.fillText(((x - dims[i - 1]) * 1000).toLocaleString("en-US"), (sx(x) + sx(dims[i - 1])) / 2, dimY - 9);
      });

      // 固定端
      ctx.strokeStyle = col.ink; ctx.lineWidth = 1;
      XS.forEach((x) => {
        const X = sx(x), Y = st.oy;
        ctx.beginPath(); ctx.moveTo(X - 12, Y); ctx.lineTo(X + 12, Y); ctx.stroke();
        for (let h = -10; h <= 10; h += 5) { ctx.beginPath(); ctx.moveTo(X + h, Y); ctx.lineTo(X + h - 5, Y + 6); ctx.stroke(); }
      });

      // 元の架構（細線）
      ctx.strokeStyle = col.line; ctx.lineWidth = 2;
      els.forEach((e) => { ctx.beginPath(); ctx.moveTo(sx(nodes[e.i].x), sy(nodes[e.i].y)); ctx.lineTo(sx(nodes[e.j].x), sy(nodes[e.j].y)); ctx.stroke(); });

      // 応力図
      const span = XS[3] + CANT;
      const refV = R[st.dia] || 1;
      const sc = (st.dia === "M" ? 0.16 : 0.1) * span / refV;     // 値 → ワールド座標の長さ
      let peak = { v: 0, x: 0, y: 0 };
      ctx.fillStyle = col.accSoft; ctx.strokeStyle = col.acc; ctx.lineWidth = 1.4;
      els.forEach((e) => {
        const r = forces(u, e), A = nodes[e.i], B = nodes[e.j];
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
      const amp = (0.055 * span) / (R.d || 1);
      ctx.strokeStyle = col.ink; ctx.lineWidth = 2.6;
      const dp = (k) => { const [a1, b1] = dof[k]; return a1 < 0 ? [0, 0] : [u[a1] * amp, u[b1] * amp]; };
      els.forEach((e) => {
        const A = nodes[e.i], B = nodes[e.j], da = dp(e.i), db = dp(e.j);
        ctx.beginPath(); ctx.moveTo(sx(A.x + da[0]), sy(A.y + da[1])); ctx.lineTo(sx(B.x + db[0]), sy(B.y + db[1])); ctx.stroke();
      });
      // 節点（柱梁接合部）
      ctx.fillStyle = col.ink;
      XS.forEach((x) => LV.slice(1).forEach((y) => {
        const k = key.get(x.toFixed(3) + "," + y.toFixed(3)), d = dp(k);
        ctx.fillRect(sx(x + d[0]) - 3, sy(y + d[1]) - 3, 6, 6);
      }));

      // 最大値のラベル
      if (Math.abs(peak.v) > refV * 0.02) {
        const unit = st.dia === "M" ? "kN·m" : "kN";
        const txt = `${st.dia}=${fmt(Math.abs(peak.v))}${unit}`;
        ctx.font = `600 ${st.W < 520 ? 10 : 11.5}px "IBM Plex Mono", monospace`;
        const tw = ctx.measureText(txt).width + 10;
        const X = Math.min(Math.max(sx(peak.x) + peak.dx * (tw / 2 + 4), tw / 2 + 2), st.W - tw / 2 - 2);
        const Y = Math.min(sy(peak.y) - peak.dy * 14, st.oy - 12);
        ctx.fillStyle = col.paper; ctx.fillRect(X - tw / 2, Y - 9, tw, 18);
        ctx.fillStyle = col.acc; ctx.textAlign = "center"; ctx.fillText(txt, X, Y);
      }

      // 荷重の矢印
      ctx.strokeStyle = col.acc; ctx.fillStyle = col.acc; ctx.lineWidth = 2.2;
      const arrow = (x1, y1, x2, y2) => {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 9 * Math.cos(ang - 0.4), y2 - 9 * Math.sin(ang - 0.4));
        ctx.lineTo(x2 - 9 * Math.cos(ang + 0.4), y2 - 9 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill();
      };
      ctx.font = `600 ${st.W < 520 ? 10 : 12}px "IBM Plex Mono", monospace`;
      let loadTxt;
      if (st.load === "v") {
        const nd = nodes[st.target], d = dp(st.target), X = sx(nd.x + d[0]), Y = sy(nd.y + d[1]) - 4;
        arrow(X, Y - 46, X, Y);
        ctx.textAlign = "center"; ctx.fillText(`P=${P}kN`, X, Y - 56);
        loadTxt = `P=${P}kN @ ${axisName(nd.x)} ${LV_NAME[LV.indexOf(nd.y)]}`;
      } else {
        const sgn = Math.sign(s) || 1;
        for (let f = 1; f < LV.length; f++) {
          const Y = sy(LV[f]), X = sx(0) - 6;
          const len = 18 + 28 * QH[f] / Math.max(...QH);
          if (sgn > 0) arrow(X - len, Y, X, Y); else { const X2 = sx(XS[3] + (f === 2 ? CANT : 0)) + 6; arrow(X2 + len, Y, X2, Y); }
        }
        loadTxt = `Q=${QH[1] + QH[2]}kN (Ai分布)`;
      }

      // 数値表示（実際の値）
      const pk = peaks(st.load === "v" ? vCase.get(st.target) : hCase);
      const roTxt = [loadTxt, `${fmt(pk.M)} kN·m`, `${fmt(pk.d * 1000, 2)} mm`, `変形 ×${Math.round(amp)}`];
      const joined = roTxt.join("|");
      if (joined !== roLast) { roLast = joined; ro.load.textContent = roTxt[0]; ro.m.textContent = roTxt[1]; ro.d.textContent = roTxt[2]; ro.s.textContent = roTxt[3]; }
    }

    const loop = (t) => { if (st.visible) draw(t); requestAnimationFrame(loop); };
    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver(([en]) => { st.visible = en.isIntersecting; }).observe(canvas);
    recolor(); resize();
    if (reduceMotion) { st.u = Float64Array.from(vCase.get(st.target)); draw(performance.now()); }
    else requestAnimationFrame(loop);
    // フォント読込み後に一度描き直す
    document.fonts && document.fonts.ready.then(() => reduceMotion && draw(performance.now()));
    return { recolor };
  })();

  try { const t = localStorage.getItem("tectonica-theme"); if (t === "blue") setTheme("blue"); } catch (_) { /* 何もしない */ }

  /* ───────────────────── 2. 作品 ───────────────────── */
  const WORKS = [
    { no: "0338", t: "花重リノベーション", by: "マル・アーキテクチャ／東京藝術大学", loc: "東京都台東区", img: ["hanaju-1", "hanaju-2"], aw: ["日本建築学会作品選奨 2025", "東京建築賞 最優秀賞", "AACA賞2024 優秀賞", "グッドデザイン賞2024"], credit: "Photo: Takuya Seki", cls: "wide", dim: "RENOVATION / WOOD" },
    { no: "0336", t: "Karuizawa Commongrounds", by: "Klein Dytham architecture", loc: "長野県軽井沢町", img: ["kcg-1", "kcg-2"], aw: ["WAF 2023 Small Project of the Year"], cls: "narrow", dim: "KARUIZAWA" },
    { no: "0312", t: "神奈川歯科大学 キャンパスセンター", by: "アトリエMEME", loc: "神奈川県横須賀市", img: ["kdu-1", "kdu-2"], aw: ["The Architecture MasterPrize 2024", "神奈川建築コンクール2025 優秀賞", "Tecture Award 2024"], cls: "narrow", dim: "YOKOSUKA" },
    { no: "0408", t: "東京藝術大学 芸術未来研究場 本部", by: "MARU。architecture", loc: "東京都台東区", img: ["geidai-1", "geidai-2"], pub: "新建築 2025年4月号／GA JAPAN 189・191", credit: "Photo: Takuya Seki", cls: "wide", dim: "UENO" },
    { no: "0412", t: "ハニヤスの家 — HANIYASU HOUSE", by: "AATISMO", loc: "神奈川県", img: ["haniyasu-1", "haniyasu-2"], aw: ["FRAME 2026 monthly award"], pub: "GA HOUSES 204／住宅特集 2026年2月号", cls: "wide", dim: "2025" },
    { no: "0337", t: "古川製作所 新社屋＋工場", by: "スキーマ建築計画", img: ["furukawa-1", "furukawa-2"], pub: "新建築 2025年1月号／GA JAPAN 190", cls: "narrow", dim: "OFFICE + FACTORY" },
  ];
  const MINI = [
    { t: "daita2019", by: "山田紗子建築設計事務所", em: "第36回 吉岡賞・住宅建築賞2020" },
    { t: "森の段床", by: "SUGAWARADAISUKE", em: "第45回 東京建築賞 最優秀賞" },
    { t: "やま仙（ウガンダ）", by: "TERRAIN architects", em: "グッドデザイン賞2020 金賞" },
    { t: "大阪・関西万博 休憩所3", by: "山田紗子建築設計事務所", em: "新建築 2025年12月号" },
  ];
  $("#works-grid").innerHTML = WORKS.map((w) => `
    <article class="work ${w.cls} rv">
      <div class="ph" data-dim="← ${esc(w.dim)} →">${w.img.map((s, i) => `<img src="img/${s}.jpg" alt="${esc(w.t)}${i ? "（内観）" : ""}" loading="lazy">`).join("")}</div>
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
    </article>`).join("") +
    `<div class="mini rv">${MINI.map((m) => `<div><b>${esc(m.t)}</b><span>${esc(m.by)}</span><em>${esc(m.em)}</em></div>`).join("")}</div>`;

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
