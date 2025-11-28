// 图文混排消息处理
import { processImmediateAIStreamWithImage } from './image.js';

export const handleMixedMessage = async (ctx, messageData) => {
  const { mixed, msgid } = messageData;
  let textContent = '';
  let imageUrl = null;

  mixed.msg_item.forEach((item) => {
    if (item.msgtype === 'text') {
      textContent += item.text.content + ' ';
    } else if (item.msgtype === 'image') {
      // 优先取第一个图片
      if (!imageUrl) {
        imageUrl = item.image.url;
      }
    }
  });

  const finalContent = textContent.trim() || '图文消息分析';

  // 如果有图片，使用图片处理流程
  if (imageUrl) {
    const streamId = `stream_${msgid}_${Date.now()}`;
    ctx.streamStore.set(streamId, {
      step: 0,
      content: '',
      startTime: Date.now(),
      originalContent: finalContent,
      messageData,
      aiCalling: true,
      streamContent: '',
      lastUpdateTime: Date.now()
    });

    // 调用带图片的流式处理
    processImmediateAIStreamWithImage(ctx, finalContent, imageUrl, streamId);
    
    // 返回流式响应占位
    return ctx.createStreamResponse('', false, [], streamId);
  }

  // 纯文本处理
  if (finalContent) {
    const chatId = ctx.buildChatIdFromMessage(messageData);
    const aiResponse = await ctx.getAIResponse(finalContent, null, chatId);
    if (aiResponse) {
      if (typeof aiResponse === 'object') {
        return ctx.createStreamResponse(aiResponse.text || '', true, aiResponse.images || []);
      }
      return ctx.createStreamResponse(aiResponse, true);
    }
  }
  
  return ctx.createTextResponse('我收到了您的图文消息，但似乎没有有效内容。');
};
