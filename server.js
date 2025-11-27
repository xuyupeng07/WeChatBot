require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cluster = require('cluster');
const os = require('os');
const WechatCrypto = require('./wechatCrypto');
const MessageHandler = require('./messageHandler');

const app = express();
const port = process.env.PORT || 3001;
const maxConcurrency = parseInt(process.env.MAX_CONCURRENCY) || 100;
const requestTimeout = parseInt(process.env.REQUEST_TIMEOUT) || 30000;

// 全局错误计数器
let errorCount = 0;
let lastErrorTime = 0;

// 中间件 - 安全限制
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// 请求限流中间件
const requestMap = new Map();
const cleanupInterval = 60000; // 1分钟清理一次

const rateLimitMiddleware = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  // 清理过期记录
  if (now - lastErrorTime > cleanupInterval) {
    requestMap.clear();
    lastErrorTime = now;
  }
  
  const clientRequests = requestMap.get(clientIP) || 0;
  if (clientRequests >= maxConcurrency) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  
  requestMap.set(clientIP, clientRequests + 1);
  
  // 设置请求超时
  req.setTimeout(requestTimeout, () => {
    res.status(408).json({ error: '请求超时' });
  });
  
  next();
};

app.use(rateLimitMiddleware);

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

const messageHandler = new MessageHandler();

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
        chatId = `wechat_group_${groupId}_${userId}`;
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

// 集群模式启动
function startServer() {
  const server = app.listen(port, () => {
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
const useCluster = process.env.CLUSTER_MODE === 'true';

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
  // 启动服务器
  const server = startServer();

  // 优雅关闭
  const gracefulShutdown = (signal) => {
    console.log(`收到${signal}信号，正在优雅关闭服务器...`);
    
    server.close(() => {
      console.log('服务器已关闭');
      
      // 清理资源
      requestMap.clear();
      
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
}