// 流式消息处理与内容生成
export const generateStreamContent = (ctx, streamId, step) => {
  const s = ctx.streamStore.get(streamId);
  if (!s) return { content: '会话已结束', finished: true };
  const elapsed = (Date.now() - s.startTime) / 1000;
  if (elapsed > 900) return { content: '抱歉，处理时间过长，请重新发送消息', finished: true };
  if (s.aiError) return { content: s.aiError, finished: true };
  if (s.streamContent !== undefined) return { content: s.streamContent, finished: !!s.streamComplete };
  if (s.aiResponse && !s.streamContent) return { content: s.aiResponse, finished: true };
  return { content: '', finished: false };
};

export const makeStreamCallback = (ctx, streamId) => {
  return (chunk, isComplete) => {
    const s = ctx.streamStore.get(streamId);
    if (!s) return;
    if (!isComplete && chunk) {
      s.streamContent += chunk;
      s.lastUpdateTime = Date.now();
    } else if (isComplete) {
      s.aiCalling = false;
      s.streamComplete = true;
      s.isStreaming = false;
    }
  };
};

export const handleStreamMessage = async (ctx, messageData) => {
  const { stream } = messageData;
  const streamId = stream.id;
  if (!ctx.streamStore.has(streamId)) {
    const parts = streamId.split('_');
    if (parts.length >= 3) {
      ctx.streamStore.set(streamId, {
        step: 0,
        content: '',
        startTime: Date.now(),
        originalContent: '继续之前的对话',
        messageData,
        recovered: true
      });
    } else {
      return ctx.createStreamResponse('会话状态已丢失，请重新发送消息', true, [], streamId);
    }
  }
  const streamState = ctx.streamStore.get(streamId);
  streamState.step++;
  const { content, finished } = generateStreamContent(ctx, streamId, streamState.step);
  streamState.content = content;
  if (finished) ctx.streamStore.delete(streamId);
  return ctx.createStreamResponse(content, finished, [], streamId);
};
