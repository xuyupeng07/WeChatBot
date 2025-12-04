// 图文混排消息处理
import { processImmediateAIStreamWithImage } from './image.js';

export const handleMixedMessage = async (ctx, messageData) => {
  const { mixed, msgid } = messageData;
  let textContent = '';
  const images = [];

  mixed.msg_item.forEach((item) => {
    if (item.msgtype === 'text') {
      textContent += item.text.content + ' ';
    } else if (item.msgtype === 'image') {
      images.push(item.image.url);
    }
  });

  const finalContent = textContent.trim(); // No default text

  // 如果有图片，使用图片处理流程
  if (images.length > 0) {
    const streamId = `stream_${msgid}_${Date.now()}`;
    ctx.streamStore.set(streamId, {
      step: 0,
      content: '',
      startTime: Date.now(),
      originalContent: finalContent || '', // No default text
      messageData,
      aiCalling: true,
      streamContent: '',
      lastUpdateTime: Date.now()
    });

    // Prepare attachments format that processAttachmentsAndCallAI expects
    // However, processAttachmentsAndCallAI is in MessageHandler and takes attachments array with { type, data: { url } }
    // But here we are in mixed handler.
    // We should reuse the logic in MessageHandler or call a specialized function.
    // The previous code called processImmediateAIStreamWithImage which only handled ONE image.
    
    // We need to construct attachments array
    const attachments = images.map(url => ({ type: 'image', data: { url } }));
    
    // Call the main handler's method to process attachments
    // Note: We need to make sure we have access to it. 'ctx' is MessageHandler instance.
    ctx.processAttachmentsAndCallAI(messageData, finalContent, attachments, streamId);
    
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
