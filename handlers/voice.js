/**
 * 处理语音消息
 * @param {object} context - MessageHandler实例
 * @param {object} messageData - 消息数据
 * @returns {object} - 回复消息
 */
export async function handleVoiceMessage(context, messageData) {
  context.log('info', '收到语音消息', { msgId: messageData.msgid, userId: messageData.from.userid });
  
  try {
    // 获取语音转出的文本内容
    const voiceContent = messageData.voice.content;
    
    if (!voiceContent) {
      context.log('warn', '语音消息中没有文本内容', { msgId: messageData.msgid });
      return context.createTextResponse('无法识别语音内容，请发送文字消息。');
    }
    
    context.log('info', '语音转文本内容', { content: voiceContent });
    
    // 构造一个文本消息对象，复用文本消息处理逻辑
    const textMessageData = {
      ...messageData,
      msgtype: 'text',
      text: {
        content: voiceContent
      }
    };
    
    // 调用文本消息处理逻辑，将转换后的文本发送给FastGPT
    return await context.handleTextMessage(textMessageData);
  } catch (error) {
    context.log('error', '处理语音消息失败', { error: error.message, stack: error.stack });
    return context.createTextResponse('抱歉，处理语音消息时出现错误，请稍后再试。');
  }
}
