import dotenv from 'dotenv';
dotenv.config();

// 修正无效的 SERVER_HOST，确保使用公网域名
if (process.env.SERVER_HOST === '127.0.0.1' || process.env.SERVER_HOST === 'localhost') {
  process.env.SERVER_HOST = 'https://npzfibxxgmmk.sealoshzh.site';
}
import express from 'express';
import bodyParser from 'body-parser';
import cluster from 'cluster';
import os from 'os';
import WechatCrypto from './wechatCrypto.js';
import MessageHandler from './messageHandler.js';
import { getServerConfig } from './constants/config.js';
import multer from 'multer';

let messageHandler;
async function initMessageHandler() {
  messageHandler = new MessageHandler();
}

const app = express();
const serverConfig = getServerConfig();
const port = serverConfig.port;
const maxConcurrency = serverConfig.maxConcurrency;
const requestTimeout = serverConfig.requestTimeout;

// 全局错误计数器
let errorCount = 0;

// 中间件 - 安全限制
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// 请求限流中间件
const activeRequestsByIp = new Map();
const cleanupInterval = 60000;

const rateLimitMiddleware = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown_ip';
  const record = activeRequestsByIp.get(clientIP) || { count: 0, lastSeen: Date.now() };
  if (record.count >= maxConcurrency) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  record.count += 1;
  record.lastSeen = Date.now();
  activeRequestsByIp.set(clientIP, record);

  req.setTimeout(requestTimeout, () => {
    try { res.status(408).json({ error: '请求超时' }); } catch (_) {}
  });

  const done = () => {
    const cur = activeRequestsByIp.get(clientIP);
    if (!cur) return;
    cur.count = Math.max(0, (cur.count || 1) - 1);
    cur.lastSeen = Date.now();
    if (cur.count === 0) activeRequestsByIp.delete(clientIP);
    else activeRequestsByIp.set(clientIP, cur);
  };
  res.on('finish', done);
  res.on('close', done);
  next();
};

app.use(rateLimitMiddleware);

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of activeRequestsByIp) {
    if ((now - rec.lastSeen) > cleanupInterval || (rec.count || 0) === 0) {
      activeRequestsByIp.delete(ip);
    }
  }
}, cleanupInterval);

// 配置验证
function validateConfig() {
  const requiredEnvVars = ['WECHAT_TOKEN', 'WECHAT_AES_KEY', 'WECHAT_CORP_ID'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error(`缺少必要的环境变量: ${missingVars.join(', ')}`);
    process.exit(1);
  }
  
  // 验证AES密钥长度
  if (process.env.WECHAT_AES_KEY.length !== 43) {
    console.error('WECHAT_AES_KEY必须是43位字符');
    process.exit(1);
  }
}

validateConfig();

// 初始化加解密和消息处理器
const wechatCrypto = new WechatCrypto(
  process.env.WECHAT_TOKEN,
  process.env.WECHAT_AES_KEY,
  process.env.WECHAT_CORP_ID
);

// 静态文件服务 - 用于提供下载的图片
import path from 'path';
app.use('/public', express.static(path.join(process.cwd(), 'public')));

// 简单直传接口：如果 COS 链接不可直接下载，可由前端直接上传图片到本服务器，再生成公网 URL 给 FastGPT
const upload = multer({ dest: path.join(process.cwd(), 'public', 'images') });
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未找到上传文件' });
  }
  const serverHost = process.env.SERVER_HOST || `http://localhost:${port}`;
  const url = `${serverHost}/public/images/${req.file.filename}`;
  res.json({ url });
});

// 延迟初始化，确保在启动服务器前加载ESM模块
// messageHandler 将在启动前完成赋值

// 健康检查接口
app.get('/health', (req, res) => {
  const healthStatus = messageHandler.getHealthStatus();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    pid: process.pid,
    ...healthStatus
  });
});

// 系统统计接口
app.get('/stats', (req, res) => {
  const stats = messageHandler.getStats();
  res.json({
    timestamp: new Date().toISOString(),
    pid: process.pid,
    ...stats
  });
});

// 重置统计接口
app.post('/stats/reset', (req, res) => {
  messageHandler.resetStats();
  res.json({ success: true, message: '统计信息已重置' });
});

// 企业微信回调接口 - GET请求用于验证URL
app.get('/wechat/callback', (req, res) => {
  try {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    
    if (!msg_signature || !timestamp || !nonce || !echostr) {
      return res.status(400).send('缺少必要参数');
    }
    
    // 验证签名并返回echostr
    const decryptedEchostr = wechatCrypto.verifyUrl(msg_signature, timestamp, nonce, echostr);
    
    if (decryptedEchostr) {
      res.send(decryptedEchostr);
    } else {
      res.status(403).send('验证失败');
    }
  } catch (error) {
    res.status(500).send('验证异常');
  }
});

// 企业微信回调接口 - POST请求用于接收消息
app.post('/wechat/callback', async (req, res) => {
  try {
    const { msg_signature, timestamp, nonce } = req.query;
    const { encrypt } = req.body;
    
    if (!encrypt) {
      return res.status(400).json({ error: '消息体为空' });
    }
    
    // 解密消息
    const decryptedData = wechatCrypto.decrypt(encrypt);
    const messageData = JSON.parse(decryptedData.message);
    
    // 只打印用户的问题和当前对话的chatid
    if (messageData.msgtype === 'text' && messageData.text && messageData.text.content) {
      // 获取用户ID
      let userId = '';
      if (typeof messageData.from === 'string') {
        userId = messageData.from;
      } else if (typeof messageData.from === 'object' && messageData.from !== null) {
        userId = messageData.from.userid || '';
      }
      
      // 根据聊天类型构建chatId
      let chatId;
      const chatType = messageData.chattype || 'single';
      if (chatType === 'group') {
        const groupId = messageData.chatid || 'unknown_group';
        chatId = `wechat_group_${groupId}`;
      } else {
        chatId = `wechat_single_${userId}`;
      }
      
      console.log(`[对话ID]`);
      console.log(chatId);
      console.log(`[用户问题]`);
      console.log(messageData.text.content);
    }
    
    // 处理消息
    let response;
    if (messageData.msgtype === 'stream') {
      // 处理流式消息刷新
      response = await messageHandler.handleStreamMessage(messageData);
    } else {
      // 处理普通消息
      response = await messageHandler.handleMessage(messageData);
    }
    
    if (response) {
      // 加密回复消息
      const encryptedResponse = wechatCrypto.encrypt(
        JSON.stringify(response),
        timestamp,
        nonce
      );
      
      res.json(encryptedResponse);
    } else {
      // 空回复
      res.json({});
    }
  } catch (error) {
    res.status(500).json({ error: '处理失败' });
  }
});



// 测试接口 - 发送群机器人消息
app.post('/test/webhook', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }
    
    const success = await messageHandler.sendWebhookMessage(message);
    
    if (success) {
      res.json({ success: true, message: '消息发送成功' });
    } else {
      res.status(500).json({ success: false, message: '消息发送失败' });
    }
  } catch (error) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 错误处理中间件
app.use((error, req, res, next) => {
  res.status(500).json({ error: '服务器内部错误' });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

import { cleanupOldFiles } from './utils/cleanup.js';
import { fileURLToPath } from 'url';

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 定义要清理的目录和时间
const FILES_DIR = path.join(__dirname, 'public/files');
const IMAGES_DIR = path.join(__dirname, 'public/images');
const MAX_FILE_AGE = 5 * 60 * 1000; // 5分钟
const CLEANUP_CHECK_INTERVAL = 60 * 1000; // 每分钟检查一次

// 启动定时清理任务
setInterval(() => {
  cleanupOldFiles(FILES_DIR, MAX_FILE_AGE);
  cleanupOldFiles(IMAGES_DIR, MAX_FILE_AGE);
}, CLEANUP_CHECK_INTERVAL);

// 立即执行一次清理
cleanupOldFiles(FILES_DIR, MAX_FILE_AGE);
cleanupOldFiles(IMAGES_DIR, MAX_FILE_AGE);

// 集群模式启动
function startServer() {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`企业微信智能机器人服务器启动成功 (进程 ${process.pid})`);
    console.log(`端口: ${port}`);
    console.log(`回调地址: http://localhost:${port}/wechat/callback`);
    console.log(`健康检查: http://localhost:${port}/health`);
    console.log(`测试接口: http://localhost:${port}/test/webhook`);
  });

  // 设置服务器超时
  server.timeout = requestTimeout;
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 60000;

  return server;
}

// 根据配置决定是否使用集群
const useCluster = serverConfig.useCluster;

if (useCluster && cluster.isMaster) {
  const numCPUs = os.cpus().length;
  console.log(`主进程 ${process.pid} 正在启动 ${numCPUs} 个工作进程...`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.error(`工作进程 ${worker.process.pid} 退出，代码: ${code}, 信号: ${signal}`);
    
    // 重启工作进程
    if (errorCount < 10) {
      console.log('正在重启工作进程...');
      cluster.fork();
    } else {
      console.error('错误次数过多，停止重启工作进程');
    }
  });

  // 优雅关闭主进程
  process.on('SIGTERM', () => {
    console.log('主进程收到SIGTERM信号，正在关闭...');
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  });

} else {
  // 启动服务器（在初始化消息处理器后）
  initMessageHandler()
    .then(() => {
      const server = startServer();

  // 优雅关闭
  const gracefulShutdown = (signal) => {
    console.log(`收到${signal}信号，正在优雅关闭服务器...`);
    
    server.close(() => {
      console.log('服务器已关闭');
      
      // 清理资源
      activeRequestsByIp.clear();
      
      // 如果消息处理器有清理方法
      if (messageHandler.shutdown) {
        messageHandler.shutdown();
      }
      
      process.exit(0);
    });

    // 强制关闭超时
    setTimeout(() => {
      console.error('强制关闭服务器');
      process.exit(1);
    }, 10000);
  };

      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // 未捕获异常处理
      process.on('uncaughtException', (error) => {
    console.error(`未捕获异常: ${error.message}`);
    console.error(error.stack);
    errorCount++;
    
    if (errorCount > 5) {
      console.error('错误次数过多，正在关闭进程');
      process.exit(1);
    }
  });

      process.on('unhandledRejection', (reason, promise) => {
    console.error(`未处理的Promise拒绝: ${reason}`);
    console.error(promise);
    errorCount++;
    
    if (errorCount > 5) {
      console.error('错误次数过多，正在关闭进程');
      process.exit(1);
    }
  });
    })
    .catch((error) => {
      console.error('消息处理器初始化失败', error);
      process.exit(1);
    });
}
