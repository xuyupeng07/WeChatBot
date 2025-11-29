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
  let content = text.content;
  
  // 如果是群聊消息，去除 @机器人 部分
  if (messageData.chatid && content.includes('@')) {
      // 简单的去除逻辑：去除第一个 @ 及其后面的名称（假设名称后面有空格或直接结束）
      // 更稳健的方式是根据 messageData 中的具体字段来判断（如果企业微信提供了被@的信息）
      // 但通常 content 中包含了 @Name，我们尝试去除它。
      // 注意：企业微信回调的 text.content 中，@机器人 通常位于消息开头或结尾
      // 这里做一个简单的替换：将 "@机器人名称" 替换为空字符串。
      // 由于我们不知道机器人的具体名称，我们可能需要去除 content 中的所有 "@xxx " 格式，或者假设 @ 在开头。
      // 实际上，企业微信机器人回调时，content通常包含@部分。
      // 为了安全起见，我们可以尝试去除开头的 "@.*? "
      
      content = content.replace(/^@\S+\s*/, '').trim();
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
