# 企业微信智能机器人

这是一个基于 Node.js 的高性能企业微信智能机器人项目，支持接收消息、AI回复、模板卡片等功能，经过全面优化后具备生产级稳定性。

## 🚀 功能特性

### 核心功能
- ✅ 支持企业微信智能机器人API
- ✅ 消息加解密处理
- ✅ 文本、图片、图文混排消息处理
- ✅ AI智能回复（集成FastGPT）
- ✅ 流式消息回复
- ✅ 模板卡片消息
- ✅ 事件处理（进入会话、按钮点击等）
- ✅ 群机器人Webhook支持

### 优化特性
- 🚀 **高性能**: 连接池、响应缓存、流式优化
- 🔒 **高可用**: Cluster模式、限流保护、优雅关闭
- 📊 **可观测**: 健康检查、统计监控、结构化日志
- 🛡️ **稳定性**: 重试机制、错误恢复、内存管理
- ⚙️ **易运维**: 配置验证、环境模板、故障诊断

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并根据实际情况修改配置：

```bash
# 服务器配置
PORT=3002
CLUSTER_MODE=false
MAX_CONCURRENCY=100
REQUEST_TIMEOUT=30000

# 企业微信配置
WECHAT_TOKEN=your_wechat_token_here
WECHAT_AES_KEY=your_43_character_aes_key_here
WECHAT_CORP_ID=your_corp_id_here

# FastGPT配置
FASTGPT_API_URL=https://cloud.fastgpt.io/api/v1/chat/completions
FASTGPT_API_KEY=your_fastgpt_api_key_here

# 群机器人配置
WECHAT_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=your_webhook_key

# AI服务配置（性能优化参数）
MAX_CONNECTIONS=50              # 最大连接数
CACHE_TIMEOUT=300000             # 缓存超时时间（毫秒）
AI_REQUEST_TIMEOUT=60000         # AI请求超时时间（毫秒）
RETRY_ATTEMPTS=3                 # 重试次数
RETRY_DELAY=1000                 # 重试延迟（毫秒）

# 日志配置
LOG_LEVEL=info
LOG_FILE=logs/app.log
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
2. 设置回调URL为：`http://your-domain:3002/wechat/callback`
3. 配置Token、AESKey等参数
4. 保存配置并验证URL

## 🌐 API接口

### 系统监控

```bash
# 健康检查
GET /health

# 系统统计
GET /stats

# 重置统计信息
POST /stats/reset
```

### 企业微信接口

```bash
# URL验证
GET /wechat/callback

# 消息接收
POST /wechat/callback

# 流式消息刷新
POST /wechat/stream
```

### 测试接口

```bash
# 测试群机器人
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

## 📁 项目结构

```
.
├── server.js              # 主服务器文件（Cluster模式支持）
├── wechatCrypto.js        # 企业微信加解密工具
├── messageHandler.js      # 消息处理器（高性能优化）
├── package.json           # 项目配置
├── .env                   # 环境变量配置
├── .env.example           # 环境变量模板
├── README.md              # 项目说明
├── OPTIMIZATION_GUIDE.md  # 优化指南
├── FastGPT流式接口说明.md # FastGPT集成文档
├── test-*.js              # 测试脚本集合
└── logs/                  # 日志目录（自动创建）
```

## 🚀 部署指南

### 生产环境部署

#### 1. 环境准备
```bash
# 安装Node.js 16+
node --version

# 安装PM2进程管理器
npm install -g pm2

# 创建日志目录
mkdir -p logs
```

#### 2. 配置文件
```bash
# 复制环境模板
cp .env.example .env

# 编辑配置文件
vim .env
```

#### 3. 启动应用
```bash
# 使用PM2启动（推荐）
pm2 start server.js --name wechat-bot

# 查看状态
pm2 status
pm2 logs wechat-bot

# 集群模式启动
pm2 start server.js -i max --name wechat-bot-cluster
```

#### 4. Nginx反向代理配置
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location /wechat/callback {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## 📊 监控与运维

### 健康监控
```bash
# 检查系统健康状态
curl http://localhost:3002/health

# 查看系统统计
curl http://localhost:3002/stats
```

### 性能指标
- **内存使用**: 实时监控内存占用
- **连接数**: 活跃连接池数量
- **缓存命中**: 响应缓存效率
- **错误率**: AI服务调用成功率

### 日志管理
```bash
# 查看实时日志
tail -f logs/app.log

# 按级别过滤日志
grep "ERROR" logs/app.log

# 日志轮转（PM2配置）
pm2 install pm2-logrotate
```

## 🔧 开发说明

### 加解密流程

1. **URL验证**: GET请求验证回调URL有效性
2. **消息接收**: POST请求接收加密消息
3. **消息解密**: 使用AES-256-CBC解密
4. **消息处理**: 根据消息类型进行相应处理
5. **回复加密**: 将回复消息加密后返回

### AI集成优化

- **对话连续性**: 基于用户ID的固定chatId
- **流式处理**: 实时响应，提升用户体验
- **错误重试**: 智能重试机制，提高稳定性
- **缓存策略**: 减少重复API调用，提升响应速度

### 性能优化特性

- **连接池管理**: 复用HTTP连接，减少开销
- **响应缓存**: 缓存常见问题的回答
- **内存管理**: 定时清理过期资源，防止内存泄漏
- **限流保护**: 防止恶意请求，保护系统稳定

## 🚨 故障排除

### 常见问题

#### 1. URL验证失败
```bash
# 检查配置
node -e "console.log('Token:', process.env.WECHAT_TOKEN); console.log('AESKey长度:', process.env.WECHAT_AES_KEY?.length);"

# 测试回调URL
curl -X GET "http://your-domain/wechat/callback?msg_signature=...&timestamp=...&nonce=...&echostr=..."
```

#### 2. 消息解密失败
- 验证AESKey格式（43位Base64字符）
- 检查CorpID是否匹配企业微信后台
- 确认服务器时间同步

#### 3. AI服务异常
```bash
# 测试FastGPT连接
curl -X POST "${FASTGPT_API_URL}" \
  -H "Authorization: Bearer ${FASTGPT_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"chatId":"test","stream":false,"messages":[{"role":"user","content":[{"type":"text","text":"hello"}]}]}'
```

#### 4. 性能问题
```bash
# 监控内存使用
pm2 monit

# 查看系统资源
curl http://localhost:3002/health | jq .
```

### 调试模式
```bash
# 启动调试模式
LOG_LEVEL=debug npm start

# 查看详细日志
grep "DEBUG" logs/app.log
```

## 🔄 版本历史

### v2.0.0 (当前版本)
- ✅ 全面性能优化
- ✅ 生产级稳定性增强
- ✅ 完整监控体系
- ✅ 集群模式支持
- ✅ 内存泄漏修复

### v1.0.0
- ✅ 基础功能实现
- ✅ 企业微信集成
- ✅ FastGPT AI回复
- ✅ 流式消息支持

## 🤝 贡献指南

欢迎提交Issue和Pull Request来改进项目！

### 开发规范
- 遵循Node.js最佳实践
- 添加适当的测试用例
- 更新相关文档
- 确保代码通过lint检查

### 提交规范
```
feat: 新功能
fix: 修复bug
docs: 文档更新
style: 代码格式
refactor: 重构
perf: 性能优化
test: 测试用例
```

## 📞 技术支持

如有问题，请通过以下方式获取支持：
- 📧 提交GitHub Issue
- 📖 查看[优化指南](OPTIMIZATION_GUIDE.md)
- 🔍 查看[FastGPT集成文档](FastGPT流式接口说明.md)

## 📄 许可证

MIT License - 详见[LICENSE](LICENSE)文件

## 🔗 参考文档

- [企业微信智能机器人开发文档](https://developer.work.weixin.qq.com/document/path/101039)
- [接收消息](https://developer.work.weixin.qq.com/document/path/100719)
- [被动回复消息](https://developer.work.weixin.qq.com/document/path/101031)
- [加解密方案](https://developer.work.weixin.qq.com/document/path/101033)
- [FastGPT API文档](https://doc.fastgpt.in/docs/development/openapi/)