/*
 * 锣鼓经排练台 · 变奏候选存档
 * 只负责把「试听区批次」写入 / 读出 localStorage：
 * 关闭页面再打开，未采纳的候选仍在试听区可继续试听。
 * 与生成规则、页面渲染解耦；存储不可用时退化为内存档。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LuoguCandidateStore = api;
})(typeof self !== "undefined" ? self : this, function () {
  const storageKey = "wxyy-4-luogujing-variation-audition";

  function createStore(backend) {
    const storeBackend = backend || memoryBackend;
    function load() {
      try {
        const raw = storeBackend.getItem(storageKey);
        if (!raw) return null;
        const batch = JSON.parse(raw);
        if (!batch || !Array.isArray(batch.candidates) || batch.candidates.length !== 3) return null;
        return batch;
      } catch (error) {
        return null;
      }
    }

    function save(batch) {
      try {
        storeBackend.setItem(storageKey, JSON.stringify(batch));
        return true;
      } catch (error) {
        return false;
      }
    }

    function clear() {
      try {
        storeBackend.removeItem(storageKey);
      } catch (error) {
        /* 内存档无需清理 */
      }
    }

    return { load, save, clear, storageKey };
  }

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `var-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * 生成结果 → 试听批次（纯数据，可 JSON 化）
   */
  function makeBatch(input, result) {
    return {
      id: uid(),
      pieceName: input.pieceName,
      measure: input.measureIndex, // 0..3
      tier: result.tier,
      target: result.target,
      seed: result.seed,
      locked: result.locked.map((entry) => ({ row: entry.row, col: entry.col, token: entry.token })),
      candidates: result.candidates.map((matrix) => matrix.map((row) => [...row])),
      createdAt: new Date().toISOString()
    };
  }

  const memoryBackend = (function () {
    const map = new Map();
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key)
    };
  })();

  let defaultBackend = memoryBackend;
  try {
    if (typeof localStorage !== "undefined") {
      const probe = "__luogu_probe__";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      defaultBackend = localStorage;
    }
  } catch (error) {
    defaultBackend = memoryBackend;
  }

  return { storageKey, createStore, makeBatch, uid };
});
