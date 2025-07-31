# FastGPT 流式接口集成说明

## 概述

本项目已成功集成 FastGPT 的流式对话接口，支持实时流式响应，让微信机器人能够在 AI 模型生成内容的过程中实时回复用户，而不需要等待完整响应后再发送。

## 接口规范

### FastGPT 对话接口

```bash
curl --location --request POST 'http://localhost:3000/api/v1/chat/completions' \
--header 'Authorization: Bearer fastgpt-xxxxxx' \
--header 'Content-Type: application/json' \
--data-raw '{
    "chatId": "abcd",
    "stream": true,
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "导演是谁"
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "图片链接"
                    }
                },
                {
                    "type": "file_url",
                    "name": "文件名",
                    "url": "文档链接，支持 txt md html word pdf ppt csv excel"
                }
            ]
        }
    ]
}'
```

## 主要改进

### 1. 请求格式适配

- **chatId**: 自动生成唯一的对话ID (`chat_${timestamp}`)
- **stream**: 根据是否提供流式回调自动设置
- **messages**: 按照 FastGPT 规范格式化消息内容
  - 支持 `text` 类型的文本消息
  - 预留了 `image_url` 和 `file_url` 类型的扩展支持

### 2. 流式响应处理

- **实时处理**: 接收到流式数据片段后立即处理
- **内容累积**: 自动累积流式内容片段
- **状态管理**: 跟踪流式响应的完成状态
- **错误处理**: 优雅处理流式响应中的错误

### 3. 微信机器人集成

- **流式回调**: 通过回调函数实时更新消息内容
- **状态同步**: 与现有的流式消息系统无缝集成
- **性能优化**: 避免频繁更新，设置500ms的更新间隔

## 代码变更

### MessageHandler.js 主要修改

1. **getAIResponse 方法**
   - 添加 `streamCallback` 参数支持流式回调
   - 适配 FastGPT 的请求格式
   - 实现流式响应解析

2. **processAIStreamResponse 方法**
   - 集成流式回调机制
   - 实时更新流式状态
   - 优化状态管理

3. **generateStreamContent 方法**
   - 支持流式内容的实时返回
   - 添加更新频率控制
   - 改进完成状态检测

## 配置说明

### 环境变量

确保在 `.env` 文件或环境变量中配置：

```bash
# FastGPT API 配置
AI_API_URL=http://localhost:3000/api/v1/chat/completions
AI_API_KEY=fastgpt-your-api-key
```

### 服务器配置

1. **FastGPT 服务**: 确保 FastGPT 服务运行在指定端口
2. **网络连接**: 确保微信机器人服务器能够访问 FastGPT 服务
3. **API 密钥**: 配置正确的 FastGPT API 密钥

## 测试验证

项目包含完整的测试文件 `test-fastgpt-stream.js`，可以验证：

1. **非流式请求**: 传统的一次性响应
2. **流式请求**: 实时流式响应处理
3. **消息处理**: 完整的微信消息流式处理流程

运行测试：

```bash
node test-fastgpt-stream.js
```

## 使用效果

- **用户体验**: 用户发送消息后，机器人会实时显示 AI 正在生成的内容
- **响应速度**: 不需要等待完整响应，大大提升交互体验
- **资源优化**: 流式处理减少了等待时间和资源占用

## 注意事项

1. **网络稳定性**: 流式响应对网络连接稳定性要求较高
2. **错误处理**: 已实现完善的错误处理和超时机制
3. **兼容性**: 保持与现有非流式接口的完全兼容
4. **性能**: 流式更新频率设置为500ms，平衡了实时性和性能

## 扩展功能

未来可以扩展支持：

- 图片消息的流式处理
- 文件消息的流式处理
- 多轮对话的上下文管理
- 更精细的流式控制策略