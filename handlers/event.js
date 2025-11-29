import { createTemplateCardResponse } from '../utils/responses.js';

// 事件类消息处理
export const handleEnterChatEvent = async (ctx, messageData) => {
  // 欢迎语卡片
  return createTemplateCardResponse({
    card_type: 'text_notice',
    source: {
        icon_url: 'https://wework.qpic.cn/wwpic/252813_jOfDHtcISzuayRi_1628250249/0',
        desc: '智能助手',
        desc_color: 0
    },
    main_title: { 
        title: '欢迎使用企业智能助手', 
        desc: '我是您的AI助手，可以帮助您解答问题、处理审批及日程安排' 
    },
    emphasis_content: {
        title: '随时为您服务',
        desc: '24小时在线'
    },
    sub_title_text: '请直接向我提问，或输入"功能菜单"查看更多服务！',
    card_action: { 
        type: 1, 
        url: 'https://work.weixin.qq.com'
    },
    task_id: `welcome_${Date.now()}`
  });
};

export const handleTemplateCardEvent = async (ctx, messageData) => {
  const { event } = messageData;
  const cardEvent = event.template_card_event;
  
  console.log('[Template Card Event]', JSON.stringify(cardEvent, null, 2));

  // 处理投票卡片
  if (cardEvent.card_type === 'vote_interaction') {
      // 构造更新卡片的响应
      const updatedCard = {
          card_type: 'vote_interaction',
          source: {
            desc: '满意度调查'
          },
          main_title: {
              title: '本次IT服务满意度调查',
              desc: '感谢您的评价！'
          },
          task_id: cardEvent.task_id,
          checkbox: {
              question_key: 'service_rating',
              option_list: [
                  { id: 'rating_5', text: '⭐⭐⭐⭐⭐ 非常满意', is_checked: false },
                  { id: 'rating_4', text: '⭐⭐⭐⭐ 满意', is_checked: false },
                  { id: 'rating_3', text: '⭐⭐⭐ 一般', is_checked: false },
                  { id: 'rating_2', text: '⭐⭐ 不满意', is_checked: false },
                  { id: 'rating_1', text: '⭐ 非常不满意', is_checked: false }
              ],
              mode: 0,
              disable: true // 禁用所有选项
          },
          submit_button: {
              text: '已提交',
              key: 'survey_submitted',
              disable: true // 禁用提交按钮
          }
      };

      // 检查是否有选项被选中，并设置选中状态
      if (cardEvent.selected_items && cardEvent.selected_items.selected_item && cardEvent.selected_items.selected_item.length > 0) {
          const selections = cardEvent.selected_items.selected_item;
          const selectedOptionIds = selections[0].option_ids.option_id;
          
          // 更新选项列表中的选中状态
          updatedCard.checkbox.option_list.forEach(option => {
              if (selectedOptionIds.includes(option.id)) {
                  option.is_checked = true;
              }
          });

          const choices = selections.map(item => {
              return item.option_ids.option_id.join(', ');
          }).join('; ');
          
          // 即使是更新卡片，我们也通过 createTextResponse 返回一个响应，
          // 但实际上企业微信要求的是 update_template_card 类型的响应。
          // 这里我们需要一个新的响应构造函数或者修改现有的。
          // 根据文档，更新卡片需要返回 response_type: "update_template_card"
          
          return {
              msgtype: 'template_card', // 注意：被动回复更新卡片时，msgtype 仍需设为 template_card 或根据文档特定结构
              // 实际上，文档说被动回复更新卡片如下：
              // {
              //    "response_type": "update_template_card",
              //    "template_card": { ... }
              // }
              // 但是我们目前的 createTemplateCardResponse 只返回 { msgtype: 'template_card', template_card: ... }
              // 我们需要手动构造这个响应
              response_type: 'update_template_card',
              template_card: updatedCard
          };
      }
      
      return ctx.createTextResponse('收到您的反馈！');
  }

  // 处理多项选择卡片
  if (cardEvent.card_type === 'multiple_interaction') {
      // 构造更新卡片的响应
      const updatedCard = {
          card_type: 'multiple_interaction',
          source: {
            desc: '会议室预定'
          },
          main_title: {
              title: '研发周会会议室预定',
              desc: '预定已确认'
          },
          task_id: cardEvent.task_id,
          select_list: [
              {
                  question_key: 'meeting_date',
                  title: '选择日期',
                  selected_id: '',
                  disable: true,
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
                  disable: true,
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
                  disable: true,
                  option_list: [
                      { id: 'eq_projector', text: '投影仪' },
                      { id: 'eq_whiteboard', text: '白板' },
                      { id: 'eq_video', text: '视频会议系统' }
                  ]
              }
          ],
          submit_button: {
              text: '已预定',
              key: 'reserve_submitted',
              disable: true
          }
      };

      // 检查是否有选项被选中，并设置选中状态
      if (cardEvent.selected_items && cardEvent.selected_items.selected_item && cardEvent.selected_items.selected_item.length > 0) {
          const selections = cardEvent.selected_items.selected_item;
          
          // 更新选择列表中的选中状态
          selections.forEach(selection => {
              const selectListIndex = updatedCard.select_list.findIndex(list => list.question_key === selection.question_key);
              if (selectListIndex !== -1) {
                  updatedCard.select_list[selectListIndex].selected_id = selection.option_ids.option_id[0];
              }
          });

          return {
              response_type: 'update_template_card',
              template_card: updatedCard
          };
      }
      return ctx.createTextResponse('收到您的提交！');
  }

  // 根据 task_id 或 event_key 处理不同的业务逻辑
  if (cardEvent.task_id && cardEvent.task_id.startsWith('welcome_')) {
      return ctx.createTextResponse('收到您的反馈，我会继续努力！');
  }
  
  // 按钮点击事件处理
  if (cardEvent.card_type === 'button_interaction') {
      return ctx.createTextResponse(`您点击了按钮：${cardEvent.event_key || '未知按钮'}`);
  }

  // 默认响应，避免无响应情况
  return ctx.createTextResponse('操作已收到');
};

export const handleEvent = async (ctx, messageData) => {
  const { event } = messageData;
  const eventType = event.eventtype;
  
  console.log(`[Event Received] Type: ${eventType}`);

  switch (eventType) {
    case 'enter_chat':
      return handleEnterChatEvent(ctx, messageData);
    case 'template_card_event':
      return handleTemplateCardEvent(ctx, messageData);
    default:
      console.log(`[Event Ignored] Unknown event type: ${eventType}`);
      // 对于未知事件，最好也返回一个空响应或特定提示，防止企业微信报错
      return null; 
  }
};
