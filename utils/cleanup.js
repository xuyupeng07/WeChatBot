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
