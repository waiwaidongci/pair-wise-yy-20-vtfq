/*
 * 锣鼓经排练台 · 变奏生成规则
 * 纯逻辑模块：输入「小节谱面 + 保留格 + 密度档」，输出三份可复现候选。
 * 不依赖 DOM / localStorage，可直接在 Node 中单测。
 *
 * 可复现约定：同样的剧目片段、小节、密度档、小节谱面与保留格，
 * 经字符串种子散列 + mulberry32 伪随机，永远得到同样的三份候选。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LuoguVariations = api;
})(typeof self !== "undefined" ? self : this, function () {
  const ROWS = 4;
  const COLS = 4;
  const CELL_COUNT = ROWS * COLS;
  const CANDIDATE_COUNT = 3;
  const MAX_ATTEMPTS = 500;

  // 三档密度 = 一小节（16 格）里的口令点数
  const DENSITIES = { 稀疏: 4, 适中: 8, 密集: 12 };

  function hashSeed(text) {
    let h = 1779033703 ^ text.length;
    for (let i = 0; i < text.length; i += 1) {
      h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(items, rng) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function choose(n, k) {
    const kk = Math.min(k, n - k);
    if (kk < 0) return 0;
    let result = 1;
    for (let i = 1; i <= kk; i += 1) result = (result * (n - kk + i)) / i;
    return Math.round(result);
  }

  function flat(matrix) {
    return matrix.reduce((acc, row) => acc.concat(row.map((value) => value || ".")), []);
  }

  function matrixKey(matrix) {
    return flat(matrix).join(",");
  }

  function assertMatrix(name, matrix) {
    if (!Array.isArray(matrix) || matrix.length !== ROWS ||
        matrix.some((row) => !Array.isArray(row) || row.length !== COLS)) {
      throw new Error(`${name} 必须是 ${ROWS}×${COLS} 的口令矩阵`);
    }
  }

  /**
   * @returns 成功 { ok:true, candidates, counts, locked, target, seed }
   *          失败 { ok:false, reason, ...现场信息 }
   *  reason:
   *    locked-too-full     保留点太满（删不得 / 凑不够）
   *    same-as-current     唯一排法与当前相同
   *    not-enough-variants 凑不齐三份彼此不同的候选
   */
  function generate(options) {
  const { tokens, measure, locked, tier, context = "" } = options;
    const target = DENSITIES[tier];
    if (!tokens || tokens.length !== ROWS) throw new Error("tokens 必须是 4 个乐器口令");
    if (!target) throw new Error(`未知密度档：${tier}`);
    assertMatrix("measure", measure);
    if (locked != null) assertMatrix("locked", locked);

    const lockMask = measure.map((row, r) =>
      row.map((_, c) => Boolean(locked && locked[r] && locked[r][c]))
    );

    const freePositions = [];
    const lockedCommands = [];
    let lockedFilled = 0;
    let currentFilledFree = 0;
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const index = r * COLS + c;
        if (lockMask[r][c]) {
          if (measure[r][c]) {
            lockedFilled += 1;
            lockedCommands.push({ row: r, col: c, token: measure[r][c] });
          }
        } else {
          freePositions.push(index);
          if (measure[r][c]) currentFilledFree += 1;
        }
      }
    }

    const lockedCount = CELL_COUNT - freePositions.length;
    const need = target - lockedFilled;
    const fail = (reason, extra) => Object.assign({
      ok: false,
      reason,
      tier,
      target,
      lockedCount,
      lockedFilled,
      freeCount: freePositions.length,
      need: Math.max(0, need),
      locked: lockedCommands
    }, extra || {});

    // 保留口令比该档点数还多 → 不能删保留格
    if (lockedFilled > target) return fail("locked-too-full");
    // 可动格全填上也达不到该档点数
    if (need > freePositions.length) return fail("locked-too-full");

    // 当前谱面是否占用了一个合法配置（可动格上的点数恰好等于 need）
    const currentReachable = currentFilledFree === need;
    const poolSize = choose(freePositions.length, need);
    if (poolSize - (currentReachable ? 1 : 0) < CANDIDATE_COUNT) {
      return fail(poolSize === 1 && currentReachable ? "same-as-current" : "not-enough-variants",
        { poolSize, currentReachable });
    }

    const seedText = [
      context,
      tier,
      flat(measure).join(""),
      lockMask.flat().map((flag) => (flag ? 1 : 0)).join("")
    ].join("|");
    const seed = hashSeed(seedText);
    const rng = mulberry32(seed);

    const seen = new Set([matrixKey(measure)]);
    const build = (fillSet) => measure.map((row, r) => row.map((value, c) => {
      if (lockMask[r][c]) return value; // 保留口令格不能被动
      return fillSet.has(r * COLS + c) ? tokens[r] : "";
    }));

    const candidates = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS && candidates.length < CANDIDATE_COUNT; attempt += 1) {
      const order = shuffle(freePositions.slice(), rng);
      const fillSet = new Set(order.slice(0, need));
      const candidate = build(fillSet);
      const key = matrixKey(candidate);
      if (seen.has(key)) continue; // 排除彼此重复、排除与当前相同
      seen.add(key);
      candidates.push(candidate);
    }

    if (candidates.length < CANDIDATE_COUNT) {
      return fail("not-enough-variants", { poolSize, currentReachable });
    }

    return {
      ok: true,
      tier,
      target,
      seed,
      candidates,
      locked: lockedCommands,
      counts: candidates.map((candidate) => flat(candidate).filter(Boolean).length)
    };
  }

  return { ROWS, COLS, DENSITIES, CANDIDATE_COUNT, hashSeed, mulberry32, generate };
});
