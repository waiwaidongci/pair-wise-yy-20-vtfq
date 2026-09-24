const assert = require("assert");
const V = require("./variations");

const TOKENS = ["仓", "冬", "才", "台"];
const ROWS = 4;
const COLS = 4;

function emptyMeasure() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(""));
}

function measureFromRows(rows) {
  return rows.map((row) => [...row]);
}

function key(matrix) {
  return matrix.map((row) => row.map((v) => v || ".").join("")).join("/");
}

function filledCount(matrix) {
  return matrix.flat().filter(Boolean).length;
}

function noLocks() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(false));
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 默认小节：每乐器只在第1拍有口令（4 点）
const defaultMeasure = measureFromRows(TOKENS.map((t) => [t, "", "", ""]));

test("同一输入两次生成 → 三份候选逐格一致（可复现）", () => {
  const a = V.generate({ tokens: TOKENS, measure: defaultMeasure, locked: noLocks(), tier: "适中", context: "出场|0" });
  const b = V.generate({ tokens: TOKENS, measure: defaultMeasure, locked: noLocks(), tier: "适中", context: "出场|0" });
  assert.strictEqual(a.ok, true);
  assert.deepStrictEqual(a.candidates, b.candidates);
  assert.strictEqual(a.seed, b.seed);
});

test("换剧目/小节上下文 → 种子不同，可能得到不同候选", () => {
  const a = V.generate({ tokens: TOKENS, measure: defaultMeasure, tier: "适中", context: "出场|0" });
  const b = V.generate({ tokens: TOKENS, measure: defaultMeasure, tier: "适中", context: "出场|1" });
  assert.notStrictEqual(a.seed, b.seed);
});

test("一次返回三份，彼此不同且都与当前谱面不同", () => {
  const r = V.generate({ tokens: TOKENS, measure: defaultMeasure, tier: "适中" });
  assert.strictEqual(r.candidates.length, 3);
  const keys = r.candidates.map(key);
  assert.strictEqual(new Set(keys).size, 3);
  assert.ok(!keys.includes(key(defaultMeasure)));
});

test("三档点数分别为 4 / 8 / 12", () => {
  for (const [tier, target] of [["稀疏", 4], ["适中", 8], ["密集", 12]]) {
    const r = V.generate({ tokens: TOKENS, measure: defaultMeasure, tier });
    assert.strictEqual(r.ok, true, `${tier} 应成功`);
    r.candidates.forEach((c) => assert.strictEqual(filledCount(c), target, `${tier} 候选点数应为 ${target}`));
  }
});

test("候选里的口令只取本乐器自己的 token", () => {
  const r = V.generate({ tokens: TOKENS, measure: defaultMeasure, tier: "密集" });
  r.candidates.forEach((c) => c.forEach((row, rIdx) =>
    row.forEach((v) => assert.ok(v === "" || v === TOKENS[rIdx]))));
});

test("保留口令格：逐格保留（含空拍钉住也保持空）", () => {
  const measure = measureFromRows(defaultMeasure);
  const locks = noLocks();
  // 钉住 大锣 第1拍「仓」、鼓 第1拍「冬」，并把 钹 第3拍空格钉为空
  locks[0][0] = true;
  locks[1][0] = true;
  locks[2][2] = true;
  const r = V.generate({ tokens: TOKENS, measure, locked: locks, tier: "适中" });
  assert.strictEqual(r.ok, true);
  r.candidates.forEach((c) => {
    assert.strictEqual(c[0][0], "仓");
    assert.strictEqual(c[1][0], "冬");
    assert.strictEqual(c[2][2], "");
  });
});

test("保留口令点数超过该档目标 → locked-too-full（保留点太满）", () => {
  const measure = emptyMeasure();
  const locks = noLocks();
  // 钉 5 个点，稀疏档目标只有 4
  [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1]].forEach(([r, c]) => {
    measure[r][c] = TOKENS[r];
    locks[r][c] = true;
  });
  const r = V.generate({ tokens: TOKENS, measure, locked: locks, tier: "稀疏" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "locked-too-full");
  assert.strictEqual(r.lockedFilled, 5);
});

test("可动格全填满也凑不到目标 → locked-too-full", () => {
  // 钉住 13 个空格，可动格只剩 3，稀疏需要 4 点；保留点本身 0 个
  const measure = emptyMeasure();
  const locks = noLocks();
  let pinned = 0;
  for (let r = 0; r < ROWS && pinned < 13; r += 1) {
    for (let c = 0; c < COLS && pinned < 13; c += 1) {
      locks[r][c] = true;
      pinned += 1;
    }
  }
  const r = V.generate({ tokens: TOKENS, measure, locked: locks, tier: "稀疏" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "locked-too-full");
  assert.strictEqual(r.lockedFilled, 0);
  assert.strictEqual(r.need, 4);
});

test("可动格唯一排法且等于当前 → same-as-current（候选与当前相同）", () => {
  // 钉住 15 格（其中 4 个有口令），可动格只剩 1 格；稀疏档目标 4，need=0，唯一候选即当前
  const measure = emptyMeasure();
  const locks = noLocks();
  [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([r, c]) => { measure[r][c] = TOKENS[r]; });
  let pinned = 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      if (r === 3 && c === 3) continue; // 唯一可动格
      locks[r][c] = true;
      pinned += 1;
    }
  }
  assert.strictEqual(pinned, 15);
  const r = V.generate({ tokens: TOKENS, measure, locked: locks, tier: "稀疏" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "same-as-current");
  assert.strictEqual(r.poolSize, 1);
});

test("可动格组合不足三份 → not-enough-variants（三份凑不齐）", () => {
  // 钉 14 格含 4 点，可动格 2 个、need=0：候选只有 1 种但与当前相同 → poolSize=1
  const measure = emptyMeasure();
  const locks = noLocks();
  [[0, 0], [1, 0], [2, 0], [3, 0]].forEach(([r, c]) => { measure[r][c] = TOKENS[r]; });
  let pinned = 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      if ((r === 3 && c === 3) || (r === 3 && c === 2)) continue;
      locks[r][c] = true;
      pinned += 1;
    }
  }
  assert.strictEqual(pinned, 14);
  const r = V.generate({ tokens: TOKENS, measure, locked: locks, tier: "稀疏" });
  assert.strictEqual(r.ok, false);
  // poolSize=1 且当前可达 → 按「候选与当前相同」上报
  assert.strictEqual(r.reason, "same-as-current");
});

test("组合数为 2（排除当前后不足三份）→ not-enough-variants", () => {
  // 钉 13 格含 3 点，可动格 3 个、need=1：C(3,1)=3，当前占 1，余 2 < 3
  const measure = emptyMeasure();
  const locks = noLocks();
  [[0, 0], [1, 0], [2, 0]].forEach(([r, c]) => { measure[r][c] = TOKENS[r]; });
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      if (r >= 3 && c <= 2) continue; // 3 个可动格，均在第4行
      locks[r][c] = true;
    }
  }
  // 让当前谱面在可动格里恰好有 1 点
  measure[3][0] = "台";
  const r = V.generate({ tokens: TOKENS, measure, locked: locks, tier: "稀疏" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "not-enough-variants");
  assert.strictEqual(r.poolSize, 3);
});

test("改了保留格/谱面内容 → 种子随之改变，候选可复现地更新", () => {
  const r1 = V.generate({ tokens: TOKENS, measure: defaultMeasure, tier: "稀疏", context: "x|0" });
  const changed = measureFromRows(defaultMeasure);
  changed[0][1] = "仓";
  const r2 = V.generate({ tokens: TOKENS, measure: changed, tier: "稀疏", context: "x|0" });
  assert.notStrictEqual(r1.seed, r2.seed);
  const r2again = V.generate({ tokens: TOKENS, measure: changed, tier: "稀疏", context: "x|0" });
  assert.deepStrictEqual(r2.candidates, r2again.candidates);
});

test("密集档下保留格上的空拍也不被动", () => {
  const measure = emptyMeasure();
  const locks = noLocks();
  locks[0][1] = true; // 钉住一个空拍
  const r = V.generate({ tokens: TOKENS, measure, locked: locks, tier: "密集" });
  assert.strictEqual(r.ok, true);
  r.candidates.forEach((c) => assert.strictEqual(c[0][1], ""));
});

console.log(`\n${passed} 项规则测试全部通过`);
