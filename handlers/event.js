// 事件类消息处理
export const handleEnterChatEvent = async (ctx) => {
  return ctx.createTemplateCardResponse({
    card_type: 'text_notice',
    main_title: { title: '欢迎使用智能助手', desc: '我是您的AI助手，可以帮助您解答问题和处理任务' },
    sub_title_text: '请直接向我提问，我会尽力为您提供帮助！',
    card_action: { type: 3, title: '开始对话', question: '你好，请问有什么可以帮助您的吗？' },
    task_id: `welcome_${Date.now()}`
  });
};

export const handleTemplateCardEvent = async (ctx, messageData) => {
  const { event } = messageData;
  const cardEvent = event.template_card_event;
  switch (cardEvent.event_key) {
    case 'submit_key':
      return ctx.createTextResponse('感谢您的提交！');
    default:
      return ctx.createTextResponse('收到您的操作，正在处理...');
  }
};

export const handleEvent = async (ctx, messageData) => {
  const { event } = messageData;
  const eventType = event.eventtype;
  switch (eventType) {
    case 'enter_chat':
      return handleEnterChatEvent(ctx, messageData);
    case 'template_card_event':
      return handleTemplateCardEvent(ctx, messageData);
    default:
      return null;
  }
};
