#!/usr/bin/env node
/**
 * 直接测试流式响应功能
 * 
 * 绕过微信的加密解密，直接测试MessageHandler的流式处理
 */

const MessageHandler = require('./messageHandler');

class DirectStreamTester {
  constructor() {
    this.messageHandler = new MessageHandler();
  }

  async testDirectStream() {
    console.log('🚀 开始直接测试流式响应功能...\n');
    
    try {
      // 模拟微信消息数据
      const mockMessageData = {
        msgtype: 'text',
        text: {
          content: "请介绍人工智能的发展历程"
        },
        from: 'test_user',
        chattype: 'single',
        msgid: `test_${Date.now()}`
      };

      console.log('📱 测试消息:', mockMessageData.text.content);
      console.log('⏱️  开始处理...\n');

      const startTime = Date.now();
      
      // 直接调用handleTextMessage测试流式响应
      const response = await this.messageHandler.handleTextMessage(mockMessageData);
      
      const responseTime = Date.now() - startTime;
      console.log(`✅ 首次响应时间: ${responseTime}ms`);
      console.log('📤 响应结构:', JSON.stringify(response, null, 2));
      
      if (response && response.msgtype === 'stream') {
        console.log('\n✅ 流式响应测试通过：');
        console.log('- 成功生成了流式消息ID:', response.stream.id);
        console.log('- 系统已初始化同步流式处理');
        console.log('- FastGPT将开始同步响应');
        
        // 测试流式刷新
        await this.testStreamRefresh(response.stream.id);
      }

    } catch (error) {
      console.error('❌ 测试失败:', error.message);
      console.error('堆栈:', error.stack);
    }
  }

  async testStreamRefresh(streamId) {
    console.log('\n2. 测试流式消息刷新...');
    
    const mockStreamMessage = {
      msgtype: 'stream',
      stream: {
        id: streamId,
        step: 1
      },
      from: 'test_user',
      chattype: 'single'
    };

    try {
      const response = await this.messageHandler.handleStreamMessage(mockStreamMessage);
      console.log('✅ 流式刷新响应:', JSON.stringify(response, null, 2));
      
      if (response && response.stream) {
        console.log('- 流式内容长度:', response.stream.content.length);
        console.log('- 是否完成:', response.stream.finish);
      }
    } catch (error) {
      console.error('❌ 流式刷新测试失败:', error.message);
    }
  }

  // 检查环境配置
  checkEnvironment() {
    console.log('\n🔍 环境配置检查:');
    console.log('- AI_API_URL:', process.env.AI_API_URL ? '已配置' : '未配置');
    console.log('- AI_API_KEY:', process.env.AI_API_KEY ? '已配置' : '未配置');
    console.log('- WECHAT_TOKEN:', process.env.WECHAT_TOKEN ? '已配置' : '未配置');
    console.log('- WECHAT_AES_KEY:', process.env.WECHAT_AES_KEY ? '已配置' : '未配置');
    console.log('- WECHAT_CORP_ID:', process.env.WECHAT_CORP_ID ? '已配置' : '未配置');
  }
}

// 运行测试
if (require.main === module) {
  const tester = new DirectStreamTester();
  
  tester.checkEnvironment();
  tester.testDirectStream().catch(console.error);
}

module.exports = DirectStreamTester;