// 候选存档层：只管试听会话的持久化与采纳/放弃，不碰生成规则与页面。
// 试听中的三份候选独立存一份键，不写入正式谱面；确认采纳才替换对应小节。

import { stepsPerMeasure } from "./variations.js";

const sessionKey = "wxyy-4-luogujing-audition";

export function loadAudition() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey) || "null");
  } catch {
    return null;
  }
}

export function saveAudition(session) {
  localStorage.setItem(sessionKey, JSON.stringify(session));
}

export function clearAudition() {
  localStorage.removeItem(sessionKey);
}

// 开启一次试听：冻结当时谱面快照（采纳时只改这一小节）。
export function openAudition({ measure, seed, round, frozen, candidates, patternSnapshot }) {
  const session = {
    id: crypto.randomUUID(),
    measure,
    seed,
    round: round || 1,
    frozen,
    candidates,
    patternSnapshot, // 生成时的整段谱面，用于标注冲突
    createdAt: new Date().toISOString(),
    activeIndex: 0
  };
  saveAudition(session);
  return session;
}

// 采纳某一份候选：只替换该小节，其余谱面原样返回（纯函数）。
export function applyCandidate(pattern, session, index) {
  const candidate = session.candidates[index];
  const start = session.measure * stepsPerMeasure;
  return pattern.map((row, r) => row.map((value, step) => {
    if (step < start || step >= start + stepsPerMeasure) return value;
    return candidate.grid[r][step - start];
  }));
}

// 会话是否仍与当前谱面兼容：目标小节与生成时一致才能采纳，否则报告冲突。
export function sessionConflict(pattern, session) {
  const start = session.measure * stepsPerMeasure;
  for (let r = 0; r < pattern.length; r += 1) {
    for (let s = 0; s < stepsPerMeasure; s += 1) {
      if (pattern[r][start + s] !== session.patternSnapshot[r][start + s]) {
        return true;
      }
    }
  }
  return false;
}
