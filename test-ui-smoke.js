/*
 * 页面操作层冒烟测试（无浏览器环境下的最小 DOM 桩）
 * 加载真实的 variations.js / candidates.js / app.js，
 * 模拟：默认谱面生成 → 三份候选落试听区 → 正式谱面未变 →
 *      采纳第2份 → 仅该小节被替换、保留格未动、其余小节照旧 → 重新读档持久化
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

class Element {
  constructor(tag = "div", attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parentNode = null;
    this._innerHTML = "";
    this.hidden = false;
    this.className = attrs.class || "";
    this.value = attrs.value || "";
    this.dataset = {};
    this.textContent = "";
    this.listeners = {};
    this.classList = {
      _set: new Set((attrs.class || "").split(/\s+/).filter(Boolean)),
      add(...names) { names.forEach((n) => this._set.add(n)); },
      remove(...names) { names.forEach((n) => this._set.delete(n)); },
      toggle(name, force) {
        const on = force === undefined ? !this._set.has(name) : force;
        this[on ? "add" : "remove"](name);
        return on;
      },
      contains(name) { return this._set.has(name); }
    };
  }
  set innerHTML(html) {
    this._innerHTML = html;
    this.children = []; // 桩不解析 HTML；事件走容器委托
  }
  get innerHTML() {
    return this._innerHTML;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatch(type, event = {}) {
    for (const fn of this.listeners[type] || []) fn.call(this, { target: this, ...event });
  }
  closest() {
    return this; // 桩元素本身即点击目标
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  classListOf() {
    return new Set(this.className.split(/\s+/).filter(Boolean));
  }
}

const ids = [
  "grid", "savedList", "structure", "notesList", "pieceName", "bpmInput",
  "loopSelect", "noteInput", "varMeasure", "varDensity", "generateBtn",
  "lockBtn", "lockHint", "audition", "auditionMeta", "candidateList",
  "dismissBtn", "auditionConflict", "statusBox", "playBtn", "stopBtn", "saveBtn"
];
const elements = {};
for (const id of ids) elements[id] = new Element("div", { id });

// 候选卡片里的按钮 / mini-cell：从 innerHTML 解析出的交互用专用桩构造
function makeActionButton(action, candidate) {
  const btn = new Element("button");
  btn.dataset.action = action;
  btn.dataset.candidate = String(candidate);
  return btn;
}

// candidateList 拦截 innerHTML 赋值，建立可点击按钮
const realCandidateList = elements.candidateList;
Object.defineProperty(realCandidateList, "innerHTML", {
  get() {
    return this._innerHTML;
  },
  set(html) {
    this._innerHTML = html;
    this.children = [];
    for (let i = 0; i < 3; i += 1) {
      const preview = makeActionButton("preview", i);
      const adopt = makeActionButton("adopt", i);
      this.appendChild(preview);
      this.appendChild(adopt);
    }
  }
});
realCandidateList.querySelector = function (selector) {
  const m = selector.match(/data-action="preview"\]\[data-candidate="(\d+)"/);
  if (!m) return null;
  return this.children.find((el) => el.dataset.action === "preview" && el.dataset.candidate === m[1]);
};

const documentStub = {
  querySelector(sel) {
    const id = sel.match(/^#([\w-]+)$/)?.[1];
    return id ? elements[id] : null;
  },
  querySelectorAll: () => []
};

const storageMap = new Map();
const localStorageStub = {
  getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
  setItem: (k, v) => storageMap.set(k, String(v)),
  removeItem: (k) => storageMap.delete(k)
};

const intervalStore = [];
const sandbox = {
  console,
  document: documentStub,
  localStorage: localStorageStub,
  crypto: { randomUUID: () => `test-${Math.random().toString(36).slice(2)}` },
  AudioContext: class {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
    }
    createOscillator() {
      return {
        frequency: { value: 0 }, type: "",
        connect() { return this; },
        start() {}, stop() {}
      };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() { return this; } };
    }
  },
  setInterval: (fn, ms) => {
    const handle = { fn, ms };
    intervalStore.push(handle);
    return handle;
  },
  clearInterval: (handle) => {
    const i = intervalStore.indexOf(handle);
    if (i >= 0) intervalStore.splice(i, 1);
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  Date,
  Math,
  JSON
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const file of ["variations.js", "candidates.js", "app.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), sandbox, { filename: file });
}
const state = vm.runInContext("state", sandbox);

function countMeasure(measureIndex) {
  const start = measureIndex * 4;
  return state.pattern.flatMap((row) => row.slice(start, start + 4)).filter(Boolean).length;
}

// 1. 初始：每小节 4 点
for (let m = 0; m < 4; m += 1) assert.strictEqual(countMeasure(m), 4, `第${m + 1}小节初始 4 点`);
console.log("✓ 初始谱面四小节各 4 点");

// 2. 选第2小节 + 适中，点生成
elements.varMeasure.value = "1";
elements.varDensity.value = "适中";
elements.generateBtn.dispatch("click");
assert.strictEqual(elements.audition.hidden, false, "试听区应显示");
console.log("✓ 生成后试听区显示");

// 3. 正式谱面未变（仍 4 点）
assert.strictEqual(countMeasure(1), 4, "生成/试听不得改动正式谱面");
console.log("✓ 候选停在试听区，正式第2小节仍为 4 点");

// 4. 三份候选在存档里，刷新页面后仍可读
const persisted = JSON.parse(storageMap.get("wxyy-4-luogujing-variation-audition"));
assert.strictEqual(persisted.candidates.length, 3);
assert.strictEqual(persisted.measure, 1);
assert.strictEqual(persisted.tier, "适中");
console.log("✓ 候选批次已入独立存档，关闭重开可续听");

// 5. 试听第1份（只响候选）—— 事件委托在 candidateList 上
const previewBtn0 = realCandidateList.children[0];
realCandidateList.dispatch("click", { target: previewBtn0 });
assert.strictEqual(intervalStore.length, 1, "试听应启动循环");
console.log("✓ 试听本份启动独立循环（只响候选）");

// 6. 采纳第2份（children: preview0, adopt0, preview1, adopt1 → 下标3）
const adoptBtn1 = realCandidateList.children[3];
realCandidateList.dispatch("click", { target: adoptBtn1 });
assert.strictEqual(elements.audition.hidden, true, "采纳后试听区关闭");
assert.strictEqual(intervalStore.length, 0, "采纳应停止试听循环");
assert.strictEqual(countMeasure(1), 8, "第2小节应替换为 8 点");
for (let m of [0, 2, 3]) assert.strictEqual(countMeasure(m), 4, `第${m + 1}小节照旧 4 点`);
console.log("✓ 采纳第2份：仅第2小节变 8 点，其余小节照旧");

// 7. 采纳结果写入正式谱面存档；候选独立存档已清
const mainSaved = JSON.parse(storageMap.get("wxyy-4-luogujing-grid"));
assert.strictEqual(mainSaved.pattern.flat().filter(Boolean).length, 4 + 8 + 4 + 4);
assert.strictEqual(storageMap.has("wxyy-4-luogujing-variation-audition"), false);
console.log("✓ 替换写入正式谱面存档，候选批次已清");

// 8. 已存方案不受影响地照常工作
elements.saveBtn.dispatch("click");
assert.strictEqual(state.saved.length, 1, "保存方案仍可用");
console.log("✓ 已存方案功能照旧（含 locks 字段）");

// 9. 保留点太满 → 稀疏档失败、谱面保留、冲突提示含小节/保留/原因
//    第1小节先临时点到 5 个口令并全部钉住（稀疏目标只有 4）
state.pattern[0][1] = "仓";
state.locks = state.pattern.map((row) => row.map((v) => Boolean(v)));
elements.varMeasure.value = "0";
elements.varDensity.value = "稀疏";
const beforeFail = countMeasure(0);
elements.generateBtn.dispatch("click");
assert.strictEqual(countMeasure(0), beforeFail, "失败必须保留原谱");
assert.ok(elements.auditionConflict.innerHTML.includes("第1小节"), "冲突应指出小节");
assert.ok(elements.auditionConflict.innerHTML.includes("保留口令"), "冲突应列出保留口令");
assert.ok(elements.auditionConflict.innerHTML.includes("失败原因"), "冲突应给出失败原因");
assert.ok(elements.auditionConflict.innerHTML.includes("保留点太满"), "5 个保留口令对稀疏档应报保留点太满");
console.log("✓ 5 个保留口令 + 稀疏 → 保留原谱，并指出冲突小节/保留口令/失败原因");

console.log("\n页面操作层冒烟测试全部通过");
