// 系统状态与统计
export const getHealthStatus = (ctx) => {
  const memUsage = process.memoryUsage();
  const now = Date.now();
  let activeConnections = 0;
  for (const [, connection] of ctx.connectionPool) {
    if (now - connection.startTime < ctx.config.requestTimeout) activeConnections++;
  }
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    pid: process.pid,
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
    },
    stats: {
      ...ctx.stats,
      activeConnections,
      cacheSize: ctx.responseCache.size,
      activeStreams: ctx.activeStreams.size,
      streamStoreSize: ctx.streamStore.size
    },
    uptime: Math.round(process.uptime()) + 's'
  };
};

export const getStats = (ctx) => ({
  ...ctx.stats,
  memoryUsage: process.memoryUsage(),
  uptime: process.uptime(),
  connections: {
    pool: ctx.connectionPool.size,
    streams: ctx.activeStreams.size,
    cache: ctx.responseCache.size,
    streamStore: ctx.streamStore.size
  },
  config: ctx.config
});

export const shutdown = (ctx) => {
  ctx.log('info', '开始清理资源');
  ctx.connectionPool.clear();
  ctx.responseCache.clear();
  ctx.activeStreams.clear();
  ctx.streamStore.clear();
  ctx.stats = { totalRequests: 0, failedRequests: 0, cachedResponses: 0, streamRequests: 0 };
  ctx.log('info', '资源清理完成');
};

export const resetStats = (ctx) => {
  ctx.stats = { totalRequests: 0, failedRequests: 0, cachedResponses: 0, streamRequests: 0 };
  ctx.log('info', '统计信息已重置');
};
