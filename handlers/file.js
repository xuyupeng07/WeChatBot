import { buildChatIdFromMessage } from '../utils/helpers.js';
import { downloadAndSaveFile } from '../utils/wechat.js';
import fs from 'fs';
import path from 'path';

/**
 * 准备文件附件（下载并构建URL）
 */
export const prepareFileAttachment = async (ctx, messageData) => {
    let localFilePath = null;
    try {
        const { file } = messageData;
    ctx.log('debug', 'File message data received', { 
        filename: file.filename, 
        fileext: file.fileext,
        filesize: file.filesize
    });
    const fileUrl = file.url;
        
        // 下载并解密文件
        localFilePath = await downloadAndSaveFile(fileUrl, file.filename);
        
        // 验证文件
        const stat = fs.statSync(localFilePath);
        if (!stat || stat.size === 0) {
            throw new Error('Downloaded file is empty or invalid');
        }

        // 构建公开访问URL
        const serverHost = process.env.SERVER_HOST;
        const fileName = path.basename(localFilePath);
        const host = (serverHost && !serverHost.includes('127.0.0.1') && !serverHost.includes('localhost'))
            ? serverHost
            : 'https://npzfibxxgmmk.sealoshzh.site';
        const publicFileUrl = `${host}/public/files/${fileName}`;
        
        return {
            fileName,
            publicFileUrl,
            localFilePath
        };
    } catch (error) {
        throw error;
    }
};

/**
 * 处理文件消息
 * @param {object} ctx MessageHandler 实例
 * @param {object} messageData 消息数据
 */
export const handleFileMessage = async (ctx, messageData) => {
  try {
    const { file } = messageData;
    
    // 初始化流式响应状态
    // 文件消息可能需要较长时间处理，先建立流式连接
    const streamId = ctx.createRequestId();
    ctx.activeStreams.set(streamId, {
      startTime: Date.now(),
      response: null // 这里是HTTP response对象，但在handleMessage中通常直接返回
    });
    
    // 我们需要通过Stream Response立即返回给微信/客户端，避免超时
    // 然后在后台进行下载、处理和AI对话
    
    // 存储流状态以便后续回调使用
    ctx.streamStore.set(streamId, {
      startTime: Date.now(),
      messageData,
      streamContent: '',
      aiResponse: '',
      aiCalling: true,
      isStreaming: true,
      streamComplete: false,
      lastUpdateTime: Date.now()
    });

    // 异步处理文件下载和AI请求
    processFileAndCallAI(ctx, messageData, streamId);

    // 返回流式响应对象给主程序
    return ctx.createStreamResponse('', false, [], streamId);

  } catch (error) {
    ctx.log('error', 'Error handling file message', { error: error.message });
    return ctx.createTextResponse('抱歉，处理文件时出现错误，请稍后再试。');
  }
};

/**
 * 异步下载文件并调用AI
 */
const processFileAndCallAI = async (ctx, messageData, streamId) => {
    let localFilePath = null;
    try {
        const { file } = messageData;
        const fileUrl = file.url;
        
        ctx.log('debug', 'Starting file download process', { fileUrl });
        
        const fileInfo = await prepareFileAttachment(ctx, messageData);
        localFilePath = fileInfo.localFilePath;
        const { fileName, publicFileUrl } = fileInfo;
        
        ctx.log('debug', 'File available at public URL', { publicFileUrl });
        
        // 准备调用AI
        const chatId = buildChatIdFromMessage(messageData);
        const requestId = ctx.createRequestId();
        
        // 构建AI请求数据
        // 如果没有额外的文本描述，就只发送文件
        let content = '';
        // 这里需要检查是否是混合消息（带文字的文件消息），目前我们假设单独的文件消息没有文字
        // 如果需要支持文件配文字，可能需要调整 handleMixedMessage 或在这里处理
        // 暂时保持空，让FastGPT自己处理文件内容，或者根据需求添加默认提示
        // 用户要求：没有文字说明就不发 text 对象
        
        const requestData = ctx.buildFastGPTRequestData(chatId, content, true, [
            {
                type: 'file',
                name: fileName,
                url: publicFileUrl
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
        ctx.log('error', 'Error in processFileAndCallAI', { error: error.message });
        const streamState = ctx.streamStore.get(streamId);
        if (streamState) {
            streamState.aiCalling = false;
            streamState.aiError = '抱歉，处理文件或调用AI时出现错误。';
            streamState.streamComplete = true;
            streamState.isStreaming = false;
        }
    } finally {
        // 可选：清理本地临时文件
        // 建议保留一段时间以供AI服务下载，或者使用定时任务清理
    }
};
