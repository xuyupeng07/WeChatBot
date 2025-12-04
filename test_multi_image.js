import MessageHandler from './messageHandler.js';

// Mock dependencies
const mockLogger = (level, msg, data) => {
    console.log(`[${level}] ${msg}`, data ? JSON.stringify(data) : '');
};

const mockAiClient = {
    buildFastGPTRequestData: (chatId, content, stream, attachments) => {
        return { chatId, content, stream, messages: [{ role: 'user', content: [{ type: 'text', text: content }, ...attachments.map(a => ({ type: 'image_url', image_url: { url: a.url } }))] }] };
    },
    buildAxiosConfig: () => ({}),
    handleStreamRequest: async (url, data, config, callback) => {
        console.log('AI Request Data:', JSON.stringify(data, null, 2));
        callback('AI Response', true);
        return 'AI Response';
    }
};

// Mock handlers to avoid real network calls
// Since we can't easily mock ES modules exports directly without a test runner or loader hooks in simple script,
// we will rely on the fact that MessageHandler uses imported functions. 
// However, we can't overwrite them easily.
// Instead, let's just instantiate MessageHandler and overwrite the method ON THE INSTANCE if possible?
// No, the methods are imported.

// Better approach for this quick test: 
// We can mock the `processAttachmentsAndCallAI` method on the handler instance since that's where we want to check the logic flow of COMBINING messages.
// Or better yet, we just let it run and fail at prepareImageAttachment (network error) but observe the LOGS to see if it tried to process 2 images.

const handler = new MessageHandler({ logger: mockLogger, aiClientImpl: mockAiClient });

// Override the method that calls imageHandler
handler.processAttachmentsAndCallAI = async (messageData, textContent, attachments, streamId) => {
    console.log('processAttachmentsAndCallAI called with:', {
        textContent,
        attachmentsCount: attachments.length,
        attachments: attachments
    });
    
    // Mock the downstream call to AI
    const preparedAttachments = attachments.map(a => ({ type: 'image', url: a.data.url }));
    const content = textContent || 'Multi image test';
    const requestData = mockAiClient.buildFastGPTRequestData('test_chat', content, true, preparedAttachments);
    mockAiClient.handleStreamRequest(null, requestData, {}, () => {}, 'req_id');
};

// Simulate receiving multiple images
const userId = 'test_user';
const msg1 = {
    msgid: '1001',
    msgtype: 'image',
    from: { userid: userId },
    image: { url: 'http://example.com/1.jpg' }
};

const msg2 = {
    msgid: '1002',
    msgtype: 'image',
    from: { userid: userId },
    image: { url: 'http://example.com/2.jpg' }
};

console.log('Sending Message 1...');
handler.handleMessage(msg1);

setTimeout(() => {
    console.log('Sending Message 2...');
    handler.handleMessage(msg2);
}, 500);

// Wait for buffer processing
setTimeout(() => {
    console.log('Test finished');
}, 3000);
