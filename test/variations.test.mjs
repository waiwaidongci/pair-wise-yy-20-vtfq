// 生成规则冒烟测试：node test/variations.test.mjs
import { generateCandidates, createSeed, commandSteps } from "../js/variations.js";

const tokens = ["仓", "冬", "才", "台"];
const basePattern = tokens.map((t) => Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? t : "")));

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok  :", msg);
  }
}

// 1. 默认谱面：能生成三份、互不相同、可复现
const seed = createSeed(basePattern, 1, 1);
const r1 = generateCandidates(basePattern, 1, seed, tokens);
assert(r1.ok, "默认谱面第2小节生成成功");
assert(r1.candidates.length === 3, "恰好三份候选");
const sigs = r1.candidates.map((c) => c.grid.map((row) => row.map((v) => v ? 1 : 0).join("")).join(""));
assert(new Set(sigs).size === 3, "三份彼此不同");
const r1b = generateCandidates(basePattern, 1, seed, tokens);
assert(JSON.stringify(r1) === JSON.stringify(r1b), "同谱面同种子可复现");

// 2. 口令格保留：第1拍四声部原值不动
const frozen = r1.frozen;
r1.candidates.forEach((c) => {
  frozen.forEach((s) => {
    for (let r = 0; r < 4; r++) {
      assert(c.grid[r][s] === basePattern[r][4 + s], `候选口令格 r${r} s${s} 保留`);
    }
  });
});
assert(frozen.includes(0), "强拍第1拍被识别为口令格");

// 3. 密度严格递增（响数）
const hits = r1.candidates.map((c) => c.hits);
assert(hits[0] < hits[1] && hits[1] < hits[2], `响数递增 稀疏${hits[0]} < 适中${hits[1]} < 密集${hits[2]}`);

// 4. 保留点太满：非口令格只剩 < 3 个可加花位 → 失败
// 构造第0小节：步0齐奏(口令)，步1/2/3 只留 2 个空位（其余填满）
const full = tokens.map((t) => Array.from({ length: 16 }, () => t));
// 先全空再定制
const crowded = tokens.map(() => Array(16).fill(""));
for (let r = 0; r < 4; r++) crowded[r][0] = tokens[r]; // 步0口令齐奏
// 步1：4行全满；步2：4行全满；步3只放 r0，剩 3 空位
for (let r = 0; r < 4; r++) { crowded[r][1] = tokens[r]; crowded[r][2] = tokens[r]; }
crowded[0][3] = "仓"; // 步3 剩 r1,r2,r3 三个空位 => freeSlots=3 恰好够
const okEdge = generateCandidates(crowded, 0, 99, tokens);
assert(okEdge.ok, "恰有3个可加花位时仍可生成");
crowded[1][3] = "冬"; // 剩 2 空位 => 失败
const failFull = generateCandidates(crowded, 0, 99, tokens);
assert(!failFull.ok && /保留点太满/.test(failFull.reason), "可加花位不足时报告保留点太满: " + failFull.reason);

// 5. 候选与当前相同：非口令格全满（无加花空间）→ 失败
const allFull = tokens.map((t) => Array.from({ length: 16 }, () => t));
const failSame = generateCandidates(allFull, 2, 7, tokens);
assert(!failSame.ok, "全满小节生成失败并保留原谱");

// 6. 不同盐值/种子产生不同批次（重新生成出花）
const seedA = createSeed(basePattern, 1, 1);
const seedB = createSeed(basePattern, 1, 2);
const ra = generateCandidates(basePattern, 1, seedA, tokens);
const rb = generateCandidates(basePattern, 1, seedB, tokens);
assert(JSON.stringify(ra.candidates) !== JSON.stringify(rb.candidates), "不同盐值得到不同候选");

console.log(process.exitCode ? "\n有失败用例" : "\n全部通过");
