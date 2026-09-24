// 页面层端到端冒烟（最小 DOM 桩）：node test/app.smoke.mjs
// 验证：挂载 → 生成三份候选停在试听区 → 刷新后会话仍在 → 采纳只替换目标小节。

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

function makeEl(id) {
  return {
    id,
    value: "",
    textContent: "",
    className: "",
    innerHTML: "",
    disabled: false,
    dataset: {},
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelectorAll: () => [],
    closest: () => null
  };
}

const els = {};
const ids = ["#grid", "#savedList", "#structure", "#notesList", "#pieceName", "#bpmInput",
  "#loopSelect", "#noteInput", "#variationMeasure", "#generateBtn", "#candidateArea",
  "#variationMessage", "#playBtn", "#stopBtn", "#saveBtn"];
ids.forEach((id) => { els[id] = makeEl(id); });

globalThis.document = {
  querySelector: (id) => els[id],
  querySelectorAll: () => []
};

await import("../app.js");

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok  :", msg);
}

const scoreKey = "wxyy-4-luogujing-grid";
const auditionKey = "wxyy-4-luogujing-audition";
// 默认谱面：每声部在每小节首拍（0/4/8/12）有字
const before = ["仓", "冬", "才", "台"].map((t) => Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? t : "")));

// 1. 选第2小节并生成
els["#variationMeasure"].value = "1";
els["#generateBtn"].listeners.click({});
const areaHtml = els["#candidateArea"].innerHTML;
assert((areaHtml.match(/class="candidate(\s|")/g) || []).length === 3, "试听区出现三份候选卡片");
assert(/稀疏/.test(areaHtml) && /适中/.test(areaHtml) && /密集/.test(areaHtml), "三档标签齐全");
assert(/data-audition-adopt="0"/.test(areaHtml) && /data-audition-adopt="2"/.test(areaHtml), "每份都有采纳按钮");

// 2. 正式谱面在试听期间未被改动（生成不触发主存档写入）
assert(store[scoreKey] === undefined, "试听期间正式谱面未被触碰");

// 3. 候选已独立存档（关掉页面再打开可恢复）
const persisted = JSON.parse(store[auditionKey]);
assert(persisted && persisted.measure === 1 && persisted.candidates.length === 3, "试听会话独立持久化（刷新可接着试听）");

// 4. 采纳第1份（适中档 index=1）
const adoptEvent = {
  target: {
    closest: (sel) => (sel === "[data-audition-adopt]" ? { dataset: { auditionAdopt: "1" } } : null)
  }
};
els["#candidateArea"].listeners.click(adoptEvent);
const after = JSON.parse(store[scoreKey]).pattern;

// 第2小节被替换为候选
const adopted = persisted.candidates[1].grid;
let targetChanged = false;
for (let r = 0; r < 4; r++) {
  for (let s = 0; s < 4; s++) {
    if (after[r][4 + s] !== adopted[r][s]) targetChanged = true;
  }
}
assert(!targetChanged, "采纳后第2小节与所选候选完全一致");

// 其余 15 列（第1/3/4小节）原封不动
let othersChanged = false;
for (let r = 0; r < 4; r++) {
  for (let step = 0; step < 16; step++) {
    if (step >= 4 && step <= 7) continue;
    if (after[r][step] !== before[r][step]) othersChanged = true;
  }
}
assert(!othersChanged, "其余小节与已存方案照旧（仅目标小节变化）");

// 5. 采纳后试听会话被清空
assert(store[auditionKey] === undefined, "采纳后候选存档已清除");
assert(/已采纳第2小节/.test(els["#variationMessage"].textContent), "采纳成功提示");

// 6. 失败路径：构造一个空白非口令格不足的谱面，重新生成应保留原谱
const crowded = JSON.parse(store[scoreKey]);
crowded.pattern = crowded.pattern.map((row) => row.map((v, i) => (i % 4 === 0 ? v : "X")));
// 只留 2 个空格在第0小节非口令位
crowded.pattern[0][1] = "";
crowded.pattern[0][2] = "";
store[scoreKey] = JSON.stringify(crowded);

// 重新导入一个全新模块实例，避免复用内存中的 state
delete globalThis.document;
const els2 = {};
ids.forEach((id) => { els2[id] = makeEl(id); });
globalThis.document = { querySelector: (id) => els2[id], querySelectorAll: () => [] };
// 清掉旧试听
delete store[auditionKey];
await import(`../app.js?bust=${Date.now()}`);
els2["#variationMeasure"].value = "0";
els2["#generateBtn"].listeners.click({});
const msg = els2["#variationMessage"];
assert(/保留原谱/.test(msg.textContent) && /保留点太满/.test(msg.textContent), "空白格不足时保留原谱并说明失败原因");
assert(/第1小节/.test(msg.textContent) && /保留口令格/.test(msg.textContent), "指出冲突小节与保留口令");
assert(store[auditionKey] === undefined, "失败时不写候选存档");

console.log(process.exitCode ? "\n有失败用例" : "\n全部通过");
