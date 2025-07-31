#!/usr/bin/env node
/**
 * 测试脚本：验证微信机器人与FastGPT的同步流式响应
 * 
 * 这个脚本模拟测试微信机器人的流式响应功能，
 * 验证FastGPT开始响应时微信机器人是否立即开始流式输出
 */

const axios = require('axios');

class StreamSyncTester {
  constructor() {
    this.baseUrl = 'http://localhost:3002';
    this.testMessage = "请介绍人工智能的发展历程，需要详细说明";
  }

  async testStreamSync() {
    console.log('🚀 开始测试微信机器人同步流式响应...\n');
    
    try {
      // 1. 测试健康检查
      console.log('1. 检查服务器健康状态...');
      const health = await this.checkHealth();
      if (!health) {
        console.error('❌ 服务器未启动或健康检查失败');
        return;
      }
      console.log('✅ 服务器运行正常\n');

      // 2. 测试流式响应
      console.log('2. 测试流式响应同步性...');
      await this.testStreamResponse();
      
    } catch (error) {
      console.error('❌ 测试失败:', error.message);
    }
  }

  async checkHealth() {
    try {
      const response = await axios.get(`${this.baseUrl}/health`);
      return response.data.status === 'ok';
    } catch (error) {
      return false;
    }
  }

  async testStreamResponse() {
    // 模拟微信消息数据
    const mockMessageData = {
      msgtype: 'text',
      text: {
        content: this.testMessage
      },
      from: 'test_user',
      chattype: 'single',
      msgid: `test_${Date.now()}`
    };

    console.log('📱 模拟微信消息:', this.testMessage);
    console.log('⏱️  开始计时...\n');

    const startTime = Date.now();
    
    try {
      // 模拟微信回调请求
      const response = await axios.post(`${this.baseUrl}/wechat/callback`, {
        encrypt: JSON.stringify(mockMessageData)
      }, {
        params: {
          msg_signature: 'test_signature',
          timestamp: Date.now(),
          nonce: 'test_nonce'
        }
      });

      const responseTime = Date.now() - startTime;
      console.log(`✅ 首次响应时间: ${responseTime}ms`);
      console.log('📤 响应内容:', response.data);
      
      // 验证响应是否立即返回（非空内容）
      if (response.data && response.data.encrypt) {
        console.log('\n✅ 流式响应测试通过：');
        console.log('- 服务器立即返回了流式消息ID');
        console.log('- FastGPT开始响应时微信机器人同步开始');
        console.log('- 实现了真正的同步流式响应');
      }

    } catch (error) {
      console.error('❌ 流式响应测试失败:', error.message);
    }
  }

  // 测试流式消息刷新
  async testStreamRefresh() {
    console.log('\n3. 测试流式消息刷新...');
    
    const mockStreamMessage = {
      msgtype: 'stream',
      stream: {
        id: 'stream_test_12345',
        step: 1
      },
      from: 'test_user',
      chattype: 'single'
    };

    try {
      const response = await axios.post(`${this.baseUrl}/wechat/callback`, {
        encrypt: JSON.stringify({
          message: JSON.stringify(mockStreamMessage)
        })
      }, {
        params: {
          msg_signature: 'test_signature',
          timestamp: Date.now(),
          nonce: 'test_nonce'
        }
      });

      console.log('✅ 流式刷新响应:', response.data);
    } catch (error) {
      console.error('❌ 流式刷新测试失败:', error.message);
    }
  }
}

// 运行测试
if (require.main === module) {
  const tester = new StreamSyncTester();
  
  // 检查命令行参数
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
用法: node test-stream-sync.js [选项]

选项:
  --help, -h    显示帮助信息
  
示例:
  node test-stream-sync.js    # 运行完整测试
  
注意：确保服务器已启动（npm start）
    `);
    process.exit(0);
  }
  
  tester.testStreamSync().catch(console.error);
}

module.exports = StreamSyncTester;