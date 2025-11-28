// 文本消息处理：初始化流式会话与AI调用
import { buildChatIdFromMessage } from '../utils/helpers.js';

export const processImmediateAIStream = async (ctx, content, streamId) => {
  try {
    const streamState = ctx.streamStore.get(streamId);
    if (!streamState) return;
    streamState.aiResponse = '';
    streamState.streamContent = '';
    streamState.isStreaming = true;
    const chatId = buildChatIdFromMessage(streamState.messageData);
    const requestId = ctx.createRequestId();
    const requestData = ctx.buildFastGPTRequestData(chatId, content, true);
    const config = ctx.buildAxiosConfig(true);
    const streamCallback = (chunk, isComplete) => {
      const currentStreamState = ctx.streamStore.get(streamId);
      if (!currentStreamState) return;
      if (!isComplete && chunk) {
        if ((currentStreamState.streamContent.length + chunk.length) > (ctx.config.maxBufferSize || 1024 * 1024)) {
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
    const fullContent = await ctx.handleStreamRequest(requestData, config, streamCallback, requestId);
    const currentStreamState = ctx.streamStore.get(streamId);
    if (currentStreamState) {
      currentStreamState.aiResponse = fullContent;
      currentStreamState.aiResponseTime = Date.now();
      currentStreamState.aiCalling = false;
      currentStreamState.streamComplete = true;
      currentStreamState.isStreaming = false;
      ctx.printAIReply(fullContent);
    }
  } catch (error) {
    const streamState = ctx.streamStore.get(streamId);
    if (streamState) {
      streamState.aiCalling = false;
      if (error.code === 'ECONNABORTED') {
        streamState.aiError = '抱歉，AI响应超时，请尝试简化您的问题后重新发送。';
      } else if (error.response && error.response.status >= 500) {
        streamState.aiError = '抱歉，AI服务暂时不可用，请稍后再试。';
      } else {
        streamState.aiError = '抱歉，处理您的问题时出现错误，请稍后再试。';
      }
    }
  }
};

export const handleTextMessage = async (ctx, messageData) => {
  const { text, msgid } = messageData;
  const content = text.content;
  const streamId = `stream_${msgid}_${Date.now()}`;
  ctx.streamStore.set(streamId, {
    step: 0,
    content: '',
    startTime: Date.now(),
    originalContent: content,
    messageData,
    aiCalling: true,
    streamContent: '',
    lastUpdateTime: Date.now()
  });
  processImmediateAIStream(ctx, content, streamId);
  return ctx.createStreamResponse('', false, [], streamId);
};

export const processAIStreamResponse = async (ctx, content, streamId, chatId = null) => {
  try {
    const streamState = ctx.streamStore.get(streamId);
    if (!streamState) return;
    streamState.aiResponse = '';
    streamState.streamContent = '';
    const streamCallback = ctx.makeStreamCallback(streamId);
    if (!chatId) chatId = ctx.buildChatIdFromMessage(streamState.messageData);
    const aiResponse = await ctx.getAIResponse(content, streamCallback, chatId);
    if (aiResponse) {
      const currentStreamState = ctx.streamStore.get(streamId);
      if (currentStreamState) {
        currentStreamState.aiResponse = typeof aiResponse === 'object' ? (aiResponse.text || '') : aiResponse;
        currentStreamState.aiResponseTime = Date.now();
        currentStreamState.aiCalling = false;
        currentStreamState.streamComplete = true;
        ctx.printAIReply(aiResponse);
      }
    } else {
      const currentStreamState = ctx.streamStore.get(streamId);
      if (currentStreamState) {
        currentStreamState.aiCalling = false;
        currentStreamState.aiError = '抱歉，我现在无法回答您的问题，请稍后再试。';
      }
    }
  } catch (error) {
    const streamState = ctx.streamStore.get(streamId);
    if (streamState) {
      streamState.aiCalling = false;
      if (error.code === 'ECONNABORTED') {
        streamState.aiError = '抱歉，AI响应超时，请尝试简化您的问题后重新发送。';
      } else if (error.response && error.response.status >= 500) {
        streamState.aiError = '抱歉，AI服务暂时不可用，请稍后再试。';
      } else {
        streamState.aiError = '抱歉，处理您的问题时出现错误，请稍后再试。';
      }
    }
  }
};
