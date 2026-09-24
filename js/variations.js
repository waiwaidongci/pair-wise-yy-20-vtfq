// 变奏生成规则（纯函数层）
// 与页面、存档解耦：给定谱面与种子，永远得到同一份结果（可复现）。

export const stepsPerMeasure = 4;
export const measureCount = 4;

// 三档密度：稀疏 / 适中 / 密集
export const densities = [
  { id: "sparse", label: "稀疏", ratio: 0.25 },
  { id: "medium", label: "适中", ratio: 0.55 },
  { id: "dense", label: "密集", ratio: 0.85 }
];

// 确定性伪随机数（mulberry32）：同种子同序列，保证候选可复现。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 由当前谱面派生种子：同一谱面同一盐值得到同一批候选。
export function createSeed(pattern, measure, salt) {
  const basis = `${measure}|${pattern.map((row) => row.join(".")).join("/")}`;
  return (hashString(basis) ^ Math.imul(salt >>> 0, 2654435761)) >>> 0;
}

// 口令格（强拍齐奏位）：该步四声部全部有口令，是师傅领奏的骨架，不能动。
export function commandSteps(pattern, measure) {
  const start = measure * stepsPerMeasure;
  const result = [];
  for (let s = 0; s < stepsPerMeasure; s += 1) {
    const step = start + s;
    if (pattern.every((row) => Boolean(row[step]))) result.push(s);
  }
  return result;
}

function shuffleTake(list, count, rand) {
  const pool = [...list];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function emptyGrid() {
  return Array.from({ length: 4 }, () => Array(stepsPerMeasure).fill(""));
}

// 单档候选：口令格整格保留；非口令格里已有的字保留，只在空白格按密度抽点加花。
function buildOne(pattern, measure, frozen, ratio, rand, tokens) {
  const start = measure * stepsPerMeasure;
  const free = [];
  for (let r = 0; r < 4; r += 1) {
    for (let s = 0; s < stepsPerMeasure; s += 1) {
      if (!frozen.has(s) && !pattern[r][start + s]) free.push({ r, s });
    }
  }
  const emptyCount = free.length;
  const chosen = new Set(shuffleTake(free, Math.round(emptyCount * ratio), rand).map((p) => `${p.r}-${p.s}`));

  const grid = emptyGrid();
  for (let r = 0; r < 4; r += 1) {
    for (let s = 0; s < stepsPerMeasure; s += 1) {
      if (frozen.has(s)) {
        grid[r][s] = pattern[r][start + s]; // 保留口令，原字原位
      } else if (pattern[r][start + s]) {
        grid[r][s] = pattern[r][start + s]; // 已有非口令字保留
      } else if (chosen.has(`${r}-${s}`)) {
        grid[r][s] = tokens[r]; // 新加的花用该声部首字
      }
    }
  }
  return grid;
}

const signature = (grid) => grid.map((row) => row.map((v) => (v ? "1" : "0")).join("")).join("");
const sameGrid = (a, b) => signature(a) === signature(b);

function countHits(grid) {
  return grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
}

// 生成三档候选。失败时返回 { ok:false, reason }，原谱不动。
export function generateCandidates(pattern, measure, seed, tokens) {
  const frozen = new Set(commandSteps(pattern, measure));
  const current = pattern.map((row) => row.slice(measure * stepsPerMeasure, measure * stepsPerMeasure + 4));

  // 可加花格 = 非口令格里的空白格（已有字保留，不动）
  const start = measure * stepsPerMeasure;
  let emptySlots = 0;
  for (let r = 0; r < 4; r += 1) {
    for (let s = 0; s < stepsPerMeasure; s += 1) {
      if (!frozen.has(s) && !pattern[r][start + s]) emptySlots += 1;
    }
  }

  // 失败一：保留点太满——空白非口令格凑不齐稀疏/适中/密集三档严格递增所需的至少 3 个位置
  if (emptySlots < densities.length) {
    return {
      ok: false,
      reason: `保留点太满：第${measure + 1}小节口令骨架之外仅剩 ${emptySlots} 个空白格可加花，凑不齐稀疏/适中/密集三档。`
    };
  }

  // 失败二：三档必须彼此不同，且不得与当前完全相同
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const rands = densities.map((_, i) => mulberry32((seed + attempt * 7919 + i * 104729) >>> 0));
    const candidates = densities.map((d, i) => buildOne(pattern, measure, frozen, d.ratio, rands[i], tokens));

    const distinct = candidates.every((c, i) => candidates.every((other, j) => i === j || !sameGrid(c, other)));
    const differsFromCurrent = candidates.every((c) => !sameGrid(c, current));

    if (distinct && differsFromCurrent) {
      return {
        ok: true,
        frozen: [...frozen],
        candidates: densities.map((d, i) => ({
          density: d.id,
          label: d.label,
          hits: countHits(candidates[i]),
          grid: candidates[i]
        }))
      };
    }
  }

  // 失败三：候选与当前相同（或三档撞车），60 个种子偏移内凑不齐
  return {
    ok: false,
    reason: `候选与当前谱面相同或三份凑不齐：第${measure + 1}小节在口令骨架受限下无法生成三份互不相同的变奏。`
  };
}
