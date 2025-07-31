const axios = require('axios');

class MessageHandler {
  constructor() {
    this.aiApiUrl = process.env.AI_API_URL;
    this.aiApiKey = process.env.AI_API_KEY;
    this.webhookUrl = process.env.WECHAT_WEBHOOK_URL;
    // 流式消息存储
    this.streamStore = new Map();
    
    // 启动定期清理过期流式消息的任务
    this.startCleanupTask();
  }
  
  // 启动清理任务
  startCleanupTask() {
    // 每5分钟清理一次过期的流式消息状态
    setInterval(() => {
      this.cleanupExpiredStreams();
    }, 5 * 60 * 1000); // 5分钟
  }
  
  // 清理过期的流式消息状态
  cleanupExpiredStreams() {
    const now = Date.now();
    const expiredStreams = [];
    
    for (const [streamId, streamState] of this.streamStore.entries()) {
      const elapsedTime = (now - streamState.startTime) / 1000;
      // 清理超过20分钟的流式消息状态
      if (elapsedTime > 1200) {
        expiredStreams.push(streamId);
      }
    }
    
    for (const streamId of expiredStreams) {
      this.streamStore.delete(streamId);
    }
  }

  // 处理接收到的消息
  async handleMessage(messageData) {
    try {
      const { msgtype, msgid, aibotid, chatid, chattype, from } = messageData;
      
      // 根据消息类型处理
      switch (msgtype) {
        case 'text':
          return await this.handleTextMessage(messageData);
        case 'image':
          return await this.handleImageMessage(messageData);
        case 'mixed':
          return await this.handleMixedMessage(messageData);
        case 'event':
          return await this.handleEvent(messageData);
        case 'stream':
          return await this.handleStreamMessage(messageData);
        default:
          return this.createTextResponse('抱歉，我暂时无法处理这种类型的消息。');
      }
    } catch (error) {
      return this.createTextResponse('抱歉，处理消息时出现错误，请稍后再试。');
    }
  }

  // 处理文本消息
  async handleTextMessage(messageData) {
    const { text, from, chattype, msgid } = messageData;
    const content = text.content;
    
    // 生成流式消息ID
    const streamId = `stream_${msgid}_${Date.now()}`;
    
    // 初始化流式消息状态
    this.streamStore.set(streamId, {
      step: 0,
      content: '',
      startTime: Date.now(),
      originalContent: content,
      messageData: messageData,
      aiCalling: true // 标记正在调用AI
    });
    
    // 立即开始调用AI API
    this.processAIStreamResponse(content, streamId);
    
    // 返回空的初始流式消息，等待AI回复
    return this.createStreamResponse('', false, [], streamId);
  }
  
  // 异步处理AI流式响应
  async processAIStreamResponse(content, streamId) {
    try {
      const streamState = this.streamStore.get(streamId);
      if (!streamState) {
        return;
      }
      
      // 调用AI获取回复
      const aiResponse = await this.getAIResponse(content);
      
      if (aiResponse) {
        const responseText = aiResponse.text || aiResponse;
        // 保存AI回复到状态中
        streamState.aiResponse = responseText;
        streamState.aiResponseTime = Date.now();
        streamState.aiCalling = false; // 清除调用标记
      } else {
        streamState.aiCalling = false; // 清除调用标记
        streamState.aiError = '抱歉，我现在无法回答您的问题，请稍后再试。';
      }
    } catch (error) {
      const streamState = this.streamStore.get(streamId);
      if (streamState) {
        streamState.aiCalling = false; // 清除调用标记
        
        // 根据错误类型给出不同的提示
        if (error.code === 'ECONNABORTED') {
          streamState.aiError = '抱歉，AI响应超时，请尝试简化您的问题后重新发送。';
        } else if (error.response && error.response.status >= 500) {
          streamState.aiError = '抱歉，AI服务暂时不可用，请稍后再试。';
        } else {
          streamState.aiError = '抱歉，处理您的问题时出现错误，请稍后再试。';
        }
      }
    }
  }
  
  // 异步处理AI请求（保留原方法以兼容其他调用）
  async processAIRequestAsync(content, streamId, messageData) {
    return this.processAIStreamResponse(content, streamId);
  }
  
  // 处理流式消息
  async handleStreamMessage(messageData) {
    const { stream, from, chattype } = messageData;
    
    const streamId = stream.id;
    
    // 获取或创建流式消息状态
    if (!this.streamStore.has(streamId)) {
      // 如果streamStore中没有该streamId，尝试重新创建状态
      // 尝试从streamId中提取原始消息信息
      const parts = streamId.split('_');
      if (parts.length >= 3) {
        // 重新初始化流式消息状态，从步骤1开始
        this.streamStore.set(streamId, {
          step: 0,
          content: '',
          startTime: Date.now(),
          originalContent: '继续之前的对话', // 默认内容
          messageData: messageData,
          recovered: true // 标记为恢复的会话
        });
      } else {
        // 无法恢复，返回错误信息
        return this.createStreamResponse('会话状态已丢失，请重新发送消息', true, [], streamId);
      }
    }
    
    const streamState = this.streamStore.get(streamId);
    streamState.step++;
    
    // 生成流式内容
    const { content, finished } = await this.generateStreamContent(streamId, streamState.step);
    streamState.content = content;
    
    // 如果完成，清理状态
    if (finished) {
      this.streamStore.delete(streamId);
    }
    
    // 返回流式响应，使用原始的streamId
    return this.createStreamResponse(content, finished, [], streamId);
  }

  // 处理图片消息
  async handleImageMessage(messageData) {
    const { image } = messageData;
    
    // 这里可以添加图片识别逻辑
    return this.createTextResponse('我看到了您发送的图片，但目前还无法识别图片内容。');
  }

  // 生成流式内容
  async generateStreamContent(streamId, step) {
    const streamState = this.streamStore.get(streamId);
    if (!streamState) {
      return { content: '会话已结束', finished: true };
    }
    
    // 检查是否超过15分钟（900秒），给AI充足的响应时间
    const currentTime = Date.now();
    const elapsedTime = (currentTime - streamState.startTime) / 1000;
    
    if (elapsedTime > 900) {
      // 超过15分钟，结束流式消息
      return { content: '抱歉，处理时间过长，请重新发送消息', finished: true };
    }
    
    // 如果有AI回复，立即返回回复内容并结束流式消息
    if (streamState.aiResponse) {
      return { content: streamState.aiResponse, finished: true };
    }
    
    // 如果AI调用失败，返回错误信息
    if (streamState.aiError) {
      return { content: streamState.aiError, finished: true };
    }
    
    // 如果正在调用AI API，返回空内容继续等待
    if (streamState.aiCalling) {
      return { content: '', finished: false };
    }
    
    // 默认情况，继续等待
    return { content: '', finished: false };
  }

  // 处理图文混排消息
  async handleMixedMessage(messageData) {
    const { mixed } = messageData;
    
    // 提取文本内容
    let textContent = '';
    mixed.msg_item.forEach(item => {
      if (item.msgtype === 'text') {
        textContent += item.text.content + ' ';
      }
    });
    
    if (textContent.trim()) {
      const aiResponse = await this.getAIResponse(textContent.trim());
      if (aiResponse) {
        return this.createStreamResponse(aiResponse, true);
      }
    }
    
    return this.createTextResponse('我收到了您的图文消息，正在处理中...');
  }

  // 处理事件
  async handleEvent(messageData) {
    const { event } = messageData;
    const eventType = event.eventtype;
    
    switch (eventType) {
      case 'enter_chat':
        return this.handleEnterChatEvent(messageData);
      case 'template_card_event':
        return this.handleTemplateCardEvent(messageData);
      default:
        return null;
    }
  }

  // 处理进入会话事件
  async handleEnterChatEvent(messageData) {
    return this.createTemplateCardResponse({
      card_type: 'text_notice',
      main_title: {
        title: '欢迎使用智能助手',
        desc: '我是您的AI助手，可以帮助您解答问题和处理任务'
      },
      sub_title_text: '请直接向我提问，我会尽力为您提供帮助！',
      card_action: {
        type: 3,
        title: '开始对话',
        question: '你好，请问有什么可以帮助您的吗？'
      },
      task_id: `welcome_${Date.now()}`
    });
  }

  // 处理模板卡片事件
  async handleTemplateCardEvent(messageData) {
    const { event } = messageData;
    const cardEvent = event.template_card_event;
    
    // 根据不同的按钮点击处理
    switch (cardEvent.event_key) {
      case 'submit_key':
        return this.createTextResponse('感谢您的提交！');
      default:
        return this.createTextResponse('收到您的操作，正在处理...');
    }
  }

  // 调用AI API获取回复
  async getAIResponse(content) {
    const startTime = Date.now();
    try {
      if (!this.aiApiUrl || !this.aiApiKey) {
        return null;
      }

      // 检测是否为图片生成请求
      const isImageRequest = this.isImageGenerationRequest(content);
      
      if (isImageRequest) {
        // 调用图片生成API或返回模拟响应
        return await this.handleImageGeneration(content, startTime);
      }

      const response = await axios.post(this.aiApiUrl, {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: content
          }
        ],
        max_tokens: 1000,
        temperature: 0.7,
        stream: false
      }, {
        headers: {
          'Authorization': `Bearer ${this.aiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 600000, // 设置10分钟超时，给AI充足的响应时间
        // 禁用axios的自动重试，只尝试一次
        retry: 0,
        maxRedirects: 0
      });
      
      if (response.data && response.data.choices && response.data.choices[0]) {
        return response.data.choices[0].message.content;
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  // 检测是否为图片生成请求
  isImageGenerationRequest(content) {
    const imageKeywords = ['画', '绘制', '生成图片', '创建图像', '画一个', '画一只', '画个', 'draw', 'generate image', 'create picture'];
    const lowerContent = content.toLowerCase();
    return imageKeywords.some(keyword => lowerContent.includes(keyword.toLowerCase()));
  }

  // 处理图片生成请求
  async handleImageGeneration(content, startTime) {
    try {
      // 这里可以调用实际的图片生成API，比如DALL-E、Midjourney等
      // 目前返回一个模拟的响应，说明图片生成功能
      
      // 返回包含说明文本的响应，不包含实际图片
      return {
        text: `我理解您想要生成图片："${content}"。\n\n由于当前配置限制，我无法直接生成图片，但我可以：\n1. 为您详细描述这个图片的内容\n2. 提供绘画的步骤和技巧\n3. 推荐相关的图片生成工具\n\n请告诉我您希望我如何帮助您！`,
        images: [] // 暂时不返回实际图片
      };
      
    } catch (error) {
      return {
        text: '抱歉，图片生成功能暂时不可用，请稍后再试。',
        images: []
      };
    }
  }

  // 创建文本回复
  createTextResponse(content) {
    return {
      msgtype: 'text',
      text: {
        content: content
      }
    };
  }

  // 创建流式消息回复
  createStreamResponse(content, finish = true, images = [], streamId = null) {
    const streamResponse = {
      msgtype: 'stream',
      stream: {
        id: streamId || `stream_${Date.now()}`,
        finish: finish,
        content: content
      }
    };
    
    // 如果是最后一次回复且有图片，添加图片到msg_item
    if (finish && images.length > 0) {
      streamResponse.stream.msg_item = images.map(image => ({
        msgtype: 'image',
        image: {
          base64: image.base64,
          md5: image.md5
        }
      }));
    }
    
    return streamResponse;
  }

  // 创建模板卡片回复
  createTemplateCardResponse(templateCard) {
    return {
      msgtype: 'template_card',
      template_card: templateCard
    };
  }

  // 发送群机器人消息（通过Webhook）
  async sendWebhookMessage(content) {
    try {
      if (!this.webhookUrl) {
        return false;
      }

      const response = await axios.post(this.webhookUrl, {
        msgtype: 'text',
        text: {
          content: content
        }
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = MessageHandler;