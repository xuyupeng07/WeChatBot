// 日志工具：统一结构化输出与级别控制
import fs from 'fs';

const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = levels[envLevel] !== undefined ? levels[envLevel] : levels.info;
const logFile = process.env.LOG_FILE;

export const log = (level, message, data = {}) => {
  const lvl = level && levels[level] !== undefined ? level : 'info';
  if (levels[lvl] < threshold) return;
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level: lvl, message, pid: process.pid, ...data };
  const line = JSON.stringify(entry);
  console.log(line);
  if (logFile) {
    try { fs.appendFile(logFile, line + '\n', () => {}); } catch (_) {}
  }
};
