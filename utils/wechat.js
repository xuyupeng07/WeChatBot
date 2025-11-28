import axios from 'axios';
import { log } from './logger.js';

let accessToken = '';
let tokenExpirationTime = 0;

/**
 * 获取企业微信 Access Token
 * @returns {Promise<string>} Access Token
 */
export const getAccessToken = async () => {
    const now = Date.now();
    if (accessToken && now < tokenExpirationTime) {
        return accessToken;
    }

    const corpid = process.env.WECHAT_CORPID;
    const corpsecret = process.env.WECHAT_CORPSECRET;

    if (!corpid || !corpsecret) {
        log('error', 'WECHAT_CORPID or WECHAT_CORPSECRET not configured');
        throw new Error('Missing WeChat configuration');
    }

    try {
        const response = await axios.get(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpid}&corpsecret=${corpsecret}`);
        if (response.data.errcode === 0) {
            accessToken = response.data.access_token;
            // 提前 5 分钟过期，确保安全
            tokenExpirationTime = now + (response.data.expires_in - 300) * 1000;
            log('debug', 'WeChat Access Token refreshed');
            return accessToken;
        } else {
            log('error', 'Failed to get WeChat Access Token', response.data);
            throw new Error(`WeChat API Error: ${response.data.errmsg}`);
        }
    } catch (error) {
        log('error', 'Error getting WeChat Access Token', { error: error.message });
        throw error;
    }
};

/**
 * 直接下载图片并转换为 Base64
 * 尝试两种策略：
 * 1. 尝试直接下载（添加 User-Agent 等头）
 * 2. 如果失败，尝试作为临时素材下载（需要 Media ID，但通常图片回调只给 URL，所以此方法可能需要额外的 media_id）
 *    注意：企业微信回调的图片消息通常只包含 url，不包含 media_id。
 *    但是，回调的 URL 通常是受保护的，需要特定的 Header 或 Cookie，或者它是内网/特定签名的 URL。
 *    根据用户提供的 URL 样例，它带有很多签名参数。
 * 
 * 改进策略：
 * 用户提示使用 `axios.get(imageUrl, { headers: ... })` 方案。
 * 
 * @param {string} imageUrl 
 * @returns {Promise<string>} Base64 string
 */
export const downloadImageAsBase64 = async (imageUrl) => {
    try {
        // 尝试方案2：直接下载，带上模拟的浏览器 Header
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://work.weixin.qq.com/'
            },
            timeout: 10000
        });
        
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = response.headers['content-type'] || 'image/jpeg';
        return `data:${mimeType};base64,${base64}`;
    } catch (error) {
        log('warn', 'Direct image download failed, trying alternative if available', { error: error.message });
        throw new Error(`Failed to download image: ${error.message}`);
    }
};

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * 下载图片并保存到本地 public 目录
 * @param {string} imageUrl 
 * @returns {Promise<string>} 本地文件路径
 */
// 简单图片类型检测（基于魔数）
const detectImageExt = (buf) => {
    if (!buf || buf.length < 12) return 'jpg';
    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    const pngSig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (pngSig.every((v, i) => buf[i] === v)) return 'png';
    // GIF: GIF87a or GIF89a
    const gifSig = buf.slice(0, 6).toString('ascii');
    if (gifSig === 'GIF87a' || gifSig === 'GIF89a') return 'gif';
    // WEBP: RIFF....WEBP
    const riff = buf.slice(0, 4).toString('ascii');
    const webp = buf.slice(8, 12).toString('ascii');
    if (riff === 'RIFF' && webp === 'WEBP') return 'webp';
    return 'jpg';
};

export const downloadAndSaveImage = async (imageUrl) => {
    try {
        const publicDir = path.join(process.cwd(), 'public', 'images');
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
        }

        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://work.weixin.qq.com/',
                'Accept': 'image/*'
            },
            timeout: 20000,
        });

        const buffer = Buffer.from(response.data);
        const contentType = (response.headers['content-type'] || '').toLowerCase();
        let outputBuffer = buffer;
        const isImageHeader = (() => {
            if (!buffer || buffer.length < 12) return false;
            if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
            const pngSig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
            if (pngSig.every((v, i) => buffer[i] === v)) return true;
            const gifSig = buffer.slice(0, 6).toString('ascii');
            if (gifSig === 'GIF87a' || gifSig === 'GIF89a') return true;
            const riff = buffer.slice(0, 4).toString('ascii');
            const webp = buffer.slice(8, 12).toString('ascii');
            if (riff === 'RIFF' && webp === 'WEBP') return true;
            return false;
        })();
        if (!contentType.startsWith('image/') && !isImageHeader) {
            const aesKeyBase64 = process.env.WECHAT_AES_KEY;
            if (!aesKeyBase64) throw new Error('Missing WECHAT_AES_KEY');
            const aesKey = Buffer.from(aesKeyBase64 + '=', 'base64');
            const iv = aesKey.slice(0, 16);
            const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
            decipher.setAutoPadding(false);
            const decrypted = Buffer.concat([decipher.update(buffer), decipher.final()]);
            const padLen = decrypted[decrypted.length - 1];
            if (padLen < 1 || padLen > 32) throw new Error('Invalid PKCS7 padding');
            outputBuffer = decrypted.slice(0, decrypted.length - padLen);
        }
        const ext = detectImageExt(outputBuffer);
        const fileName = `${crypto.randomUUID()}.${ext}`;
        const filePath = path.join(publicDir, fileName);
        fs.writeFileSync(filePath, outputBuffer);

        return filePath;
    } catch (error) {
        log('error', 'Failed to download and save image', { error: error.message });
        throw error;
    }
};


import { fileTypeFromBuffer } from 'file-type';

/**
 * Check if buffer is text
 */
const isText = (buffer) => {
    // Check first 1000 bytes for null bytes
    const checkLen = Math.min(buffer.length, 1000);
    for (let i = 0; i < checkLen; i++) {
        if (buffer[i] === 0x00) return false;
    }
    return true;
};

/**
 * 简单文件扩展名推断
 */
const detectFileExt = async (buffer, contentType, url, contentDisposition) => {
    // 0. 优先从 Content-Disposition 获取文件名
    if (contentDisposition) {
        // 尝试匹配 filename="xxx" 或 filename=xxx
        const match = contentDisposition.match(/filename=["']?([^"';]+)["']?/);
        if (match && match[1]) {
            const ext = path.extname(match[1]).replace('.', '');
            if (ext) return ext;
        }
    }

    // 1. 尝试从 buffer 内容推断 (file-type 擅长二进制格式)
    try {
        const type = await fileTypeFromBuffer(buffer);
        if (type && type.ext) {
            return type.ext;
        }
    } catch (e) {
        // ignore error
    }

    // 2. 从 Content-Type 推断
    const mimeMap = {
        'application/pdf': 'pdf',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-powerpoint': 'ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'text/plain': 'txt',
        'text/markdown': 'md',
        'text/csv': 'csv',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'application/json': 'json',
        'application/xml': 'xml'
    };
    if (mimeMap[contentType]) return mimeMap[contentType];
    
    // 3. 从 URL 尝试
    try {
        const urlObj = new URL(url);
        const ext = path.extname(urlObj.pathname).replace('.', '');
        if (ext) return ext;
    } catch (e) {}

    // 4. 最后尝试检测是否为纯文本
    if (isText(buffer)) {
        return 'txt';
    }
    
    return 'bin';
};

/**
 * 下载文件并保存到本地 public 目录 (处理加密)
 * @param {string} fileUrl 
 * @returns {Promise<string>} 本地文件路径
 */
export const downloadAndSaveFile = async (fileUrl) => {
    try {
        const publicDir = path.join(process.cwd(), 'public', 'files');
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
        }

        const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://work.weixin.qq.com/'
            },
            timeout: 60000, // 文件下载可能需要更长时间
        });

        const buffer = Buffer.from(response.data);
        let outputBuffer = buffer;
        
        // 文件消息总是加密的（根据文档）
        // 加密方式：AES-256-CBC，数据采用PKCS#7填充
        // AESKey与回调加解密的AESKey相同
        // IV初始向量大小为16字节，取AESKey前16字节
        
        const aesKeyBase64 = process.env.WECHAT_AES_KEY;
        if (!aesKeyBase64) throw new Error('Missing WECHAT_AES_KEY');
        
        // 注意：WECHAT_AES_KEY 通常是 EncodingAESKey，Base64编码
        // 它的长度通常是43字符，解码后是32字节
        const aesKey = Buffer.from(aesKeyBase64 + '=', 'base64');
        const iv = aesKey.slice(0, 16);
        
        try {
            const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
            decipher.setAutoPadding(false); // 手动处理 padding
            
            const decrypted = Buffer.concat([decipher.update(buffer), decipher.final()]);
            
            // 去除 PKCS#7 Padding
            const padLen = decrypted[decrypted.length - 1];
            if (padLen < 1 || padLen > 32) {
                // 如果 padding 不合法，可能并未加密（虽然文档说加密了），或者密钥错误
                // 尝试直接使用原始数据，或者抛出警告
                 log('warn', 'Invalid PKCS7 padding for file, maybe not encrypted?', { padLen });
                 // 如果解密结果看起来不对，这里可能需要回退逻辑，但根据文档应该是加密的
                 // 这里我们假设如果 padding 错误，可能是解密参数不对，或者文件本身未加密
                 // 暂时抛出错误
                 throw new Error('Invalid PKCS7 padding');
            }
            outputBuffer = decrypted.slice(0, decrypted.length - padLen);
        } catch (decryptError) {
             log('error', 'Decryption failed', { error: decryptError.message });
             // 尝试直接使用原始数据作为回退（万一文件其实没加密）
             outputBuffer = buffer;
        }

        const contentType = (response.headers['content-type'] || '').toLowerCase();
        const contentDisposition = response.headers['content-disposition'] || '';
        const ext = await detectFileExt(outputBuffer, contentType, fileUrl, contentDisposition);
        const fileName = `${crypto.randomUUID()}.${ext}`;
        const filePath = path.join(publicDir, fileName);
        fs.writeFileSync(filePath, outputBuffer);

        return filePath;
    } catch (error) {
        log('error', 'Failed to download and save file', { error: error.message });
        throw error;
    }
};

/**
 * 获取图片流 (用于代理)
 * @param {string} imageUrl 
 * @returns {Promise<import('stream').Readable>}
 */
export const getImageStream = async (imageUrl) => {
    try {
        // 经过测试，腾讯云COS的图片链接可以直接下载，不需要特殊的 User-Agent 或 Referer
        // 实际上，带了错误的 Referer 反而可能导致问题，或者 User-Agent 限制
        // 最简单的方式通常最有效，但也保留基本的 User-Agent 模拟浏览器
        
        // 注意：必须设置 responseType: 'stream' 以便后续 pipe
        const response = await axios.get(imageUrl, {
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 20000
        });
        return response;
    } catch (error) {
        log('error', 'Failed to get image stream', { error: error.message });
        // 如果第一次失败，尝试完全不带 Header 重试
        if (error.response && error.response.status === 403) {
             try {
                log('warn', 'Retrying without headers');
                const response = await axios.get(imageUrl, {
                    responseType: 'stream',
                    timeout: 20000
                });
                return response;
            } catch (retryError) {
                throw retryError;
            }
        }
        throw error;
    }
};
