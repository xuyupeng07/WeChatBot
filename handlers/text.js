// 文本消息处理：初始化流式会话与AI调用
import { buildChatIdFromMessage } from '../utils/helpers.js';
import { prepareImageAttachment } from './image.js';
import { prepareFileAttachment } from './file.js';

/**
 * 处理引用消息内容
 * @param {object} ctx MessageHandler 实例
 * @param {object} quote 引用消息对象
 * @returns {Promise<string>} 处理后的引用内容字符串
 */
async function processQuoteContent(ctx, quote) {
    const { msgtype } = quote;
    const result = {
        text: '',
        attachments: []
    };
    
    switch (msgtype) {
        case 'text':
            result.text = quote.text?.content || '';
            break;
        case 'image':
            // 处理图片引用
            const imageUrl = quote.image?.url;
            if (imageUrl) {
                try {
                    const imageInfo = await prepareImageAttachment(ctx, imageUrl);
                    result.text = '[图片引用]';
                    result.attachments.push({
                        type: 'image',
                        url: imageInfo.publicImageUrl
                    });
                } catch (error) {
                    ctx.log('error', 'Failed to process quoted image', { error: error.message });
                    result.text = '[图片引用(处理失败)]';
                }
            }
            break;
        case 'mixed':
            // 处理图文混排引用
            const msgItems = quote.mixed?.msg_item || [];
            const textParts = [];
            
            for (const item of msgItems) {
                if (item.msgtype === 'text') {
                    textParts.push(item.text?.content || '');
                } else if (item.msgtype === 'image') {
                    const imageUrl = item.image?.url;
                    if (imageUrl) {
                        try {
                            const imageInfo = await prepareImageAttachment(ctx, imageUrl);
                            textParts.push('[图片]');
                            result.attachments.push({
                                type: 'image',
                                url: imageInfo.publicImageUrl
                            });
                        } catch (error) {
                            ctx.log('error', 'Failed to process quoted mixed image', { error: error.message });
                            textParts.push('[图片(处理失败)]');
                        }
                    }
                }
            }
            
            result.text = textParts.join(' ');
            break;
        case 'voice':
            result.text = quote.voice?.content || '[语音引用]';
            break;
        case 'file':
            // 处理文件引用
            const fileUrl = quote.file?.url;
            if (fileUrl) {
                try {
                    // 构建临时的 messageData 对象用于 prepareFileAttachment
                    const tempMessageData = { file: { url: fileUrl } };
                    const fileInfo = await prepareFileAttachment(ctx, tempMessageData);
                    result.text = `[文件引用: ${fileInfo.fileName}]`;
                    result.attachments.push({
                        type: 'file',
                        name: fileInfo.fileName,
                        url: fileInfo.publicFileUrl
                    });
                } catch (error) {
                    ctx.log('error', 'Failed to process quoted file', { error: error.message });
                    result.text = '[文件引用(处理失败)]';
                }
            }
            break;
        default:
            result.text = '[不支持的引用类型]';
    }
    
    return result;
}

export const processImmediateAIStream = async (ctx, content, streamId, attachments = []) => {
  try {
    const streamState = ctx.streamStore.get(streamId);
    if (!streamState) return;
    streamState.aiResponse = '';
    streamState.streamContent = '';
    streamState.isStreaming = true;
    const chatId = buildChatIdFromMessage(streamState.messageData);
    const requestId = ctx.createRequestId();
    // 构建包含附件的FastGPT请求数据
    const requestData = ctx.buildFastGPTRequestData(chatId, content, true, attachments);
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
  const { text, msgid, quote } = messageData;
  let content = text.content;
  let attachments = [];
  
  // 如果是群聊消息，去除 @机器人 部分
  if (messageData.chatid && content.includes('@')) {
      // 简单的去除逻辑：去除第一个 @ 及其后面的名称（假设名称后面有空格或直接结束）
      content = content.replace(/^@\S+\s*/, '').trim();
  }
  
  // 处理引用消息
  if (quote) {
      let quoteResult = await processQuoteContent(ctx, quote);
      if (quoteResult && quoteResult.text) {
          // 仅处理附件，不将引用文本添加到原始内容中
          if (quoteResult.attachments && quoteResult.attachments.length > 0) {
              attachments = [...attachments, ...quoteResult.attachments];
          }
      }
  }

  // 检查特殊命令 - 投票卡片测试 (企业级示例)
  if (content === '测试投票') {
      return ctx.createTemplateCardResponse({
          card_type: 'vote_interaction',
          source: {
              desc: '满意度调查',
          },
          main_title: {
              title: '本次IT服务满意度调查',
              desc: '请针对本次故障处理服务进行评价'
          },
          task_id: `satisfaction_survey_${Date.now()}`,
          checkbox: {
              question_key: 'service_rating',
              option_list: [
                  { id: 'rating_5', text: '⭐⭐⭐⭐⭐ 非常满意', is_checked: false },
                  { id: 'rating_4', text: '⭐⭐⭐⭐ 满意', is_checked: false },
                  { id: 'rating_3', text: '⭐⭐⭐ 一般', is_checked: false },
                  { id: 'rating_2', text: '⭐⭐ 不满意', is_checked: false },
                  { id: 'rating_1', text: '⭐ 非常不满意', is_checked: false }
              ],
              mode: 0 // 0:单选
          },
          submit_button: {
              text: '提交评价',
              key: 'survey_submit'
          }
      });
  }

  // 检查特殊命令 - 多选卡片测试 (企业级示例)
  if (content === '测试多选') {
      return ctx.createTemplateCardResponse({
          card_type: 'multiple_interaction',
          source: {
              desc: '会议室预定',
          },
          main_title: {
              title: '研发周会会议室预定',
              desc: '请选择会议日期、时间及所需设备'
          },
          task_id: `meeting_room_reserve_${Date.now()}`,
          select_list: [
              {
                  question_key: 'meeting_date',
                  title: '选择日期',
                  selected_id: '',
                  option_list: [
                      { id: 'date_mon', text: '周一 (11月24日)' },
                      { id: 'date_tue', text: '周二 (11月25日)' },
                      { id: 'date_wed', text: '周三 (11月26日)' },
                      { id: 'date_thu', text: '周四 (11月27日)' },
                      { id: 'date_fri', text: '周五 (11月28日)' }
                  ]
              },
              {
                  question_key: 'meeting_time',
                  title: '选择时间段',
                  selected_id: '',
                  option_list: [
                      { id: 'time_am', text: '上午 10:00 - 12:00' },
                      { id: 'time_pm1', text: '下午 14:00 - 16:00' },
                      { id: 'time_pm2', text: '下午 16:00 - 18:00' }
                  ]
              },
              {
                  question_key: 'meeting_equipment',
                  title: '所需设备',
                  selected_id: '',
                  option_list: [
                      { id: 'eq_projector', text: '投影仪' },
                      { id: 'eq_whiteboard', text: '白板' },
                      { id: 'eq_video', text: '视频会议系统' }
                  ]
              }
          ],
          submit_button: {
              text: '确认预定',
              key: 'reserve_submit'
          }
      });
  }

  const streamId = `stream_${msgid}_${Date.now()}`;
  ctx.streamStore.set(streamId, {
    step: 0,
    content: '',
    startTime: Date.now(),
    originalContent: content,
    messageData,
    aiCalling: true,
    streamContent: '',
    lastUpdateTime: Date.now(),
    attachments // 保存附件到流状态
  });
  processImmediateAIStream(ctx, content, streamId, attachments);
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
