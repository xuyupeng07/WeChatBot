require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const WechatCrypto = require('./wechatCrypto');
const MessageHandler = require('./messageHandler');

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

// 启动服务器
app.listen(port, () => {
  console.log(`企业微信智能机器人服务器启动成功`);
  console.log(`端口: ${port}`);
  console.log(`回调地址: http://localhost:${port}/wechat/callback`);
  console.log(`健康检查: http://localhost:${port}/health`);
  console.log(`测试接口: http://localhost:${port}/test/webhook`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在关闭服务器...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('收到SIGINT信号，正在关闭服务器...');
  process.exit(0);
});

// 未捕获异常处理
process.on('uncaughtException', (error) => {
  console.error(`未捕获异常: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`未处理的Promise拒绝: ${reason}`);
  console.error(promise);
});