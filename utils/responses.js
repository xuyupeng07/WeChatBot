// 回复构造与打印
export const createTextResponse = (content) => ({
  msgtype: 'text',
  text: { content }
});

export const createStreamResponse = (content, finish = true, images = [], streamId = null) => {
  const streamResponse = {
    msgtype: 'stream',
    stream: { id: streamId || `stream_${Date.now()}`, finish, content }
  };
  if (finish && images.length > 0) {
    streamResponse.stream.msg_item = images.map((image) => ({
      msgtype: 'image',
      image: { base64: image.base64, md5: image.md5 }
    }));
  }
  return streamResponse;
};

export const createTemplateCardResponse = (templateCard) => ({
  msgtype: 'template_card',
  template_card: templateCard
});

export const printAIReply = (resp) => {
  const text = typeof resp === 'string' ? resp : (resp && resp.text) ? resp.text : '';
  if (text && text.trim()) {
    console.log('[AI回复]');
    console.log(text);
    console.log('===================================');
  }
};
