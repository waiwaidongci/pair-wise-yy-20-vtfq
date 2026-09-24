// 候选存档层测试：node test/audition.test.mjs
import { openAudition, applyCandidate, sessionConflict, saveAudition, loadAudition } from "../js/audition.js";

globalThis.localStorage = (() => {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
})();

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok  :", msg);
}

const tokens = ["仓", "冬", "才", "台"];
const blank = () => Array(16).fill("");
const pattern = tokens.map((t) => {
  const row = blank();
  [0, 4, 8, 12].forEach((s) => { row[s] = t; });
  return row;
});

const candGrid = tokens.map((t, r) => {
  const g = ["", "", "", ""].map(() => "");
  g[0] = tokens[r];          // 口令格保留
  g[1] = r % 2 ? tokens[r] : ""; // 非口令加花
  return g;
});

const snapshot = pattern.map((row) => [...row]);
const session = openAudition({
  measure: 1, seed: 123, frozen: [0],
  candidates: [{ density: "medium", label: "适中", hits: 6, grid: candGrid }],
  patternSnapshot: snapshot
});

// 采纳只替换第2小节，其余不动
const next = applyCandidate(pattern, session, 0);
assert(next !== pattern, "采纳返回新数组（不就地改原谱）");
assert(next[0][0] === pattern[0][0] && next[0][8] === pattern[0][8], "第1、3小节及以后保持不变");
assert(next[0][5] === candGrid[0][1] && next[3][5] === candGrid[3][1], "第2小节被候选替换");
assert(pattern[0][5] === "", "采纳前的原谱对象未被污染");

// 未改动 → 无冲突
assert(sessionConflict(pattern, session) === false, "目标小节未改动时无冲突");

// 改动第2小节 → 冲突
const edited = pattern.map((row) => [...row]);
edited[0][5] = "仓";
assert(sessionConflict(edited, session) === true, "试听期间改动目标小节能检出冲突");

// 改动其它小节 → 不算冲突（采纳只看目标小节）
const editedElse = pattern.map((row) => [...row]);
editedElse[0][9] = "仓";
assert(sessionConflict(editedElse, session) === false, "改动其它小节不影响目标小节采纳");

// 会话持久化：重新读取等价（关掉页面再打开接着试听）
saveAudition(session);
const restored = loadAudition();
assert(restored.measure === 1 && restored.seed === 123, "会话可从存档恢复（小节/种子）");
assert(JSON.stringify(restored.candidates) === JSON.stringify(session.candidates), "恢复后候选与生成时一致");

console.log(process.exitCode ? "\n有失败用例" : "\n全部通过");
