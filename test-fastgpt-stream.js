const MessageHandler = require('./messageHandler');
const axios = require('axios');

// 模拟 FastGPT 流式响应服务器
const http = require('http');
const url = require('url');

// 创建模拟的 FastGPT 服务器
function createMockFastGPTServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/chat/completions') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          const requestData = JSON.parse(body);
          console.log('收到请求:', JSON.stringify(requestData, null, 2));
          
          // 检查是否是流式请求
          if (requestData.stream) {
            // 返回流式响应
            res.writeHead(200, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });
            
            // 模拟流式响应
            const responses = [
              '你好！',
              '我是',
              'FastGPT',
              '智能助手。',
              '很高兴',
              '为您',
              '服务！'
            ];
            
            let index = 0;
            const interval = setInterval(() => {
              if (index < responses.length) {
                const chunk = {
                  choices: [{
                    delta: {
                      content: responses[index]
                    }
                  }]
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                index++;
              } else {
                res.write('data: [DONE]\n\n');
                res.end();
                clearInterval(interval);
              }
            }, 200); // 每200ms发送一个片段
            
          } else {
            // 返回非流式响应
            const response = {
              choices: [{
                message: {
                  content: '你好！我是FastGPT智能助手。很高兴为您服务！'
                }
              }]
            };
            
            res.writeHead(200, {
              'Content-Type': 'application/json'
            });
            res.end(JSON.stringify(response));
          }
        } catch (error) {
          console.error('解析请求失败:', error);
          res.writeHead(400);
          res.end('Bad Request');
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  
  return server;
}

// 测试函数
async function testFastGPTStream() {
  console.log('=== FastGPT 流式接口测试 ===\n');
  
  // 启动模拟服务器
  const mockServer = createMockFastGPTServer();
  mockServer.listen(3001, () => {
    console.log('模拟 FastGPT 服务器启动在端口 3001');
  });
  
  // 创建 MessageHandler 实例
  const handler = new MessageHandler();
  
  // 设置测试配置
  handler.aiApiUrl = 'http://localhost:3001/api/v1/chat/completions';
  handler.aiApiKey = 'fastgpt-test-key';
  
  try {
    console.log('\n1. 测试非流式请求:');
    const nonStreamResponse = await handler.getAIResponse('你好', null, 'test_user');
    console.log('非流式响应:', nonStreamResponse);
    
    console.log('\n2. 测试流式请求:');
    let streamContent = '';
    const streamCallback = (chunk, isComplete) => {
      if (!isComplete && chunk) {
        streamContent += chunk;
        console.log('流式片段:', chunk, '| 累积内容:', streamContent);
      } else if (isComplete) {
        console.log('流式响应完成，最终内容:', streamContent);
      }
    };
    
    const streamResponse = await handler.getAIResponse('你好', streamCallback, 'test_user');
    console.log('流式响应返回值:', streamResponse);
    
    console.log('\n3. 测试流式消息处理:');
    
    // 模拟微信消息数据
    const mockMessageData = {
      msgtype: 'text',
      text: {
        content: '你好，请介绍一下自己'
      },
      from: {
        userid: 'test_user'
      }
    };
    
    // 测试流式消息处理
    const streamId = `stream_${Date.now()}`;
    
    // 初始化流式状态
    if (!handler.streamStore) {
      handler.streamStore = new Map();
    }
    
    handler.streamStore.set(streamId, {
      startTime: Date.now(),
      step: 0,
      content: '',
      aiCalling: true,
      originalMessage: mockMessageData.text.content
    });
    
    // 启动AI处理
    handler.processAIStreamResponse(mockMessageData.text.content, streamId);
    
    // 模拟流式消息轮询
    let pollCount = 0;
    const maxPolls = 20;
    
    const pollInterval = setInterval(async () => {
      pollCount++;
      const result = await handler.generateStreamContent(streamId, pollCount);
      
      if (result.content) {
        console.log(`轮询 ${pollCount}: ${result.content} (完成: ${result.finished})`);
      }
      
      if (result.finished || pollCount >= maxPolls) {
        clearInterval(pollInterval);
        console.log('\n流式消息处理完成');
        
        // 关闭模拟服务器
        mockServer.close(() => {
          console.log('\n测试完成，模拟服务器已关闭');
          process.exit(0);
        });
      }
    }, 1000); // 每秒轮询一次
    
  } catch (error) {
    console.error('测试失败:', error);
    mockServer.close();
    process.exit(1);
  }
}

// 运行测试
testFastGPTStream();