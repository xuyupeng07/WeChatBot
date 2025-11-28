// 常量与默认配置
export const defaultConfig = {
  maxConnections: parseInt(process.env.MAX_CONNECTIONS) || 50,
  cacheTimeout: parseInt(process.env.CACHE_TIMEOUT) || 300000,
  requestTimeout: parseInt(process.env.AI_REQUEST_TIMEOUT) || 60000,
  retryAttempts: parseInt(process.env.RETRY_ATTEMPTS) || 3,
  retryDelay: parseInt(process.env.RETRY_DELAY) || 1000,
  maxBufferSize: parseInt(process.env.MAX_BUFFER_SIZE) || (1024 * 1024)
};

export function getServerConfig() {
  return {
    port: parseInt(process.env.PORT) || 3002,
    maxConcurrency: parseInt(process.env.MAX_CONCURRENCY) || 100,
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT) || 30000,
    useCluster: process.env.CLUSTER_MODE === 'true'
  };
}
