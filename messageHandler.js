import { defaultConfig } from './constants/config.js';
import * as responses from './utils/responses.js';
import * as helpers from './utils/helpers.js';
import * as aiClient from './utils/aiClient.js';
import * as cleanup from './utils/cleanup.js';
import { log as baseLog } from './utils/logger.js';
import * as textHandler from './handlers/text.js';
import * as imageHandler from './handlers/image.js';
import * as streamHandler from './handlers/stream.js';
import * as mixedHandler from './handlers/mixed.js';
import * as eventHandler from './handlers/event.js';
import * as fileHandler from './handlers/file.js';
import * as voiceHandler from './handlers/voice.js';
import * as statsUtil from './utils/stats.js';
import * as webhook from './utils/webhook.js';

/**
 * 消息处理器：封装AI调用、流式处理与系统统计
 * 支持依赖注入（logger、aiClient）以提升可测试性与可维护性
 */
class MessageHandler {
  constructor(options = {}) {
    const { logger = baseLog, aiClientImpl = aiClient } = options;
    this.aiApiUrl = process.env.FASTGPT_API_URL;
    this.aiApiKey = process.env.FASTGPT_API_KEY;
    this.webhookUrl = process.env.WECHAT_WEBHOOK_URL;
    this.connectionPool = new Map();
    this.responseCache = new Map();
    this.activeStreams = new Map();
    this.streamStore = new Map();
    this.stats = { totalRequests: 0, failedRequests: 0, cachedResponses: 0, streamRequests: 0 };
    this.config = { ...defaultConfig };
    this.aiClient = aiClientImpl;
    this.log = (level, message, data = {}) => logger(level, message, data);
    
    // Message Buffer
    this.messageBuffer = new Map(); // Map<userId, { messages: [], timer: null }>
    this.BUFFER_WINDOW_MS = 2000; // 2 seconds window to combine messages

    this.startCleanupTask();
  }
  startCleanupTask() { setInterval(() => { this.cleanup(); }, 60000); }
  cleanup() {
    const now = Date.now();
    let cleanedItems = 0;
    cleanedItems += cleanup.removeIf(this.responseCache, (key, entry) => now - entry.timestamp > this.config.cacheTimeout);
    cleanedItems += cleanup.removeIf(this.connectionPool, (key, connection) => now - connection.startTime > this.config.requestTimeout);
    cleanedItems += cleanup.removeIf(this.activeStreams, (streamId, stream) => now - stream.startTime > this.config.requestTimeout);
    cleanedItems += cleanup.removeIf(this.streamStore, (streamId, streamState) => ((now - streamState.startTime) / 1000) > 1200);
    if (cleanedItems > 0) {
      this.log('debug', '资源清理完成', { cleanedItems });
    }
  }

  async handleMessage(messageData) {
    try {
        // Implement buffering strategy for text and file/image messages
        const userId = this.extractUserId(messageData.from);
        
        // Only buffer text, file, and image messages for potential combination
        if (['text', 'file', 'image'].includes(messageData.msgtype)) {
            return await this.bufferMessage(userId, messageData);
        }

        return await this.processSingleMessage(messageData);
    } catch (e) {
      this.log('error', 'Handle message error', { error: e.message });
      return this.createTextResponse('抱歉，处理消息时出现错误，请稍后再试。');
    }
  }

  async bufferMessage(userId, messageData) {
      if (!this.messageBuffer.has(userId)) {
          this.messageBuffer.set(userId, {
              messages: [],
              timer: null,
              resolve: null
          });
      }

      const buffer = this.messageBuffer.get(userId);
      buffer.messages.push(messageData);

      // If it's the first message, start the timer and return a promise
      if (buffer.messages.length === 1) {
           return new Promise((resolve) => {
               buffer.resolve = resolve;
               buffer.timer = setTimeout(() => {
                   this.processBufferedMessages(userId);
               }, this.BUFFER_WINDOW_MS);
           });
      } else {
          // Subsequent messages reset the timer? Or just wait?
          // Strategy: wait for the window to close. 
          // But we need to return something for subsequent requests too if they are separate HTTP requests?
          // Actually, in Wechat callback mode, each request is separate.
          // If we hold the first request, we can return the combined result there.
          // For subsequent requests, we might just return empty success to acknowledge receipt?
          // But we need to be careful not to timeout.
          
          return new Promise((resolve) => {
              // We'll resolve subsequent requests immediately with empty response
              // to avoid WeChat retries, assuming the first request will handle the reply.
              // OR, we can have the first request handle the logic and send response.
              // But since we need to return XML/JSON to WeChat for EACH request...
              // If we return empty for subsequent, WeChat won't show anything.
              // If we combine, we only want ONE reply from AI.
              
              // Let's decide: The FIRST request (which holds the timer) will eventually 
              // trigger the processing and return the AI response.
              // Subsequent requests within the window will just return empty string to ACK.
              
              resolve({}); 
          });
      }
  }

  async processBufferedMessages(userId) {
      const buffer = this.messageBuffer.get(userId);
      if (!buffer) return;

      const messages = [...buffer.messages];
      const resolve = buffer.resolve;
      
      this.messageBuffer.delete(userId); // Clear buffer immediately

      try {
          if (messages.length === 1) {
              const response = await this.processSingleMessage(messages[0]);
              if (resolve) resolve(response);
          } else {
              const response = await this.processCombinedMessages(messages);
              if (resolve) resolve(response);
          }
      } catch (error) {
          this.log('error', 'Error processing buffered messages', { error: error.message });
          if (resolve) resolve(this.createTextResponse('处理消息失败'));
      }
  }

  async processCombinedMessages(messages) {
      // Sort messages to find text and attachments
      let textContent = '';
      const attachments = [];
      let mainMsgId = messages[0].msgid;
      let targetMessageData = messages[0];

      for (const msg of messages) {
          if (msg.msgtype === 'text') {
              textContent += msg.text.content + ' ';
              // Prefer using text message as base for replying
              mainMsgId = msg.msgid;
              targetMessageData = msg;
          } else if (msg.msgtype === 'file') {
              attachments.push({ type: 'file', data: msg.file });
              if (msg.msgid > mainMsgId) mainMsgId = msg.msgid; // Use latest?
          } else if (msg.msgtype === 'image') {
              attachments.push({ type: 'image', data: msg.image });
          }
      }
      
      textContent = textContent.trim();

      // Logic to handle combination
      // Case 1: Text + File
      // Case 2: Text + Image
      // Case 3: Multiple Files/Images (maybe just take first for now or support list)
      
      // For now, we support 1 Text + 1 Attachment (File or Image) primarily, 
      // but FastGPT API supports multiple.
      
      if (attachments.length > 0) {
          // Use the first attachment's type to decide handler, or a generic one?
          // We need a new handler for "Text + Attachments"
          
          return await this.handleTextWithAttachments(targetMessageData, textContent, attachments);
      }

      // Fallback if only texts
      return await this.handleTextMessage({ ...targetMessageData, text: { content: textContent } });
  }

  async handleTextWithAttachments(messageData, textContent, attachments) {
      // This is a new handler method to coordinate
      const streamId = this.createRequestId();
      this.activeStreams.set(streamId, {
          startTime: Date.now(),
          response: null
      });

      this.streamStore.set(streamId, {
          startTime: Date.now(),
          messageData,
          streamContent: '',
          aiResponse: '',
          aiCalling: true,
          isStreaming: true,
          streamComplete: false,
          lastUpdateTime: Date.now()
      });

      // Async processing
      this.processAttachmentsAndCallAI(messageData, textContent, attachments, streamId);

      return this.createStreamResponse('', false, [], streamId);
  }

  async processAttachmentsAndCallAI(messageData, textContent, attachments, streamId) {
      try {
          const chatId = this.buildChatIdFromMessage(messageData);
          const preparedAttachments = [];

          for (const att of attachments) {
              if (att.type === 'file') {
                   const fileInfo = await fileHandler.prepareFileAttachment(this, { file: att.data });
                   preparedAttachments.push({
                       type: 'file',
                       name: fileInfo.fileName,
                       url: fileInfo.publicFileUrl
                   });
              } else if (att.type === 'image') {
                   const imageInfo = await imageHandler.prepareImageAttachment(this, att.data.url);
                   preparedAttachments.push({
                       type: 'image',
                       url: imageInfo.publicImageUrl
                   });
              }
          }

          const content = textContent || (preparedAttachments[0].type === 'file' ? '请分析上传的文件' : '请分析这张图片');
          
          const requestData = this.buildFastGPTRequestData(chatId, content, true, preparedAttachments);
          const config = this.buildAxiosConfig(true);
          const requestId = this.createRequestId();

          const streamCallback = (chunk, isComplete) => {
              const currentStreamState = this.streamStore.get(streamId);
              if (!currentStreamState) return;
              
              if (!isComplete && chunk) {
                  if ((currentStreamState.streamContent.length + chunk.length) > (this.config.maxBufferSize || 1024 * 1024)) {
                      currentStreamState.aiError = '流式响应过大，已终止';
                      currentStreamState.aiCalling = false;
                      currentStreamState.streamComplete = true;
                      currentStreamState.isStreaming = false;
                      return;
                  }
                  currentStreamState.streamContent += chunk;
                  currentStreamState.lastUpdateTime = Date.now();
              } else if (isComplete) {
                  currentStreamState.aiCalling = false;
                  currentStreamState.streamComplete = true;
                  currentStreamState.isStreaming = false;
              }
          };

          const fullContent = await this.handleStreamRequest(requestData, config, streamCallback, requestId);
          
          const currentStreamState = this.streamStore.get(streamId);
          if (currentStreamState) {
              currentStreamState.aiResponse = fullContent;
              currentStreamState.aiResponseTime = Date.now();
              currentStreamState.aiCalling = false;
              currentStreamState.streamComplete = true;
              currentStreamState.isStreaming = false;
              this.printAIReply(fullContent);
          }

      } catch (error) {
          this.log('error', 'Error in processAttachmentsAndCallAI', { error: error.message });
          const streamState = this.streamStore.get(streamId);
          if (streamState) {
              streamState.aiCalling = false;
              streamState.aiError = '抱歉，处理附件或调用AI时出现错误。';
              streamState.streamComplete = true;
              streamState.isStreaming = false;
          }
      }
  }

  async processSingleMessage(messageData) {
      const { msgtype } = messageData;
      
      // Add logging for image messages as requested
      if (msgtype === 'image') {
        // Log image message received
        console.log(`[Image Message] ID: ${messageData.msgid} from ${messageData.from.userid}`);
        console.log('--- Raw WeChat Image Message ---');
        console.log(JSON.stringify(messageData, null, 2));
        console.log('--------------------------------');
      }

      switch (msgtype) {
        case 'text': return await this.handleTextMessage(messageData);
        case 'image': return await this.handleImageMessage(messageData);
        case 'mixed': return await this.handleMixedMessage(messageData);
        case 'file': return await this.handleFileMessage(messageData);
        case 'voice': return await this.handleVoiceMessage(messageData);
        case 'event': return await this.handleEvent(messageData);
        case 'stream': return await this.handleStreamMessage(messageData);
        default: return this.createTextResponse('抱歉，我暂时无法处理这种类型的消息。');
      }
  }

  async handleTextMessage(messageData) { return textHandler.handleTextMessage(this, messageData); }
  async processAIStreamResponse(content, streamId, chatId = null) { return textHandler.processAIStreamResponse(this, content, streamId, chatId); }
  async processAIRequestAsync(content, streamId) { return textHandler.processAIRequestAsync(this, content, streamId); }

  async handleStreamMessage(messageData) { return streamHandler.handleStreamMessage(this, messageData); }
  generateStreamContent(streamId, step) { return streamHandler.generateStreamContent(this, streamId, step); }
  makeStreamCallback(streamId) { return streamHandler.makeStreamCallback(this, streamId); }

  async handleMixedMessage(messageData) { return mixedHandler.handleMixedMessage(this, messageData); }
  async handleFileMessage(messageData) { return fileHandler.handleFileMessage(this, messageData); }
  async handleVoiceMessage(messageData) { return voiceHandler.handleVoiceMessage(this, messageData); }
  async handleEvent(messageData) { return eventHandler.handleEvent(this, messageData); }
  async handleEnterChatEvent(messageData) { return eventHandler.handleEnterChatEvent(this, messageData); }
  async handleTemplateCardEvent(messageData) { return eventHandler.handleTemplateCardEvent(this, messageData); }

  createTextResponse(content) { return responses.createTextResponse(content); }
  
  createStreamResponse(content, finish = true, images = [], streamId = null) { return responses.createStreamResponse(content, finish, images, streamId); }

  createTemplateCardResponse(templateCard) { return responses.createTemplateCardResponse(templateCard); }

  printAIReply(resp) { return responses.printAIReply(resp); }

  extractUserId(from) { return helpers.extractUserId(from); }
  buildChatIdFromMessage(messageData) { return helpers.buildChatIdFromMessage(messageData); }
  generateCacheKey(content, chatId) { return helpers.generateCacheKey(content, chatId); }
  createRequestId() { return helpers.createRequestId(); }

  buildFastGPTRequestData(chatId, content, stream, attachments) { return this.aiClient.buildFastGPTRequestData(chatId, content, stream, attachments); }

  buildAxiosConfig(stream) { return this.aiClient.buildAxiosConfig(this.aiApiKey, this.config.requestTimeout, stream); }

  async handleStreamRequest(requestData, config, streamCallback, requestId) { return this.aiClient.handleStreamRequest(this.aiApiUrl, requestData, config, streamCallback, requestId, this.log.bind(this), this.activeStreams); }

  async getAIResponse(content, streamCallback = null, chatId = null) { return this.aiClient.getAIResponse(this, content, streamCallback, chatId); }

  async handleImageMessage(messageData) { return imageHandler.handleImageMessage(this, messageData); }

  async sendWebhookMessage(content) { return webhook.sendWebhookMessage(this.webhookUrl, content, this.log.bind(this)); }

  getHealthStatus() { return statsUtil.getHealthStatus(this); }
  getStats() { return statsUtil.getStats(this); }
  shutdown() { return statsUtil.shutdown(this); }
  resetStats() { return statsUtil.resetStats(this); }
}

export default MessageHandler;
