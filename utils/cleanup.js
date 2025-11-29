// Map 清理工具
export const removeIf = (map, predicate, onRemove) => {
  let count = 0;
  for (const [key, value] of map) {
    if (predicate(key, value)) {
      map.delete(key);
      if (onRemove) onRemove(key, value);
      count++;
    }
  }
  return count;
};

import fs from 'fs';
import path from 'path';

/**
 * 清理指定目录中超过指定时间的旧文件
 * @param {string} dirPath - 目录路径
 * @param {number} maxAgeMs - 文件最大保留时间（毫秒）
 */
export const cleanupOldFiles = (dirPath, maxAgeMs) => {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  fs.readdir(dirPath, (err, files) => {
    if (err) {
      console.error(`[CLEANUP] 无法读取目录 ${dirPath}:`, err);
      return;
    }

    const now = Date.now();

    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      
      // 忽略隐藏文件（如 .gitkeep）
      if (file.startsWith('.')) return;

      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`[CLEANUP] 无法获取文件状态 ${filePath}:`, err);
          return;
        }

        if (stats.isFile()) {
          const age = now - stats.mtimeMs;
          if (age > maxAgeMs) {
            fs.unlink(filePath, (err) => {
              if (err) {
                console.error(`[CLEANUP] 删除文件失败 ${filePath}:`, err);
              } else {
                console.log(`[CLEANUP] 已自动删除过期文件: ${filePath} (超过 ${Math.round(age/1000/60)} 分钟)`);
              }
            });
          }
        }
      });
    });
  });
};
