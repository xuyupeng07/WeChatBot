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
        case 'event': return await this.handleEvent(messageData);
        case 'stream': return await this.handleStreamMessage(messageData);
        default: return this.createTextResponse('抱歉，我暂时无法处理这种类型的消息。');
      }
    } catch (e) {
      return this.createTextResponse('抱歉，处理消息时出现错误，请稍后再试。');
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
  async handleEvent(messageData) { return eventHandler.handleEvent(this, messageData); }
  async handleEnterChatEvent(messageData) { return eventHandler.handleEnterChatEvent(this, messageData); }
  async handleTemplateCardEvent(messageData) { return eventHandler.handleTemplateCardEvent(this, messageData); }

  createTextResponse(content) { return responses.createTextResponse(content); }
  
  createStreamResponse(content, finish = true, images = [], streamId = null) { return responses.createStreamResponse(content, finish, images, streamId); }

  printAIReply(resp) { return responses.printAIReply(resp); }

  extractUserId(from) { return helpers.extractUserId(from); }
  buildChatIdFromMessage(messageData) { return helpers.buildChatIdFromMessage(messageData); }
  generateCacheKey(content, chatId) { return helpers.generateCacheKey(content, chatId); }
  createRequestId() { return helpers.createRequestId(); }

  buildFastGPTRequestData(chatId, content, stream) { return this.aiClient.buildFastGPTRequestData(chatId, content, stream); }

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
