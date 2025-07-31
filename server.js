require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const winston = require('winston');
const WechatCrypto = require('./wechatCrypto');
const MessageHandler = require('./messageHandler');

// 配置日志
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'server.log' })
  ]
});

const app = express();
const port = process.env.PORT || 3001;

// 中间件
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 初始化加解密和消息处理器
const wechatCrypto = new WechatCrypto(
  process.env.WECHAT_TOKEN,
  process.env.WECHAT_AES_KEY,
  process.env.WECHAT_CORP_ID
);

const messageHandler = new MessageHandler();

// 健康检查接口
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 企业微信回调接口 - GET请求用于验证URL
app.get('/wechat/callback', (req, res) => {
  try {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    
    logger.info('收到URL验证请求');
    logger.debug(`参数: signature=${msg_signature}, timestamp=${timestamp}, nonce=${nonce}`);
    
    if (!msg_signature || !timestamp || !nonce || !echostr) {
      logger.error('缺少必要参数');
      return res.status(400).send('缺少必要参数');
    }
    
    // 验证签名并返回echostr
    const decryptedEchostr = wechatCrypto.verifyUrl(msg_signature, timestamp, nonce, echostr);
    
    if (decryptedEchostr) {
      logger.info('URL验证成功');
      res.send(decryptedEchostr);
    } else {
      logger.error('URL验证失败');
      res.status(403).send('验证失败');
    }
  } catch (error) {
    logger.error(`URL验证异常: ${error.message}`);
    res.status(500).send('验证异常');
  }
});

// 企业微信回调接口 - POST请求用于接收消息
app.post('/wechat/callback', async (req, res) => {
  try {
    const { msg_signature, timestamp, nonce } = req.query;
    const { encrypt } = req.body;
    const requestId = `${timestamp}-${nonce}-${Date.now()}`;
    
    logger.info(`收到消息回调 [请求ID: ${requestId}]`);
    logger.debug(`加密消息: ${encrypt}`);
    
    if (!encrypt) {
      logger.error('消息体为空');
      return res.status(400).json({ error: '消息体为空' });
    }
    
    // 解密消息
    const decryptedData = wechatCrypto.decrypt(encrypt);
    const messageData = JSON.parse(decryptedData.message);
    
    logger.info(`解密成功，消息类型: ${messageData.msgtype}`);
    
    // 处理消息
    logger.info(`开始处理消息 [请求ID: ${requestId}] [消息ID: ${messageData.msgid || 'N/A'}] [消息类型: ${messageData.msgtype}]`);
    
    let response;
    if (messageData.msgtype === 'stream') {
      // 处理流式消息刷新
      logger.info(`处理流式消息刷新 [请求ID: ${requestId}]`);
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
      
      logger.info(`发送回复消息 [请求ID: ${requestId}]`);
      res.json(encryptedResponse);
    } else {
      // 空回复
      logger.info(`发送空回复 [请求ID: ${requestId}]`);
      res.json({});
    }
  } catch (error) {
    logger.error(`处理回调失败: ${error.message}`);
    logger.error(error.stack);
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
    logger.error(`测试接口错误: ${error.message}`);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 错误处理中间件
app.use((error, req, res, next) => {
  logger.error(`未处理的错误: ${error.message}`);
  logger.error(error.stack);
  res.status(500).json({ error: '服务器内部错误' });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 启动服务器
app.listen(port, () => {
  logger.info(`企业微信智能机器人服务器启动成功`);
  logger.info(`端口: ${port}`);
  logger.info(`回调地址: http://localhost:${port}/wechat/callback`);
  logger.info(`健康检查: http://localhost:${port}/health`);
  logger.info(`测试接口: http://localhost:${port}/test/webhook`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  logger.info('收到SIGTERM信号，正在关闭服务器...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('收到SIGINT信号，正在关闭服务器...');
  process.exit(0);
});

// 未捕获异常处理
process.on('uncaughtException', (error) => {
  logger.error(`未捕获异常: ${error.message}`);
  logger.error(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`未处理的Promise拒绝: ${reason}`);
  logger.error(promise);
});