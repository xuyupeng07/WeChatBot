# 企业微信智能机器人

这是一个基于 Node.js 的企业微信智能机器人项目，支持接收消息、AI回复、模板卡片等功能。

## 功能特性

- ✅ 支持企业微信智能机器人API
- ✅ 消息加解密处理
- ✅ 文本、图片、图文混排消息处理
- ✅ AI智能回复（集成FastGPT）
- ✅ 流式消息回复
- ✅ 模板卡片消息
- ✅ 事件处理（进入会话、按钮点击等）
- ✅ 群机器人Webhook支持
- ✅ 完整的日志记录

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env` 文件并根据实际情况修改配置：

```bash
# 企业微信机器人配置
WECHAT_TOKEN=your_token
WECHAT_AES_KEY=your_aes_key
WECHAT_CORP_ID=your_corp_id

# 企业微信群机器人Webhook URL
WECHAT_WEBHOOK_URL=your_webhook_url

# 服务器配置
PORT=3001

# AI模型配置
AI_API_URL=https://cloud.fastgpt.io/api/v1/chat/completions
AI_API_KEY=your_fastgpt_api_key

# 日志级别
LOG_LEVEL=info
```

### 3. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

### 4. 配置企业微信

1. 在企业微信管理后台创建智能机器人
2. 设置回调URL为：`http://your-domain:3001/wechat/callback`
3. 配置Token、AESKey等参数
4. 保存配置并验证URL

## API接口

### 健康检查

```
GET /health
```

### 企业微信回调

```
GET /wechat/callback   # URL验证
POST /wechat/callback  # 消息接收
```

### 流式消息刷新

```
POST /wechat/stream
```

### 测试群机器人

```
POST /test/webhook
Content-Type: application/json

{
  "message": "测试消息内容"
}
```

## 消息类型支持

### 接收消息类型

- **文本消息**: 支持AI智能回复
- **图片消息**: 基础处理（可扩展图片识别）
- **图文混排**: 提取文本内容进行AI回复

### 回复消息类型

- **文本消息**: 简单文本回复
- **流式消息**: 支持实时流式回复
- **模板卡片**: 丰富的卡片样式

### 事件处理

- **进入会话事件**: 用户首次进入时的欢迎消息
- **模板卡片事件**: 按钮点击等交互事件

## 项目结构

```
.
├── server.js          # 主服务器文件
├── wechatCrypto.js     # 企业微信加解密工具
├── messageHandler.js   # 消息处理器
├── package.json        # 项目配置
├── .env               # 环境变量配置
└── README.md          # 项目说明
```

## 开发说明

### 加解密流程

1. **URL验证**: GET请求验证回调URL有效性
2. **消息接收**: POST请求接收加密消息
3. **消息解密**: 使用AES-256-CBC解密
4. **消息处理**: 根据消息类型进行相应处理
5. **回复加密**: 将回复消息加密后返回

### AI集成

项目集成了FastGPT API，支持智能对话功能。可以根据需要替换为其他AI服务。

### 日志记录

使用Winston进行日志记录，支持控制台和文件输出，可通过LOG_LEVEL环境变量控制日志级别。

## 故障排除

### 常见问题

1. **URL验证失败**
   - 检查Token、AESKey配置是否正确
   - 确认服务器可以被企业微信访问
   - 查看日志中的详细错误信息

2. **消息解密失败**
   - 验证AESKey格式是否正确（43位Base64字符）
   - 检查CorpID是否匹配

3. **AI回复异常**
   - 确认AI_API_URL和AI_API_KEY配置正确
   - 检查网络连接和API服务状态

### 调试模式

设置环境变量 `LOG_LEVEL=debug` 可以查看详细的调试信息。

## 许可证

MIT License

## 参考文档

- [企业微信智能机器人开发文档](https://developer.work.weixin.qq.com/document/path/101039)
- [接收消息](https://developer.work.weixin.qq.com/document/path/100719)
- [被动回复消息](https://developer.work.weixin.qq.com/document/path/101031)
- [加解密方案](https://developer.work.weixin.qq.com/document/path/101033)