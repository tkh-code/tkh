const $ = (selector) => document.querySelector(selector);
const app = {
  demo: false,
  model: null,
  result: null,
  data: null,
  previewCase: 0,
  previewPlane: 0,
  fontSizeMode: "stress",
  fontSizes: { stress: "8", numbering: "5" },
};

const demoData = {
  cases: ["長期荷重", "地震 X+方向", "地震 Y+方向"],
  planes: ["01 い通り", "02 ろ通り", "A通り", "B通り"],
  stats: "節点 28 · 部材 42 · 断面 6",
  memberCount: 42,
  nodeCount: 28,
  synthetic: true,
};

function setStatus(message, error = false) {
  const status = $("#readStatus");
  status.classList.toggle("error", error);
  status.querySelector("span:last-child").textContent = message;
}

function decodeText(buffer) {
  const utf = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const badUtf = (utf.match(/\uFFFD/g) || []).length;
  if (badUtf) {
    try { return new TextDecoder("shift_jis").decode(buffer); } catch { /* keep UTF-8 */ }
  }
  return utf.replace(/^\uFEFF/, "");
}

function splitCsv(line) {
  const cells = [];
  let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

function sectionsOf(text) {
  const sections = new Map();
  let key = "";
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^\*\s*([A-Z0-9_-]+)/i);
    if (match) { key = match[1].toUpperCase(); if (!sections.has(key)) sections.set(key, []); continue; }
    if (key) sections.get(key).push(line);
  }
  return sections;
}

function expandIds(value) {
  const ids = [];
  for (const token of String(value || "").trim().split(/\s+/)) {
    const range = token.match(/^(\d+)to(\d+)(?:by(\d+))?$/i);
    if (range) {
      const start = Number(range[1]), end = Number(range[2]), step = Number(range[3] || 1);
      if (step < 1 || Math.abs(end - start) > 100000) continue;
      for (let id = start; start <= end ? id <= end : id >= end; id += start <= end ? step : -step) ids.push(id);
    } else if (/^\d+$/.test(token)) ids.push(Number(token));
  }
  return ids;
}

function parseModel(text) {
  const sections = sectionsOf(text);
  const rows = (name) => sections.get(name) || [];
  const nodes = new Map();
  for (const line of rows("NODE")) {
    const c = splitCsv(line);
    const id = Number(c[0]), xyz = c.slice(1, 4).map(Number);
    if (Number.isFinite(id) && xyz.length === 3 && xyz.every(Number.isFinite)) nodes.set(id, xyz);
  }
  const elements = [];
  for (const line of rows("ELEMENT")) {
    const c = splitCsv(line);
    const id = Number(c[0]);
    if (!Number.isFinite(id) || c.length < 6) continue;
    if (!/^(BEAM|TRUSS|TENSTR|COMPTR)$/i.test(c[1])) continue;
    const nodeIds = c.slice(4, 6).map(Number);
    if (nodeIds.every(Number.isFinite)) elements.push({
      id, type: c[1].toUpperCase(), material: Number(c[2]), section: Number(c[3]),
      nodes: nodeIds, beta: Number(c[6] || 0),
    });
  }
  // mgt2excel treats *MEMBER as the preferred explicit assignment and gives
  // every unassigned line element its own member. Diagram results remain per
  // element: joining ANL values here would change MIDAS Beam Diagram geometry.
  const members = [], memberByElement = new Map();
  let pendingMember = "";
  const addMember = (line) => {
    const c = splitCsv(line);
    if (c.length < 3 || !/^(YES|NO)$/i.test(c[2])) return;
    const ids = [c[1], ...c.slice(3)].map(Number).filter(Number.isFinite);
    const member = { id: Number(c[0]), elements: ids, reverse: c[2].toUpperCase() === "YES" };
    if (!Number.isFinite(member.id) || !ids.length) return;
    members.push(member);
    for (const id of ids) memberByElement.set(id, member.id);
  };
  for (const raw of rows("MEMBER")) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("$") || line.startsWith("*")) continue;
    pendingMember += line;
    if (pendingMember.endsWith("\\")) { pendingMember = pendingMember.slice(0, -1) + " "; continue; }
    addMember(pendingMember);
    pendingMember = "";
  }
  for (const element of elements) if (!memberByElement.has(element.id)) memberByElement.set(element.id, element.id);
  const constraints = new Map(), releases = new Map();
  for (const line of rows("CONSTRAINT")) {
    const c = splitCsv(line), flag = c[1]?.match(/^[01]{6,7}$/)?.[0];
    if (!flag) continue;
    for (const nodeId of expandIds(c[0])) constraints.set(nodeId, flag);
  }
  const releaseLines = rows("FRAME-RLS").filter((line) => line.trim() && !/^[;*$]/.test(line.trim()));
  for (let row = 0; row + 1 < releaseLines.length; row++) {
    const first = splitCsv(releaseLines[row]);
    if (!/^[01]{6}$/.test(first[2] || "")) continue;
    const second = splitCsv(releaseLines[row + 1]);
    if (!/^[01]{6}$/.test(second[0] || "")) continue;
    for (const elementId of expandIds(first[0])) releases.set(elementId, { i: first[2], j: second[0] });
    row++;
  }
  const planes = (sections.get("NAMEDPLANE") || []).flatMap((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith(";") || clean.startsWith("$") || clean.startsWith("*")) return [];
    const c = splitCsv(clean);
    const type = Number(c[1]), tolerance = Number(c[2]), coordinate = Number(c[3]);
    if (!c[0] || ![3, 4].includes(type) || !Number.isFinite(coordinate)) return [];
    return [{ name: c[0].trim(), type, tolerance: Number.isFinite(tolerance) ? tolerance : 0.01, coordinate }];
  }).slice(0, 100);
  const dimensions = new Map();
  for (const line of rows("DIMENSION")) {
    const c = splitCsv(line);
    const values = c.slice(1, 8).map(Number);
    if (!c[0] || values.length < 7 || !values.every(Number.isFinite)) continue;
    dimensions.set(c[0].trim(), {
      name: c[0].trim(), scale: values[0], origin: values.slice(1, 4), rotation: values.slice(4, 7),
      items: [],
    });
  }
  for (const line of rows("DIMENSION-LINETEXT")) {
    const c = splitCsv(line);
    const view = dimensions.get(c[0]?.trim());
    if (!view) continue;
    const type = Number(c[1]), height = Number(c[4]);
    const coordinates = c.slice(5, 11).map(Number);
    if (![0, 1].includes(type) || coordinates.length !== 6 || !coordinates.every(Number.isFinite)) continue;
    view.items.push({ type, text: c[2] || "", height: Number.isFinite(height) ? height : 0, start: coordinates.slice(0, 3), end: coordinates.slice(3, 6) });
  }
  const sectionCount = rows("SECTION").filter((line) => splitCsv(line).length > 1).length;
  return { nodes, elements, members, memberByElement, constraints, releases, planes, dimensions, sectionCount, sectionNames: [...sections.keys()] };
}

// Leaves a little air between the fitted drawing and the chart frame.
const DIAGRAM_MARGIN = 0.92;

// The drawing range is what is actually on the plane. Pinning the origin into
// the range squeezed off-origin frames into a corner of the sheet.
function planeExtent(values) {
  if (!values.length) return [0, 1];
  return [Math.min(...values), Math.max(...values)];
}

// A plane can hold a single straight line, so a zero span is ignored here
// rather than driving the scale to infinity.
function fitToChart(spanU, spanZ, drawW, drawH) {
  const fitU = spanU > 1e-9 ? drawW / spanU : Infinity;
  const fitZ = spanZ > 1e-9 ? drawH / spanZ : Infinity;
  const fit = Math.min(fitU, fitZ);
  return (Number.isFinite(fit) ? fit : 1) * DIAGRAM_MARGIN;
}

const pointNames = new Set(["I", "J", "CNT", "1/4", "3/4"]);
const floatToken = (value) => /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?$/.test(value || "");

function parseAnl(text) {
  const lines = text.split(/\r?\n/);
  const elements = new Map();
  const cases = [];
  const caseSet = new Set();
  const unitMatch = text.match(/単位系\s*[:：]\s*([^\r\n]+)/);
  const units = unitMatch?.[1]?.trim().replace(/\s+/g, " ") || "";
  const addCase = (name) => { if (name && !caseSet.has(name)) { caseSet.add(name); cases.push(name); } };
  const store = (id, lc, point, values, kind, material, section) => {
    if (!id || !lc || !values.length) return;
    addCase(lc);
    let item = elements.get(id);
    if (!item) { item = { id, kind, byCase: new Map() }; elements.set(id, item); }
    if (Number.isFinite(material)) item.material = material;
    if (Number.isFinite(section)) item.section = section;
    if (!item.byCase.has(lc)) item.byCase.set(lc, new Map());
    item.byCase.get(lc).set(point, values);
  };

  for (const [title, kind] of [["梁要素の断面力の出力", "beam"], ["トラス要素の断面力の出力", "truss"]]) {
    let start = -1;
    while ((start = lines.findIndex((line, i) => i > start && line.includes(title))) >= 0) {
      const endMatch = lines.findIndex((line, i) => i > start && /(?:梁|トラス)要素の(?:断面力|応力度)/.test(line));
      const end = endMatch < 0 ? lines.length : endMatch;
      let currentElement = null, currentCase = null;
      for (let i = start + 1; i < end; i++) {
        const tokens = lines[i].trim().split(/\s+/).filter(Boolean);
        if (tokens.length < 3) continue;
        if (kind === "beam") {
          if (/^\d+$/.test(tokens[0]) && /^\d+$/.test(tokens[1]) && /^\d+$/.test(tokens[2]) && pointNames.has(tokens[4]) && tokens.slice(5, 11).every(floatToken)) {
            currentElement = Number(tokens[0]); currentCase = tokens[3];
            store(currentElement, currentCase, tokens[4], tokens.slice(5, 11).map(Number), kind, Number(tokens[1]), Number(tokens[2]));
          } else if (currentElement !== null && pointNames.has(tokens[0]) && tokens.slice(1, 7).every(floatToken)) {
            store(currentElement, currentCase, tokens[0], tokens.slice(1, 7).map(Number), kind);
          } else if (currentElement !== null && pointNames.has(tokens[1]) && tokens.slice(2, 8).every(floatToken)) {
            currentCase = tokens[0];
            store(currentElement, currentCase, tokens[1], tokens.slice(2, 8).map(Number), kind);
          }
        } else {
          if (/^\d+$/.test(tokens[0]) && /^\d+$/.test(tokens[1]) && /^\d+$/.test(tokens[2]) && tokens.slice(4, 6).every(floatToken)) {
            currentElement = Number(tokens[0]); currentCase = tokens[3];
            store(currentElement, currentCase, "I", [Number(tokens[4])], kind, Number(tokens[1]), Number(tokens[2]));
            store(currentElement, currentCase, "J", [Number(tokens[5])], kind);
          } else if (currentElement !== null && tokens.length >= 3 && tokens.slice(1, 3).every(floatToken)) {
            currentCase = tokens[0];
            store(currentElement, currentCase, "I", [Number(tokens[1])], kind);
            store(currentElement, currentCase, "J", [Number(tokens[2])], kind);
          }
        }
      }
      start = end;
    }
  }
  return { cases, elements, units };
}

function validateModelResult(model, result) {
  const byId = new Map(model.elements.map((element) => [element.id, element]));
  for (const item of result.elements.values()) {
    const element = byId.get(item.id);
    if (!element) throw new Error(`ANLの要素 ${item.id} はMGTXにありません。対応するファイルを選択してください。`);
    if ((element.type === "BEAM") !== (item.kind === "beam") ||
        (Number.isFinite(item.material) && element.material !== item.material) ||
        (Number.isFinite(item.section) && element.section !== item.section)) {
      throw new Error(`要素 ${item.id} の種類・材料・断面がMGTXとANLで異なります。対応するファイルを選択してください。`);
    }
  }
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function elementLocalAxes(element, a, b) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (length < 1e-12) return null;
  const x = [(b[0] - a[0]) / length, (b[1] - a[1]) / length, (b[2] - a[2]) / length];
  const horizontal = Math.hypot(x[0], x[1]);
  // MIDAS beta=0: local z is the upward projection of global Z, except for
  // vertical elements where local z is global +X. x is always node I -> J.
  const z0 = horizontal < 1e-10 ? [1, 0, 0]
    : [-x[0] * x[2] / horizontal, -x[1] * x[2] / horizontal, horizontal];
  const y0 = cross3(z0, x);
  const beta = (Number.isFinite(element.beta) ? element.beta : 0) * Math.PI / 180;
  const y = y0.map((v, i) => v * Math.cos(beta) + z0[i] * Math.sin(beta));
  const z = z0.map((v, i) => v * Math.cos(beta) - y0[i] * Math.sin(beta));
  return { x, y, z };
}

function diagramDirection(element, a, b, plane, comp, screenNormal) {
  const axes = elementLocalAxes(element, a, b);
  if (!axes || comp === "N") return { vector: screenNormal, outOfPlane: false };
  const local = ({ MY: axes.z.map((v) => -v), MZ: axes.y, QZ: axes.z, QY: axes.y })[comp];
  if (!local) return { vector: screenNormal, outOfPlane: false };
  const horizontalAxis = plane.type === 3 ? 0 : 1;
  const projected = [local[horizontalAxis], -local[2]];
  const length = Math.hypot(...projected);
  // A strictly edge-on diagram cannot be drawn in 2D. Keep its numeric result
  // and give it an in-plane fallback, visibly identifying it in SVG metadata.
  if (length < 1e-8) return { vector: screenNormal, outOfPlane: true };
  return { vector: projected.map((v) => v / length), outOfPlane: false };
}

function valueLabelPoints(values, mode) {
  if (!values.length || mode === "none") return [];
  const last = values.length - 1;
  const abs = values.reduce((best, value, index) => Math.abs(value) > Math.abs(values[best]) ? index : best, 0);
  const at = (index) => ({ value: values[index], ratio: last ? index / last : 0.5 });
  const center = { value: last % 2 === 0 ? values[last / 2] : (values[Math.floor(last / 2)] + values[Math.ceil(last / 2)]) / 2, ratio: 0.5 };
  const absAtCenter = { value: values[abs], ratio: 0.5 };
  if (mode === "five") return values.map((_, i) => at(i));
  if (mode === "three") return [at(0), center, at(last)];
  if (mode === "abs") return [absAtCenter];
  if (mode === "minmax") {
    const min = values.indexOf(Math.min(...values)), max = values.indexOf(Math.max(...values));
    return min === max ? [at(min)] : [at(min), at(max)];
  }
  // GEN NX "All" is I + J + Abs Max (the latter printed at element center),
  // not the I + center + J mode that the prototype previously used.
  return [at(0), absAtCenter, at(last)];
}

function memberAboveNormal(dx, dy) {
  const length = Math.hypot(dx, dy) || 1;
  let x = dy / length, y = -dx / length;
  // Above is upward on the page, and left of the member when it is vertical.
  if (y > 0 || (Math.abs(y) < 1e-9 && x > 0)) { x = -x; y = -y; }
  return [x, y];
}

function valueLabelPosition(start, delta, direction, value, ratio, peak, forceScale, offset, memberCentered) {
  const sign = Math.sign(value) || 1;
  // Absolute-max labels sit directly above the member, regardless of force sign.
  const distance = memberCentered
    ? offset
    : value / peak * forceScale + sign * offset;
  return [start[0] + delta[0] * ratio + direction[0] * distance,
    start[1] + delta[1] * ratio + direction[1] * distance];
}

async function readFile(file) {
  return decodeText(await file.arrayBuffer());
}

function renderChoices() {
  const data = app.data;
  if (!data.synthetic && !app.result && diagramType() === "stress") document.querySelector('input[name="diagramType"][value="member"]').checked = true;
  syncFontSizeForMode();
  $("#caseList").innerHTML = data.cases.map((item, i) => `<label class="choice-row"><input type="checkbox" data-kind="case" value="${i}" ${i === 0 ? "checked" : ""}><span>${escapeHtml(item)}</span></label>`).join("");
  $("#planeList").innerHTML = data.planes.map((item, i) => `<label class="choice-row"><input type="checkbox" data-kind="plane" value="${i}" ${i === 0 ? "checked" : ""}><span>${escapeHtml(typeof item === "string" ? item : item.name)}</span></label>`).join("");
  $("#planeHint").textContent = data.synthetic ? "登録平面ごとに1枚ずつ作成します。" : data.planes.length ? "MGTXの登録平面を読み込みました。選択した面上の部材だけを表示します。" : "MGTX内に登録平面を見つけられませんでした。";
  $("#workspace").classList.remove("hidden");
  $("#previewBadge").textContent = data.synthetic ? "サンプル" : "実ファイル";
  $("#previewBadge").classList.toggle("real", !data.synthetic);
  $("#modelStats").textContent = data.stats;
  $("#prototypeDisclaimer").innerHTML = data.synthetic
    ? "<span>!</span> サンプル図は操作確認用の架空データです。実構造物の検討・設計には使用できません。"
    : "<span>!</span> 非公式の出力図です。応力・部材・断面の値と表示位置はGEN NXの原図と照合してから利用してください。";
  updatePreview();
  updateOutputCount();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function selected(kind) {
  return [...document.querySelectorAll(`input[data-kind="${kind}"]:checked`)].map((input) => Number(input.value));
}

function component() {
  return document.querySelector('input[name="component"]:checked')?.value || "MY";
}

function diagramType() {
  return document.querySelector('input[name="diagramType"]:checked')?.value || "stress";
}

function syncFontSizeForMode() {
  const next = diagramType() === "stress" ? "stress" : "numbering";
  if (next === app.fontSizeMode) return;
  const input = $("#labelFontSize");
  app.fontSizes[app.fontSizeMode] = input.value;
  input.value = app.fontSizes[next];
  app.fontSizeMode = next;
}

function componentLabel(kind) {
  return ({ MY: "M-y · 曲げモーメント", MZ: "M-z · 曲げモーメント", QY: "Q-y · せん断力", QZ: "Q-z · せん断力", N: "N · 軸力", member: "部材番号", section: "断面番号" })[kind];
}

function drawingTitle(plane, loadCase, comp) {
  const enteredLine = $("#titleLine")?.value.trim();
  const rawPlaneName = typeof plane === "string" ? plane : plane?.name || "";
  const inferredLine = rawPlaneName.replace(/^\s*\d+\s*[_＿\-\s　]*/, "").trim();
  let line = enteredLine || inferredLine || "〇";
  if (!line.endsWith("通り")) line += "通り";
  if (comp === "member" || comp === "section") return { line, detail: comp === "member" ? "部材番号" : "断面番号" };
  const diagramCode = ({ MY: "My", MZ: "Mz", QY: "Qy", QZ: "Qz", N: "N" })[comp] || String(comp || "");
  return { line, detail: `${diagramCode}図 (${String(loadCase || "")})` };
}

function stableHash(text) {
  let hash = 2166136261;
  for (const char of text) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function dimensionPoint(view, point) {
  const [rx, ry, rz] = view.rotation.map((angle) => angle * Math.PI / 180);
  let [x, y, z] = point.map((value) => value * view.scale);
  const y1 = y * Math.cos(rx) - z * Math.sin(rx), z1 = y * Math.sin(rx) + z * Math.cos(rx);
  const x2 = x * Math.cos(ry) + z1 * Math.sin(ry), z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);
  const x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz), y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
  return [x3 + view.origin[0], y3 + view.origin[1], z2 + view.origin[2]];
}

// Dimension views carry the grid marks, and their names are whatever the user
// typed in MIDAS, so pick the view that actually runs along the drawing axis.
function dimensionViewForAxis(model, axis) {
  let best = null, bestSpread = 0;
  for (const view of model.dimensions?.values() || []) {
    const values = view.items.flatMap((item) => [dimensionPoint(view, item.start)[axis], dimensionPoint(view, item.end)[axis]]);
    if (values.length < 2) continue;
    const spread = Math.max(...values) - Math.min(...values);
    if (spread > bestSpread) { bestSpread = spread; best = view; }
  }
  return best;
}

// The grid marks read as a row at the foot of the frame on the GEN NX sheets,
// so reserve a band for them instead of letting them float at whatever height
// the dimension view happens to sit at.
function dimensionBandHeight(items, fontSize) {
  return items.length ? fontSize * 2.6 : 0;
}

function dimensionRowLayout(placed, chartBottom, fontSize) {
  const baseline = chartBottom - fontSize * 0.5;
  const ys = placed.filter((item) => item.type === 0).flatMap(({ A, B }) => [A[1], B[1]]);
  return { baseline, shift: ys.length ? baseline - fontSize * 1.5 - Math.max(...ys) : 0 };
}

function makeContourPalette(count) {
  const stops = ["#438cf5", "#2cbdb0", "#55c94f", "#91d32f", "#bfdb21", "#e8d719", "#ffd21a", "#ffc116", "#ffad12", "#ff9116", "#ff7428", "#f14f39"];
  const parse = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const f = t * (stops.length - 1), lo = Math.floor(f), hi = Math.min(stops.length - 1, lo + 1), mix = f - lo;
    const a = parse(stops[lo]), b = parse(stops[hi]);
    return toHex(a.map((v, k) => v + (b[k] - v) * mix));
  });
}

function contourRankValues(minimum, maximum, count) {
  if (!(maximum > minimum)) return Array.from({ length: count }, () => maximum || 0);
  const ranks = Array.from({ length: count }, (_, index) => maximum - (maximum - minimum) * index / (count - 1));
  if (minimum < 0 && maximum > 0) {
    const zeroRank = Math.round(maximum / (maximum - minimum) * (count - 1));
    ranks[zeroRank] = 0;
  }
  return ranks;
}

function textBox(text, x, y, size, angle = 0) {
  const advances = [...String(text)].reduce((total, character) => total + (/[^\u0000-\u00ff]/.test(character) ? 1 : 0.46), 0);
  const width = Math.max(size * 1.2, advances * size + 3), height = size + 2;
  const radians = angle * Math.PI / 180;
  const rotatedWidth = Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * height;
  const rotatedHeight = Math.abs(Math.sin(radians)) * width + Math.abs(Math.cos(radians)) * height;
  const centerY = y - size * 0.35;
  return { left: x - rotatedWidth / 2, right: x + rotatedWidth / 2, top: centerY - rotatedHeight / 2, bottom: centerY + rotatedHeight / 2 };
}

function boxesOverlap(a, b, gap = 2) {
  return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
}

function diagramSvg(plane, loadCase, comp, options = {}) {
  const seed = stableHash(`${plane}:${loadCase}:${comp}`);
  const title = drawingTitle(plane, loadCase, comp);
  const scale = Number(options.scale || $("#scale")?.value || 1);
  const width = 760, height = 470;
  const sampleFonts = {
    arialNarrow: "'Arial Narrow', Arial, 'Noto Sans JP', sans-serif",
    arial: "Arial, 'Noto Sans JP', sans-serif",
    msGothic: "'MS Gothic', 'Noto Sans JP', sans-serif",
    msMincho: "'Yu Mincho', '游明朝', 'MS Mincho', 'ＭＳ 明朝', serif",
    meiyo: "'Meiryo UI', Meiryo, 'Noto Sans JP', sans-serif",
    noto: "'Noto Sans JP', 'Yu Gothic', sans-serif",
  };
  const sampleFont = sampleFonts[options.fontFamily || $("#fontFamily")?.value || "arialNarrow"] || sampleFonts.arialNarrow;
  const sampleWeight = (options.fontWeight || $("#fontWeight")?.value || "normal") === "bold" ? 700 : 400;
  const frame = $("#frame")?.value !== "off";
  const xs = [110, 290, 470, 650];
  const ys = [340, 250, 160, 70];
  const members = [];
  for (let col = 0; col < xs.length; col++) {
    for (let floor = 0; floor < ys.length - 1; floor++) members.push([[xs[col], ys[floor]], [xs[col], ys[floor + 1]], "column"]);
  }
  for (let floor = 1; floor < ys.length; floor++) {
    for (let bay = 0; bay < xs.length - 1; bay++) members.push([[xs[bay], ys[floor]], [xs[bay + 1], ys[floor]], "beam"]);
  }
  const diagramPaths = members.map(([a, b], i) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
    const nx = dy / length, ny = -dx / length;
    const ampBase = ["MY", "MZ"].includes(comp) ? 17 : ["QY", "QZ"].includes(comp) ? 12 : 8;
    const polarity = ((seed >>> (i % 22)) & 1) ? 1 : -1;
    const amp = ampBase * (0.45 + ((seed + i * 53) % 100) / 100) * polarity * scale;
    const sign = amp > 0 ? "#d96f63" : "#5b8fc9";
    const mid = [(a[0] + b[0]) / 2 + nx * amp, (a[1] + b[1]) / 2 + ny * amp];
    const far = [b[0] + nx * amp * .42, b[1] + ny * amp * .42];
    const near = [a[0] + nx * amp * .42, a[1] + ny * amp * .42];
    return `<path d="M${a[0]},${a[1]} L${near[0].toFixed(1)},${near[1].toFixed(1)} Q${mid[0].toFixed(1)},${mid[1].toFixed(1)} ${far[0].toFixed(1)},${far[1].toFixed(1)} L${b[0]},${b[1]} Z" fill="${sign}" fill-opacity=".24" stroke="${sign}" stroke-width=".85"/><circle cx="${mid[0].toFixed(1)}" cy="${mid[1].toFixed(1)}" r="1.5" fill="${sign}"/>`;
  }).join("");
  const beams = members.map(([a,b]) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`).join("");
  const floors = ys.map((y, i) => `<line x1="65" y1="${y}" x2="700" y2="${y}" stroke="#edf1ef" stroke-dasharray="4 5"/><text x="49" y="${y + 3}" text-anchor="end" class="axis-label">${i === 0 ? "GL" : `${i}FL`}</text>`).join("");
  const grids = xs.map((x, i) => `<line x1="${x}" y1="50" x2="${x}" y2="355" stroke="#edf1ef" stroke-dasharray="4 5"/><circle cx="${x}" cy="371" r="10" fill="#fff" stroke="#cfd9d4"/><text x="${x}" y="374" text-anchor="middle" class="axis-label">${String.fromCharCode(65 + i)}</text>`).join("");
  const base = xs.map((x) => `<path d="M${x-9},350 L${x+9},350 L${x},340 Z" fill="#73847d"/>`).join("");
  return `<svg class="diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(plane)} ${escapeHtml(loadCase)} ${escapeHtml(comp)}応力図">
    <style>.member{stroke:#596861;stroke-width:1.05;stroke-linecap:round}.axis-label{font:10px ${sampleFont};fill:#89968f}.cap{font:12px ${sampleFont};fill:#52625b}.tiny{font:10px ${sampleFont};fill:#75837c}.drawing-title{font:14px ${sampleFont};font-weight:${sampleWeight};fill:#171a18}.thin{stroke:#e5ebe8;stroke-width:1}</style>
    <rect x="16" y="16" width="728" height="398" rx="3" fill="#fff" ${frame ? 'stroke="#8c9892" stroke-width=".9"' : ""}/>
    <text x="42" y="43" class="cap">${escapeHtml(plane)}　${escapeHtml(loadCase)}　${escapeHtml(componentLabel(comp))}</text>
    ${floors}${grids}<g>${diagramPaths}</g><g class="member">${beams}</g>${base}
    <g transform="translate(576 43)"><rect x="0" y="-9" width="9" height="9" rx="2" fill="#d96f63" fill-opacity=".75"/><text x="14" y="-1" class="tiny">正側</text><rect x="59" y="-9" width="9" height="9" rx="2" fill="#5b8fc9" fill-opacity=".75"/><text x="73" y="-1" class="tiny">負側</text></g>
    <text x="42" y="434" class="drawing-title">${escapeHtml(title.line)}</text>
    <text x="42" y="452" class="drawing-title">${escapeHtml(title.detail)}</text>
    <text x="705" y="398" text-anchor="end" class="tiny">試作サンプル図 · 実解析結果ではありません</text>
  </svg>`;
}

function elementsOnPlane(model, plane) {
  const selectorAxis = plane.type === 3 ? 1 : 0;
  return model.elements.map((element) => {
    const a = model.nodes.get(element.nodes[0]), b = model.nodes.get(element.nodes[1]);
    if (!a || !b || !/BEAM|TRUSS|TENSTR|COMPTR/i.test(element.type)) return null;
    if (Math.abs(a[selectorAxis] - plane.coordinate) > plane.tolerance || Math.abs(b[selectorAxis] - plane.coordinate) > plane.tolerance) return null;
    return { element, a, b };
  }).filter(Boolean);
}

function numberingGroups(model, plane, kind) {
  const segments = elementsOnPlane(model, plane);
  const byId = new Map(segments.map((segment) => [segment.element.id, segment]));
  const makeGroup = (label, parts) => {
    const lengths = parts.map(({ a, b }) => Math.hypot(...a.map((value, axis) => b[axis] - value)));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    let remaining = total / 2, segment = parts[0], ratio = 0.5;
    for (let i = 0; i < parts.length; i++) {
      if (remaining <= lengths[i] || i === parts.length - 1) { segment = parts[i]; ratio = lengths[i] ? remaining / lengths[i] : 0.5; break; }
      remaining -= lengths[i];
    }
    const point = segment.a.map((value, axis) => value + (segment.b[axis] - value) * Math.max(0, Math.min(1, ratio)));
    return { label: String(label), memberId: String(label), point, segment, elementIds: parts.map(({ element }) => element.id) };
  };
  const groups = [], assigned = new Set();
  if (model.members.length) {
    // 指定モード: *MEMBER の iKEY を部材番号にし、未指定要素は独立した部材にする。
    for (const member of model.members) {
      const parts = member.elements.map((id) => byId.get(id)).filter(Boolean);
      if (!parts.length) continue;
      groups.push(makeGroup(member.id, parts));
      for (const part of parts) assigned.add(part.element.id);
    }
  } else {
    // 参照サイトと同様、*MEMBER が無いモデルだけ同断面・同軸の直線要素を自動連結する。
    const incident = new Map();
    for (const part of segments) for (const nodeId of part.element.nodes) {
      if (!incident.has(nodeId)) incident.set(nodeId, []);
      incident.get(nodeId).push(part);
    }
    const compatible = (left, right, nodeId) => {
      const a = left.element, b = right.element;
      if (a.type !== b.type || a.material !== b.material || a.section !== b.section || Math.abs(a.beta - b.beta) > 1e-6) return false;
      if (model.constraints.has(nodeId) || model.releases.has(a.id) || model.releases.has(b.id)) return false;
      const u = left.a.map((value, axis) => left.b[axis] - value), v = right.a.map((value, axis) => right.b[axis] - value);
      const dot = u.reduce((sum, value, axis) => sum + value * v[axis], 0);
      return dot / (Math.hypot(...u) * Math.hypot(...v) || 1) > 0.9999;
    };
    const next = new Map(), prev = new Map();
    for (const part of segments) {
      const nodeId = part.element.nodes[1];
      const candidates = (incident.get(nodeId) || []).filter((other) => other.element.nodes[0] === nodeId && compatible(part, other, nodeId));
      if (candidates.length === 1) next.set(part.element.id, candidates[0].element.id);
    }
    for (const [from, to] of next) {
      if (!prev.has(to)) prev.set(to, []);
      prev.get(to).push(from);
    }
    for (const part of segments) {
      const id = part.element.id;
      if (assigned.has(id) || prev.get(id)?.length === 1) continue;
      const chain = [part]; assigned.add(id);
      let cursor = id;
      while (next.has(cursor) && prev.get(next.get(cursor))?.length === 1 && !assigned.has(next.get(cursor))) {
        cursor = next.get(cursor); assigned.add(cursor); chain.push(byId.get(cursor));
      }
      groups.push(makeGroup(chain[0].element.id, chain));
    }
  }
  for (const part of segments) if (!assigned.has(part.element.id)) groups.push(makeGroup(part.element.id, [part]));
  if (kind === "section") for (const group of groups) {
    const sections = [...new Set(group.elementIds.map((id) => byId.get(id)?.element.section))];
    group.label = sections.join("/");
  }
  return groups;
}

function memberEndpointNodes(model, group, byId = new Map(model.elements.map((element) => [element.id, element]))) {
  const incidence = new Map();
  for (const id of group.elementIds) {
    const element = byId.get(id);
    if (!element) continue;
    for (const nodeId of element.nodes) incidence.set(nodeId, (incidence.get(nodeId) || 0) + 1);
  }
  const ends = [...incidence].filter(([, count]) => count === 1).map(([nodeId]) => nodeId);
  if (ends.length === 2) return ends;
  if (group.elementIds.length === 1) return byId.get(group.elementIds[0])?.nodes || [];
  // An invalid branched assignment has no unambiguous pair of member ends.
  return [];
}

function numberingDiagramSvg(plane, kind, options = {}) {
  const model = app.model?.parsed;
  if (!model || !plane || typeof plane === "string") return "";
  const segments = elementsOnPlane(model, plane), groups = numberingGroups(model, plane, kind);
  const width = 1200, height = 590, frame = $("#frame")?.value !== "off";
  const dimensionEnabled = options.showDimensions ?? $("#showDimensions")?.checked ?? true;
  const dimensionView = dimensionViewForAxis(model, plane.type === 3 ? 0 : 1);
  const dimensionItems = dimensionEnabled && dimensionView ? dimensionView.items.map((item) => ({
    ...item, a: dimensionPoint(dimensionView, item.start), b: dimensionPoint(dimensionView, item.end),
  })) : [];
  const axis = plane.type === 3 ? 0 : 1;
  const allU = [...segments.flatMap(({ a, b }) => [a[axis], b[axis]]), ...dimensionItems.flatMap(({ a, b }) => [a[axis], b[axis]])];
  // Only the structure sets the vertical scale; the marks get their own band.
  const allZ = segments.flatMap(({ a, b }) => [a[2], b[2]]);
  const [minU, maxU] = planeExtent(allU);
  const [minZ, maxZ] = planeExtent(allZ);
  const chartLeft = 190, chartRight = 1040, chartTop = 160, chartBottom = 413;
  const ptToSvg = (pt) => Number(pt) * width * 25.4 / (277 * 72);
  const fontSize = ptToSvg(options.labelFontSize || $("#labelFontSize")?.value || 8);
  const dimensionBand = dimensionBandHeight(dimensionItems, fontSize);
  const spanU = maxU - minU, spanZ = maxZ - minZ;
  const drawW = chartRight - chartLeft, drawH = chartBottom - chartTop - dimensionBand;
  const fit = fitToChart(spanU, spanZ, drawW, drawH) * Number(options.scale || $("#scale")?.value || 1);
  const usedW = spanU * fit, usedH = spanZ * fit;
  const x0 = chartLeft + (drawW - usedW) / 2, y0 = chartTop + (drawH - usedH) / 2;
  const pt2 = (point) => [x0 + (point[axis] - minU) * fit, y0 + (maxZ - point[2]) * fit];
  const fontFamilies = {
    arialNarrow: "'Arial Narrow',Arial,'Noto Sans JP',sans-serif", arial: "Arial,'Noto Sans JP',sans-serif",
    msGothic: "'MS Gothic','Noto Sans JP',sans-serif", msMincho: "'Yu Mincho','游明朝','MS Mincho',serif",
    meiyo: "'Meiryo UI',Meiryo,sans-serif", noto: "'Noto Sans JP',sans-serif",
  };
  const fontFamily = fontFamilies[options.fontFamily || $("#fontFamily")?.value || "arialNarrow"] || fontFamilies.arialNarrow;
  const fontWeight = (options.fontWeight || $("#fontWeight")?.value || "normal") === "bold" ? 700 : 400;
  const rawColor = options.valueColor || $("#valueColor")?.value || "#171a18";
  const color = /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : "#171a18";
  const labelOffset = Number(options.labelOffsetMm ?? $("#labelOffsetMm")?.value ?? 0.6) * width / 277;
  const labelOrientation = options.labelOrientation || $("#labelOrientation")?.value || "auto";
  const hideOverlaps = options.hideOverlaps ?? $("#hideOverlaps")?.checked ?? false;
  const rawDimensionColor = options.dimensionColor || $("#dimensionColor")?.value || "#c9cfcc";
  const dimensionColor = /^#[0-9a-f]{6}$/i.test(rawDimensionColor) ? rawDimensionColor : "#c9cfcc";
  const dimensionLineWidth = Number(options.dimensionLineWidth || $("#dimensionLineWidth")?.value || 0.2);
  const placedDimensions = dimensionItems.map((item) => ({ ...item, A: pt2(item.a), B: pt2(item.b) }));
  const dimensionRow = dimensionRowLayout(placedDimensions, chartBottom, fontSize);
  const dimensionLines = [], dimensionLabels = [];
  for (const item of placedDimensions) {
    if (item.type === 0) {
      dimensionLines.push(`<line x1="${item.A[0].toFixed(1)}" y1="${(item.A[1] + dimensionRow.shift).toFixed(1)}" x2="${item.B[0].toFixed(1)}" y2="${(item.B[1] + dimensionRow.shift).toFixed(1)}" class="dimension-line"/>`);
    } else if (item.text.trim()) {
      dimensionLabels.push(`<text x="${((item.A[0] + item.B[0]) / 2).toFixed(1)}" y="${dimensionRow.baseline.toFixed(1)}" text-anchor="middle">${escapeHtml(item.text)}</text>`);
    }
  }
  const memberLines = segments.map(({ element, a, b }) => {
    const A = pt2(a), B = pt2(b);
    return `<line data-element-id="${element.id}" x1="${A[0].toFixed(1)}" y1="${A[1].toFixed(1)}" x2="${B[0].toFixed(1)}" y2="${B[1].toFixed(1)}" stroke="${kind === "member" ? "#c58721" : "#5e874c"}" stroke-width="${element.type === "BEAM" ? 0.78 : 0.64}"/>`;
  });
  const showMemberEnds = kind === "member" && (options.showMemberEnds ?? $("#showMemberEnds")?.checked ?? true);
  const memberEndRadius = Math.max(0.2, Math.min(2, Number(options.memberEndSize ?? $("#memberEndSize")?.value ?? 0.8))) * width / 277 / 2;
  const memberEndInset = Math.max(0, Math.min(5, Number(options.memberEndInset ?? $("#memberEndInset")?.value ?? 1))) * width / 277;
  const elementById = new Map(model.elements.map((element) => [element.id, element]));
  const memberEndDots = [];
  if (showMemberEnds) for (const group of groups) for (const nodeId of memberEndpointNodes(model, group, elementById)) {
    const endElement = group.elementIds.map((id) => elementById.get(id)).find((element) => element?.nodes.includes(nodeId));
    const towardId = endElement?.nodes.find((id) => id !== nodeId);
    if (!model.nodes.has(nodeId) || !model.nodes.has(towardId)) continue;
    const from = pt2(model.nodes.get(nodeId)), toward = pt2(model.nodes.get(towardId));
    const dx = toward[0] - from[0], dy = toward[1] - from[1], length = Math.hypot(dx, dy);
    if (!length) continue;
    const inset = Math.min(memberEndInset, length * 0.35);
    const x = from[0] + dx * inset / length, y = from[1] + dy * inset / length;
    memberEndDots.push(`<circle data-member-boundary-node="${nodeId}" data-member-id="${group.memberId}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${memberEndRadius.toFixed(2)}" fill="#d9870d"><title>単一部材 ${group.memberId} の端点（部材内側）</title></circle>`);
  }
  const occupied = [], numberLabels = [];
  for (const group of groups) {
    const origin = pt2(group.point), a = pt2(group.segment.a), b = pt2(group.segment.b);
    const dx = b[0] - a[0], dy = b[1] - a[1], normal = memberAboveNormal(dx, dy);
    const x = origin[0] + normal[0] * labelOffset, y = origin[1] + normal[1] * labelOffset;
    let angle = labelOrientation === "auto" ? Math.atan2(dy, dx) * 180 / Math.PI : Number(labelOrientation);
    if (labelOrientation === "auto") { if (angle > 90) angle -= 180; else if (angle < -90) angle += 180; if (Math.abs(Math.abs(angle) - 90) < 0.001) angle = -90; }
    const box = textBox(group.label, x, y, fontSize, angle);
    if (hideOverlaps && occupied.some((other) => boxesOverlap(box, other, 2))) continue;
    occupied.push(box);
    numberLabels.push(`<text data-number="${escapeHtml(group.label)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" transform="rotate(${angle.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${escapeHtml(group.label)}</text>`);
  }
  const diagramName = kind === "member" ? "部材番号" : "断面番号";
  const lineName = drawingTitle(plane, "", kind).line;
  app.lastDiagnostics = { plane: plane.name, diagramType: kind, total: groups.length, resultCount: numberLabels.length, elements: segments.length };
  return `<svg class="diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(plane.name)} ${diagramName}図">
    <style>.dimension-line{stroke:${dimensionColor};stroke-width:${dimensionLineWidth};fill:none}.dimension-label,.number-label{font-family:${fontFamily};font-size:${fontSize.toFixed(2)}px;font-weight:${fontWeight};fill:${color}}.sheet-title{font-family:${fontFamily};font-size:${ptToSvg(8).toFixed(2)}px;fill:${color}}</style>
    <rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>
    <rect x="64" y="58" width="1072" height="473" fill="#fff" ${frame ? 'stroke="#3e4642" stroke-width=".8"' : ""}/>
    <g>${dimensionLines.join("")}</g><g>${memberLines.join("")}</g>
    <g class="member-end-dots">${memberEndDots.join("")}</g>
    <g class="dimension-label">${dimensionLabels.join("")}</g><g class="number-label">${numberLabels.join("")}</g>
    <text x="70" y="556" class="sheet-title">${escapeHtml(lineName)}　${diagramName}</text>
  </svg>`;
}

function demoNumberingSvg(plane, kind) {
  const name = kind === "member" ? "部材番号" : "断面番号";
  const lines = [180, 300, 420, 540].map((x) => `<line x1="${x}" y1="145" x2="${x}" y2="335" stroke="#59645f" stroke-width=".8"/>`);
  for (const y of [145, 240, 335]) lines.push(`<line x1="180" y1="${y}" x2="540" y2="${y}" stroke="#59645f" stroke-width=".8"/>`);
  const labels = kind === "member" ? [101,102,103,104,105,106,107,108,109,110,111,112] : [1,1,2,3,3,4,5,5,5,6,6,6];
  const positions = [[240,145],[360,145],[480,145],[240,240],[360,240],[480,240],[240,335],[360,335],[480,335],[180,195],[300,195],[420,195]];
  return `<svg class="diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 470" role="img" aria-label="サンプル ${name}"><rect x="16" y="16" width="728" height="398" fill="#fff" stroke="#53615c"/><g>${lines.join("")}</g><g font-family="Arial,sans-serif" font-size="12" fill="#171a18" text-anchor="middle">${positions.map(([x,y],i) => `<text x="${x}" y="${y-4}">${labels[i]}</text>`).join("")}</g><text x="24" y="442" font-size="14">${escapeHtml(plane)}　${name}（サンプル）</text></svg>`;
}

function actualDiagramSvg(plane, loadCase, comp, options = {}) {
  const model = app.model?.parsed, result = app.result?.parsed;
  if (!model || !result || typeof plane === "string") return diagramSvg(plane, loadCase, comp, options);
  const planeMembers = elementsOnPlane(model, plane).map((item) => ({ ...item, result: result.elements.get(item.element.id) }));
  const resultIndex = ({ N: 0, QY: 1, QZ: 2, T: 3, MY: 4, MZ: 5 })[comp] ?? 5;
  const memberData = planeMembers.map(({ element, a, b, result: item }) => {
    const rows = item?.byCase.get(loadCase);
    let values = [];
    if (rows && item.kind === "truss" && comp === "N" && Number.isFinite(rows.get("I")?.[0]) && Number.isFinite(rows.get("J")?.[0])) values = [rows.get("I")[0], rows.get("J")[0]];
    else if (rows && item.kind === "beam") {
      const stations = ["I", "1/4", "CNT", "3/4", "J"].map((position) => rows.get(position)?.[resultIndex]);
      if (stations.every(Number.isFinite)) values = stations;
    }
    return { element, a, b, item, values };
  });
  const selectedValues = memberData.flatMap(({ values }) => values);
  const minimum = Math.min(0, ...selectedValues), maximum = Math.max(0, ...selectedValues);
  const peak = Math.max(Math.abs(minimum), Math.abs(maximum)) || 1;
  const dimensionEnabled = options.showDimensions ?? $("#showDimensions")?.checked ?? true;
  const dimensionView = dimensionViewForAxis(model, plane.type === 3 ? 0 : 1);
  const dimensionItems = dimensionEnabled && dimensionView ? dimensionView.items.map((item) => ({
    ...item, a: dimensionPoint(dimensionView, item.start), b: dimensionPoint(dimensionView, item.end),
  })) : [];
  const axis = plane.type === 3 ? 0 : 1;
  const allU = [
    ...planeMembers.flatMap(({ a, b }) => [a[axis], b[axis]]),
    ...dimensionItems.flatMap(({ a, b }) => [a[axis], b[axis]]),
  ];
  // Only the structure sets the vertical scale; the marks get their own band.
  const allZ = planeMembers.flatMap(({ a, b }) => [a[2], b[2]]);
  const [minU, maxU] = planeExtent(allU);
  const [minZ, maxZ] = planeExtent(allZ);
  const width = 1200, height = 590, frame = $("#frame")?.value !== "off";
  const legendPosition = options.legendPosition || $("#legendPosition")?.value || "right";
  const count = Number(options.contourColors || $("#contourColors")?.value || 12);
  const decimalPlaces = Number(options.decimalPlaces ?? $("#decimalPlaces")?.value ?? 1);
  const rankDecimals = Number(options.rankDecimals ?? $("#rankDecimals")?.value ?? decimalPlaces);
  const palette = makeContourPalette(count);
  const ranks = contourRankValues(minimum, maximum, count);
  const numberLabel = (value) => Number(value).toFixed(decimalPlaces);
  const rankLabel = (value) => Number(value).toFixed(rankDecimals);
  const ptToSvg = (pt) => Number(pt) * width * 25.4 / (277 * 72);
  const labelFontSize = ptToSvg(options.labelFontSize || $("#labelFontSize")?.value || 8);
  const legendFontSize = ptToSvg(options.legendFontSize || $("#legendFontSize")?.value || 8);
  const titleFontSize = ptToSvg(options.titleFontSize || 8);
  const fontFamilies = {
    arialNarrow: "'Arial Narrow', Arial, 'Noto Sans JP', sans-serif",
    arial: "Arial, 'Noto Sans JP', sans-serif",
    msGothic: "'MS Gothic', 'Noto Sans JP', sans-serif",
    msMincho: "'Yu Mincho', '游明朝', 'MS Mincho', 'ＭＳ 明朝', serif",
    meiyo: "'Meiryo UI', Meiryo, 'Noto Sans JP', sans-serif",
    noto: "'Noto Sans JP', 'Yu Gothic', sans-serif",
  };
  const fontFamily = fontFamilies[options.fontFamily || $("#fontFamily")?.value || "arialNarrow"] || fontFamilies.arialNarrow;
  const fontWeight = (options.fontWeight || $("#fontWeight")?.value || "normal") === "bold" ? 700 : 400;
  const rawTextColor = options.valueColor || $("#valueColor")?.value || "#171a18";
  const valueColor = /^#[0-9a-f]{6}$/i.test(rawTextColor) ? rawTextColor : "#171a18";
  const labelOrientation = options.labelOrientation || $("#labelOrientation")?.value || "auto";
  const labelOffset = Number(options.labelOffsetMm ?? $("#labelOffsetMm")?.value ?? 0.6) * width / 277;
  const hideOverlaps = options.hideOverlaps ?? $("#hideOverlaps")?.checked ?? false;
  const dimensionLineWidth = Number(options.dimensionLineWidth || $("#dimensionLineWidth")?.value || 0.2);
  const rawDimensionColor = options.dimensionColor || $("#dimensionColor")?.value || "#c9cfcc";
  const dimensionColor = /^#[0-9a-f]{6}$/i.test(rawDimensionColor) ? rawDimensionColor : "#c9cfcc";
  const diagramFill = options.diagramFill || $("#diagramFill")?.value || "solid";
  const chartLeft = legendPosition === "left" ? 224 : 80;
  const chartRight = legendPosition === "left" ? 1124 : 986;
  const chartTop = 160, chartBottom = 413;
  const dimensionBand = dimensionBandHeight(dimensionItems, labelFontSize);
  const drawW = chartRight - chartLeft, drawH = chartBottom - chartTop - dimensionBand;
  const spanU = maxU - minU, spanZ = maxZ - minZ;
  const fit = fitToChart(spanU, spanZ, drawW, drawH);
  const usedW = spanU * fit, usedH = spanZ * fit;
  const x0 = chartLeft + (drawW - usedW) / 2, y0 = chartTop + (drawH - usedH) / 2;
  const scale = Number(options.scale || $("#scale")?.value || 1);
  const forceScale = Math.min(92, Math.max(20, Math.min(usedW, usedH) * (["MZ", "MY"].includes(comp) ? 0.135 : 0.095))) * scale;
  const pt2 = (p) => [x0 + (p[axis] - minU) * fit, y0 + (maxZ - p[2]) * fit];
  const occupied = [];
  const labelSvg = [];
  const registerText = (target, text, x, y, angle, className, reserve = false) => {
    const box = textBox(text, x, y, labelFontSize, angle);
    if (!reserve && hideOverlaps && occupied.some((other) => boxesOverlap(box, other, 2))) return false;
    occupied.push(box);
    const rotate = Math.abs(angle) > 0.001 ? ` transform="rotate(${angle.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"` : "";
    target.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="${className}" font-size="${labelFontSize.toFixed(2)}"${rotate}>${escapeHtml(text)}</text>`);
    return true;
  };
  const placedDimensions = dimensionItems.map((item) => ({ ...item, A: pt2(item.a), B: pt2(item.b) }));
  const dimensionRow = dimensionRowLayout(placedDimensions, chartBottom, labelFontSize);
  const dimensionLines = [], dimensionLabels = [];
  for (const item of placedDimensions) {
    if (item.type === 0) {
      dimensionLines.push(`<line x1="${item.A[0].toFixed(1)}" y1="${(item.A[1] + dimensionRow.shift).toFixed(1)}" x2="${item.B[0].toFixed(1)}" y2="${(item.B[1] + dimensionRow.shift).toFixed(1)}" class="dimension-line"/>`);
      continue;
    }
    if (!item.text.trim()) continue;
    registerText(dimensionLabels, item.text, (item.A[0] + item.B[0]) / 2, dimensionRow.baseline, 0, "dimension-text", true);
  }
  const contourIndex = (value) => {
    if (count <= 1 || maximum === minimum) return Math.floor(count / 2);
    const threshold = (maximum - value) / (maximum - minimum) * (count - 1);
    return Math.max(0, Math.min(count - 1, Math.round(threshold)));
  };
  const memberLines = [], contourCells = [];
  const labelCandidates = [];
  let outOfPlaneCount = 0;
  const valueMode = options.valueMode || $("#valueMode")?.value || "abs";
  const labelLimitPercent = Number(options.labelLimitPercent || $("#labelLimitPercent")?.value || 0);
  for (const { element, a, b, values } of memberData) {
    const A = pt2(a), B = pt2(b), dx = B[0] - A[0], dy = B[1] - A[1], length = Math.hypot(dx, dy) || 1;
    const nx = dy / length, ny = -dx / length;
    const direction = diagramDirection(element, a, b, plane, comp, [nx, ny]);
    if (values.length && direction.outOfPlane) outOfPlaneCount++;
    const [ox, oy] = direction.vector;
    const points = values.map((value, index) => {
      const ratio = values.length > 1 ? index / (values.length - 1) : 0.5;
      return [A[0] + dx * ratio + ox * value / peak * forceScale, A[1] + dy * ratio + oy * value / peak * forceScale];
    });
    for (let i = 0; i < points.length - 1; i++) {
      const r1 = i / (points.length - 1), r2 = (i + 1) / (points.length - 1), color = palette[contourIndex((values[i] + values[i + 1]) / 2)];
      const p1 = [A[0] + dx * r1, A[1] + dy * r1], p2 = [A[0] + dx * r2, A[1] + dy * r2];
      if (diagramFill === "solid") {
        contourCells.push(`<path data-element-id="${element.id}" d="M${p1[0].toFixed(1)},${p1[1].toFixed(1)} L${points[i][0].toFixed(1)},${points[i][1].toFixed(1)} L${points[i + 1][0].toFixed(1)},${points[i + 1][1].toFixed(1)} L${p2[0].toFixed(1)},${p2[1].toFixed(1)} Z" fill="${color}" fill-opacity=".83" stroke="none"/>`);
      } else if (diagramFill === "line") {
        contourCells.push(`<path data-element-id="${element.id}" d="M${p1[0].toFixed(1)},${p1[1].toFixed(1)} L${points[i][0].toFixed(1)},${points[i][1].toFixed(1)} L${points[i + 1][0].toFixed(1)},${points[i + 1][1].toFixed(1)} L${p2[0].toFixed(1)},${p2[1].toFixed(1)} Z" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-width=".5"/>`);
      } else {
        contourCells.push(`<path data-element-id="${element.id}" d="M${points[i][0].toFixed(1)},${points[i][1].toFixed(1)} L${points[i + 1][0].toFixed(1)},${points[i + 1][1].toFixed(1)}" fill="none" stroke="${color}" stroke-width=".8"/>`);
      }
    }
    memberLines.push(`<line data-element-id="${element.id}" data-member-id="${model.memberByElement.get(element.id)}" x1="${A[0].toFixed(1)}" y1="${A[1].toFixed(1)}" x2="${B[0].toFixed(1)}" y2="${B[1].toFixed(1)}" stroke="#4b5551" stroke-width="${element.type === "BEAM" ? 0.68 : 0.55}" stroke-linecap="round"/>`);
    if (points.length && valueMode !== "none") {
      for (const [labelIndex, { value, ratio }] of valueLabelPoints(values, valueMode).entries()) {
        if (Math.abs(value) < peak * labelLimitPercent / 100) continue;
        const memberCentered = valueMode === "abs" || (valueMode === "all" && labelIndex === 1);
        const labelDirection = memberCentered ? memberAboveNormal(dx, dy) : [ox, oy];
        const anchor = valueLabelPosition(A, [dx, dy], labelDirection, value, ratio, peak, forceScale, labelOffset, memberCentered);
        // GEN NX places result text along the member axis; the diagram offset
        // itself is already expressed by the perpendicular normal (nx, ny).
        let angle = labelOrientation === "auto" ? Math.atan2(dy, dx) * 180 / Math.PI : Number(labelOrientation);
        if (labelOrientation === "auto") {
          // Keep auto-aligned labels upright while preserving their member axis.
          if (angle > 90) angle -= 180;
          else if (angle < -90) angle += 180;
          if (memberCentered && Math.abs(Math.abs(angle) - 90) < 0.001) angle = -90;
        } else {
          while (angle > 180) angle -= 360;
          while (angle < -180) angle += 360;
        }
        labelCandidates.push({ value, text: numberLabel(value), x: anchor[0], y: anchor[1], angle });
      }
    }
  }
  labelCandidates.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  for (const label of labelCandidates) registerText(labelSvg, label.text, label.x, label.y, label.angle, "value-label");
  const diagramMembers = comp === "N" ? memberData : memberData.filter(({ element }) => element.type === "BEAM");
  app.lastDiagnostics = {
    plane: plane.name, loadCase, component: comp, total: diagramMembers.length,
    beam: diagramMembers.filter(({ element }) => element.type === "BEAM").length,
    truss: diagramMembers.filter(({ element }) => element.type !== "BEAM").length,
    trussSkeletonOnly: comp === "N" ? 0 : memberData.length - diagramMembers.length,
    resultCount: diagramMembers.filter(({ values }) => values.length).length,
    missingIds: diagramMembers.filter(({ values }) => !values.length).map(({ element }) => element.id),
    outOfPlaneCount,
  };
  const noMembers = planeMembers.length === 0;
  const unitParts = (result.units || "").split(/[ ,、]+/).filter(Boolean);
  const forceUnit = unitParts[0] || "ANL単位";
  const valueUnit = ["MZ", "MY", "T"].includes(comp) && unitParts[1] ? `${forceUnit} ${unitParts[1]}` : forceUnit;
  const componentName = ({ MZ: "モーメント-z", MY: "モーメント-y", QY: "せん断力-y", QZ: "せん断力-z", N: "軸力", T: "ねじり" })[comp] || componentLabel(comp);
  const metaX = legendPosition === "left" ? 80 : 1000;
  const legendPanelWidth = 174;
  const legendPanelScaleX = 0.78;
  const legendPanelLeft = legendPosition === "left" ? 64 : 1000;
  const legendPanelRight = legendPosition === "left" ? 200 : 1136;
  const legendPanelTranslateX = legendPanelLeft - metaX * legendPanelScaleX;
  const legendDividerX = legendPosition === "left" ? legendPanelRight : legendPanelLeft;
  const barX = metaX + 5, barY = 121, barH = 180, barW = 26, cellH = barH / count;
  // GEN NX identifies the later element when a shared-node extremum is tied.
  const records = memberData.flatMap((member) => member.values.map((value) => ({ value, id: member.element.id })));
  const maxRecord = records.slice().sort((a, b) => b.value - a.value || b.id - a.id)[0];
  const minRecord = records.slice().sort((a, b) => a.value - b.value || b.id - a.id)[0];
  const directionLabel = plane.type === 3 ? "X-Z" : "Y-Z";
  const sheetTitle = drawingTitle(plane, loadCase, comp);
  const legend = `<g class="legend-panel">
    <rect x="${metaX}" y="58" width="174" height="29" fill="#111"/>
    <text x="${metaX + 87}" y="75" text-anchor="middle" class="legend-brand">MIDAS GEN NX</text>
    <text x="${metaX + 87}" y="85" text-anchor="middle" class="legend-post">POST-PROCESSOR</text>
    <text x="${metaX + 87}" y="104" text-anchor="middle" class="legend-diagram">BEAM DIAGRAM</text>
    <line x1="${metaX + 5}" y1="109" x2="${metaX + 169}" y2="109" class="legend-rule"/>
    <text x="${metaX + 87}" y="119" text-anchor="middle" class="legend-component">${escapeHtml(componentName)}</text>
    ${palette.map((color, index) => `<rect x="${barX}" y="${(barY + index * cellH).toFixed(2)}" width="${barW}" height="${(cellH + 0.25).toFixed(2)}" fill="${color}" stroke="#38413d" stroke-width=".24"/>`).join("")}
    ${ranks.map((value, index) => `<line x1="${barX - 2}" y1="${(barY + index * cellH).toFixed(2)}" x2="${barX + barW + 3}" y2="${(barY + index * cellH).toFixed(2)}" class="rank-tick"/><text x="${barX + barW + 53}" y="${(barY + (index + .68) * cellH).toFixed(1)}" class="rank-label">${rankLabel(value)}</text>`).join("")}
    <line x1="${metaX}" y1="381" x2="${metaX + 174}" y2="381" class="legend-rule"/>
    <text x="${metaX + 4}" y="373" class="legend-meta">CB: ${escapeHtml(loadCase)}</text>
    <text x="${metaX + 4}" y="390" class="legend-meta">MAX : ${escapeHtml(maxRecord?.id ?? "—")}</text>
    <text x="${metaX + 4}" y="407" class="legend-meta">MIN : ${escapeHtml(minRecord?.id ?? "—")}</text>
    <text x="${metaX + 4}" y="424" class="legend-meta">FILE:</text>
    <text x="${metaX + 4}" y="439" class="file-label">${escapeHtml(app.model.name.replace(/\.(mgtx|mgt)$/i, ""))}</text>
    <text x="${metaX + 4}" y="455" class="legend-meta">UNIT: ${escapeHtml(valueUnit)}</text>
    <text x="${metaX + 4}" y="471" class="file-label">DATE: ${new Date().toLocaleDateString("en-US")}</text>
    <text x="${metaX + 4}" y="487" class="file-label">表示方向: ${directionLabel}</text>
    <line x1="${metaX}" y1="498" x2="${metaX + 174}" y2="498" class="legend-rule"/>
    <g transform="translate(${metaX + 123} 520)"><line x1="0" y1="0" x2="24" y2="0" stroke="#ec3029" stroke-width="1.2"/><path d="M24 0l-5 -3v6z" fill="#ec3029"/><text x="27" y="3" class="triad-label" fill="#ec3029">X</text><line x1="0" y1="0" x2="-14" y2="-14" stroke="#13a74c" stroke-width="1.2"/><path d="M-14 -14l1 6 5 -4z" fill="#13a74c"/><text x="-23" y="-17" class="triad-label" fill="#13a74c">Y</text><line x1="0" y1="0" x2="0" y2="-25" stroke="#2568dc" stroke-width="1.2"/><path d="M0 -25l-3 5h6z" fill="#2568dc"/><text x="3" y="-20" class="triad-label" fill="#2568dc">Z</text></g>
  </g>`;
  return `<svg class="diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(plane.name)} ${escapeHtml(loadCase)} ${escapeHtml(comp)}応力図">
    <style>
      .dimension-line{stroke:${dimensionColor};stroke-width:${dimensionLineWidth};fill:none}
      .dimension-text,.value-label{font-family:${fontFamily};font-size:${labelFontSize.toFixed(2)}px;font-weight:${fontWeight};fill:${valueColor}}
      .drawing-title{font-family:${fontFamily};font-size:${titleFontSize.toFixed(2)}px;font-weight:${fontWeight};fill:${valueColor}}
      .legend-brand{font:${(legendFontSize * 1.2).toFixed(2)}px Arial,sans-serif;fill:#fff}
      .legend-post{font:${(legendFontSize * 0.8).toFixed(2)}px ${fontFamily};fill:#fff;letter-spacing:.5px}
      .legend-diagram{font:${legendFontSize.toFixed(2)}px ${fontFamily};fill:#171a18}
      .legend-component{font:${legendFontSize.toFixed(1)}px ${fontFamily};fill:#171a18}
      .rank-label{font:${(legendFontSize * 0.92).toFixed(2)}px ${fontFamily};fill:#171a18}
      .rank-tick,.legend-rule{stroke:#343a37;stroke-width:.32}
      .legend-divider,.legend-frame{stroke:#3e4642;stroke-width:.8;fill:none}
      .legend-meta{font:${(legendFontSize * 0.86).toFixed(2)}px ${fontFamily};fill:#171a18}
      .file-label{font:${(legendFontSize * 0.78).toFixed(2)}px ${fontFamily};fill:#171a18}
      .triad-label{font:${(legendFontSize * 0.82).toFixed(2)}px ${fontFamily}}
    </style>
    <!-- The PDF reference places the A4 landscape frame as a centered, shallow wide panel. -->
    <rect x="64" y="58" width="1072" height="473" fill="#fff" ${frame ? 'stroke="#3e4642" stroke-width=".8"' : ""}/>
    <g>${dimensionLines.join("")}</g><g>${contourCells.join("")}</g>
    <g>${memberLines.join("")}</g><g>${dimensionLabels.join("")}${labelSvg.join("")}</g>
    ${frame
      ? `<line x1="${legendDividerX.toFixed(2)}" y1="58" x2="${legendDividerX.toFixed(2)}" y2="531" class="legend-divider"/>`
      : `<rect x="${legendPanelLeft.toFixed(2)}" y="58" width="${(legendPanelRight - legendPanelLeft).toFixed(2)}" height="473" class="legend-frame"/>`}
    <g transform="translate(${legendPanelTranslateX.toFixed(2)} 0) scale(${legendPanelScaleX.toFixed(5)} 1)">${legend}</g>
    <text x="64" y="547" class="drawing-title">${escapeHtml(sheetTitle.line)}</text>
    <text x="64" y="565" class="drawing-title">${escapeHtml(sheetTitle.detail)}</text>
  </svg>`;
}

function currentChoice() {
  const cases = selected("case"), planes = selected("plane");
  const caseIndex = cases.includes(app.previewCase) ? app.previewCase : (cases[0] ?? 0);
  const planeIndex = planes.includes(app.previewPlane) ? app.previewPlane : (planes[0] ?? 0);
  app.previewCase = caseIndex;
  app.previewPlane = planeIndex;
  return { loadCase: app.data?.cases[caseIndex] || "未選択", plane: app.data?.planes[planeIndex] || "未選択", comp: component(), mode: diagramType() };
}

function selectedDiagramSvg(plane, loadCase, choice, options = {}) {
  if (choice.mode === "member" || choice.mode === "section") {
    return app.data.synthetic ? demoNumberingSvg(plane, choice.mode) : numberingDiagramSvg(plane, choice.mode, options);
  }
  return app.data.synthetic ? diagramSvg(plane, loadCase, choice.comp, options) : actualDiagramSvg(plane, loadCase, choice.comp, options);
}

function updatePreview() {
  if (!app.data) return;
  const choice = currentChoice();
  const numbering = choice.mode !== "stress";
  $("#workspace").classList.toggle("numbering-mode", numbering);
  $("#workspace").classList.toggle("member-mode", choice.mode === "member");
  $("#previewPlane").textContent = app.data.synthetic ? choice.plane : (app.data.planes[app.previewPlane]?.name || "未選択");
  $("#previewCase").textContent = choice.loadCase;
  $("#previewComponent").textContent = componentLabel(numbering ? choice.mode : choice.comp);
  const plane = app.data.synthetic ? choice.plane : app.data.planes[app.previewPlane];
  const title = drawingTitle(plane, choice.loadCase, numbering ? choice.mode : choice.comp);
  $("#titlePreview").textContent = numbering ? `${title.line}　${title.detail}` : `${title.line}\n${title.detail}`;
  const hasPlane = selected("plane").length > 0;
  const hasCase = selected("case").length > 0;
  const hasResult = app.data.synthetic || app.result?.parsed?.elements.size > 0;
  $("#diagramHost").innerHTML = !hasPlane || (!numbering && !hasCase)
    ? `<div class="empty-state"><strong>${numbering ? "登録平面" : "ケースと登録平面"}を選択してください</strong>チェックを入れるとプレビューを表示します。</div>`
    : !numbering && !hasResult
      ? `<div class="empty-state"><strong>応力図にはANLが必要です</strong>解析結果ファイルを追加してください。</div>`
      : selectedDiagramSvg(plane, choice.loadCase, choice);
  const diagnostic = app.data.synthetic ? null : app.lastDiagnostics;
  $("#coverageStatus").textContent = diagnostic && hasPlane && (numbering || (hasCase && hasResult))
    ? numbering
      ? `表示: ${diagnostic.resultCount}/${diagnostic.total} 番号（面上の線要素 ${diagnostic.elements}）`
      : `表示: ${diagnostic.resultCount}/${diagnostic.total} 対象要素（梁 ${diagnostic.beam}・トラス系 ${diagnostic.truss}）${diagnostic.trussSkeletonOnly ? `／トラス系 ${diagnostic.trussSkeletonOnly} は骨組み線のみ` : ""}${diagnostic.missingIds.length ? `／結果なし: ${diagnostic.missingIds.join(", ")}` : ""}${diagnostic.outOfPlaneCount ? `／面外方向を図面内へ代替表示: ${diagnostic.outOfPlaneCount}` : ""}`
    : "";
}

function updateOutputCount() {
  const numbering = diagramType() !== "stress";
  const bothNumberTypes = numbering && $("#bothNumberTypes")?.checked;
  const count = selected("plane").length * (numbering ? (bothNumberTypes ? 2 : 1) : selected("case").length);
  $("#outputCount").textContent = count ? `${count} 枚を印刷対象にします（${numbering ? (bothNumberTypes ? "部材番号 → 断面番号" : "登録平面ごと") : "ケース × 平面"}）` : "出力する図を選択してください";
  const ready = app.data?.synthetic || (app.data?.planes.length > 0 && (numbering ? app.model?.parsed?.elements.length > 0 : app.result?.parsed?.elements.size > 0));
  $("#printButton").disabled = !count || !ready;
  $("#svgButton").disabled = !count || !ready;
  if (app.data && !app.data.synthetic && !ready) $("#outputCount").textContent = count ? (numbering ? "MGTXの線要素を読み取れませんでした。" : "応力図には解析結果のANLが必要です。") : "出力する図を選択してください";
}

function refresh() { updatePreview(); updateOutputCount(); }

function loadDemo() {
  app.demo = true;
  app.data = { ...demoData };
  app.model = { name: "demo_model.mgtx" };
  app.result = { name: "demo_result.anl" };
  $("#modelName").textContent = app.model.name;
  $("#resultName").textContent = app.result.name;
  setStatus("サンプルを読み込みました。架空データでケース選択と印刷を試せます。");
  renderChoices();
}

async function loadFiles() {
  const modelFile = $("#modelInput").files[0];
  const resultFile = $("#resultInput").files[0];
  if (!modelFile) { setStatus("MGTXを選択してください。応力図にはANLも必要です。", true); return; }
  setStatus("ファイルをブラウザー内で読み取り中…");
  try {
    const [modelText, resultText] = await Promise.all([readFile(modelFile), resultFile ? readFile(resultFile) : Promise.resolve(null)]);
    const model = parseModel(modelText);
    if (!model.nodes.size || !model.elements.length) throw new Error("MGTXの節点または線要素を読み取れませんでした。");
    const result = resultText === null ? null : parseAnl(resultText);
    if (result) validateModelResult(model, result);
    app.demo = false;
    app.model = { name: modelFile.name, parsed: model };
    app.result = result ? { name: resultFile.name, parsed: result } : null;
    app.data = {
      synthetic: false,
      cases: result?.cases || [],
      planes: model.planes,
      stats: `節点 ${model.nodes.size} · 線要素 ${model.elements.length} · 登録部材 ${model.members.length} · 登録平面 ${model.planes.length}${result ? ` · ANL結果 ${result.elements.size}要素` : ""}`,
      memberCount: model.elements.length,
      nodeCount: model.nodes.size,
    };
    $("#modelName").textContent = modelFile.name;
    $("#resultName").textContent = resultFile?.name || "未選択（番号図には不要）";
    const note = result ? `ANL: ${result.cases.length} ケース、${result.elements.size} 要素分の断面力を検出。` : "部材番号図・断面番号図はこのまま作成できます。応力図にはANLを追加してください。";
    setStatus(`MGTX: 節点 ${model.nodes.size}・線要素 ${model.elements.length}・登録平面 ${model.planes.length} 件。${note}`);
    renderChoices();
  } catch (error) {
    setStatus(`読み込みに失敗しました: ${error.message || error}`, true);
  }
}

function useAll(kind) {
  document.querySelectorAll(`input[data-kind="${kind}"]`).forEach((input) => { input.checked = true; });
  refresh();
}

function downloadSvg() {
  const choice = currentChoice();
  const plane = app.data.synthetic ? choice.plane : app.data.planes[app.previewPlane];
  const svg = selectedDiagramSvg(plane, choice.loadCase, choice);
  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const planeName = typeof plane === "string" ? plane : plane.name;
  a.download = choice.mode === "stress"
    ? `${safeFilename(planeName)}_${safeFilename(choice.loadCase)}_${choice.comp}.svg`
    : `${safeFilename(planeName)}_${choice.mode === "member" ? "部材番号" : "断面番号"}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(value) { return String(value).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60); }

function printBatch() {
  const mode = diagramType();
  if (!app.data?.synthetic && (!app.model?.parsed || (mode === "stress" && !app.result?.parsed?.elements.size))) return;
  const cases = mode === "stress" ? selected("case") : [null], planes = selected("plane");
  const modes = mode !== "stress" && $("#bothNumberTypes")?.checked ? ["member", "section"] : [mode];
  const root = document.createElement("div");
  root.id = "printRoot";
  root.className = "hidden";
  const pages = [];
  for (const outputMode of modes) for (const planeIdx of planes) for (const caseIdx of cases) {
    const plane = app.data.planes[planeIdx], loadCase = caseIdx === null ? "" : app.data.cases[caseIdx];
    const svg = selectedDiagramSvg(plane, loadCase, { mode: outputMode, comp: component() }, { scale: Number($("#scale").value) });
    const pageOrientation = $("#orientation").value === "portrait" ? "portrait" : "landscape";
    pages.push(`<section class="print-page ${pageOrientation}"><div class="print-svg">${svg}</div></section>`);
  }
  root.innerHTML = pages.join("");
  document.body.appendChild(root);
  document.body.classList.add("printing");
  document.body.classList.toggle("print-portrait", $("#orientation").value === "portrait");
  const cleanup = () => { root.remove(); document.body.classList.remove("printing", "print-portrait"); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  window.print();
  setTimeout(cleanup, 1200);
}

for (const [inputId, nameId, kind] of [["modelInput", "modelName", "model"], ["resultInput", "resultName", "result"]]) {
  $(`#${inputId}`).addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $(`#${nameId}`).textContent = file.name;
    const other = kind === "model" ? $("#resultInput").files[0] : $("#modelInput").files[0];
    if (kind === "model" || other) await loadFiles();
  });
  const drop = $(`#${kind === "model" ? "modelDrop" : "resultDrop"}`);
  for (const eventName of ["dragenter", "dragover"]) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.add("dragging"); });
  for (const eventName of ["dragleave", "drop"]) drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.remove("dragging"); });
  drop.addEventListener("drop", async (event) => {
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const target = $(`#${inputId}`);
    const transfer = new DataTransfer(); transfer.items.add(file); target.files = transfer.files;
    $(`#${nameId}`).textContent = file.name;
    if (kind === "model" || $("#modelInput").files[0]) await loadFiles();
  });
}

document.addEventListener("change", (event) => {
  if (event.target.matches('input[name="diagramType"]')) syncFontSizeForMode();
  if (event.target.matches('#labelFontSize')) app.fontSizes[app.fontSizeMode] = event.target.value;
  if (event.target.matches('input[data-kind], input[name="diagramType"], input[name="component"], #bothNumberTypes, #titleLine, #scale, #frame, #valueMode, #showDimensions, #showMemberEnds, #memberEndSize, #memberEndInset, #hideOverlaps, #contourColors, #legendPosition, #decimalPlaces, #rankDecimals, #diagramFill, #labelOrientation, #labelOffsetMm, #fontFamily, #labelFontSize, #legendFontSize, #fontWeight, #valueColor, #dimensionLineWidth, #dimensionColor, #labelLimitPercent')) refresh();
  if (event.target.matches("#orientation")) document.body.classList.toggle("print-portrait", event.target.value === "portrait");
});
$("#caseAll").addEventListener("click", () => useAll("case"));
$("#planeAll").addEventListener("click", () => useAll("plane"));
$("#demoButton").addEventListener("click", loadDemo);
$("#printButton").addEventListener("click", printBatch);
$("#svgButton").addEventListener("click", downloadSvg);

$("#diagramHost").innerHTML = `<div class="empty-state"><strong>サンプルを読み込むと、操作をすぐに試せます</strong>実ファイルの出力確認には、MGTX / ANL の形式を合わせる必要があります。</div>`;
