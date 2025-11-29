import { buildChatIdFromMessage } from '../utils/helpers.js';
import { downloadAndSaveImage } from '../utils/wechat.js';
import fs from 'fs';

export const prepareImageAttachment = async (ctx, imageUrl) => {
  let localImagePath = null;
  try {
    // 1. 下载图片到本地 public 目录
    // 使用外部配置的 SERVER_HOST 作为公开访问域名
    const serverHost = process.env.SERVER_HOST;
    
    ctx.log('debug', 'Downloading image to local storage', { imageUrl });
    localImagePath = await downloadAndSaveImage(imageUrl);
    const fileName = localImagePath.split('/').pop();
    const host = (serverHost && !serverHost.includes('127.0.0.1') && !serverHost.includes('localhost'))
      ? serverHost
      : 'https://npzfibxxgmmk.sealoshzh.site';
    const publicImageUrl = `${host}/public/images/${fileName}`;
    
    // 校验本地文件是否是图片且可读
    const stat = fs.statSync(localImagePath);
    if (!stat || stat.size < 1000) {
        throw new Error('Downloaded image too small or invalid');
    }
    ctx.log('debug', 'Image available at public URL', { publicImageUrl });
    
    return {
        publicImageUrl,
        localImagePath
    };
  } catch (error) {
      throw error;
  }
};

export const processImmediateAIStreamWithImage = async (ctx, content, imageUrl, streamId) => {
  let localImagePath = null;
  try {
    const streamState = ctx.streamStore.get(streamId);
    if (!streamState) return;
    streamState.aiResponse = '';
    streamState.streamContent = '';
    streamState.isStreaming = true;
    const chatId = buildChatIdFromMessage(streamState.messageData);
    const requestId = ctx.createRequestId();

    const imageInfo = await prepareImageAttachment(ctx, imageUrl);
    localImagePath = imageInfo.localImagePath;
    const { publicImageUrl } = imageInfo;
    
    // 构建带图片的请求数据
    const requestData = ctx.buildFastGPTRequestData(chatId, content || '图片内容分析', true, [
        {
            type: 'image',
            url: publicImageUrl
        }
    ]);

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
      // Ensure stream is properly closed on error
      streamState.streamComplete = true;
      streamState.isStreaming = false;
    }
  } finally {
      // 清理临时文件（可选，建议保留一段时间或通过定时任务清理）
      // if (localImagePath && fs.existsSync(localImagePath)) {
      //     fs.unlink(localImagePath, (err) => {
      //         if (err) console.error('Failed to delete temp image:', err);
      //     });
      // }
  }
};

export const handleImageMessage = async (ctx, messageData) => {
  const { image, msgid } = messageData;
  const imageUrl = image.url;
  const content = '请分析这张图片'; // 默认文本提示
  
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
  
  processImmediateAIStreamWithImage(ctx, content, imageUrl, streamId);
  return ctx.createStreamResponse('', false, [], streamId);
};
