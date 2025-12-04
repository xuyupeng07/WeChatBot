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


/**
 * 从响应头解析文件名
 * @param {object} headers HTTP响应头
 * @returns {string|null} 解析出的文件名
 */
const extractFilenameFromHeaders = (headers) => {
    const contentDisposition = headers['content-disposition'] || '';
    const xCosMetaAttr = headers['x-cos-meta-attr'] || '';
    let fileName = null;

    // 1. 优先尝试从 x-cos-meta-attr 中解析文件名（腾讯云 COS 特有）
    if (xCosMetaAttr) {
        try {
            const decodedBuffer = Buffer.from(xCosMetaAttr, 'base64');
            
            // Protobuf 解析逻辑
            let offset = 0;
            while (offset < decodedBuffer.length) {
                const tag = decodedBuffer[offset];
                const fieldNumber = tag >> 3;
                const wireType = tag & 0x07;
                offset++;
                
                if (wireType === 2) { // Length-delimited
                    let length = 0;
                    let shift = 0;
                    while (true) {
                        if (offset >= decodedBuffer.length) break;
                        const byte = decodedBuffer[offset];
                        length |= (byte & 0x7f) << shift;
                        offset++;
                        shift += 7;
                        if ((byte & 0x80) === 0) break;
                    }
                    
                    if (fieldNumber === 1) { // Field 1 是文件名
                        if (offset + length <= decodedBuffer.length) {
                            fileName = decodedBuffer.slice(offset, offset + length).toString('utf8');
                        }
                        // 继续解析以防万一
                    } 
                    offset += length;
                } else if (wireType === 0) { // Varint
                    while (true) {
                        if (offset >= decodedBuffer.length) break;
                        const byte = decodedBuffer[offset];
                        offset++;
                        if ((byte & 0x80) === 0) break;
                    }
                } else if (wireType === 5) { // 32-bit
                    offset += 4;
                } else if (wireType === 1) { // 64-bit
                    offset += 8;
                } else {
                    break; 
                }
            }
            
            // 如果 protobuf 解析失败，尝试正则匹配
            if (!fileName) {
                 const rawStr = decodedBuffer.toString('utf8');
                 const match = rawStr.match(/[\u4e00-\u9fa5a-zA-Z0-9_\-\s]+\.[a-zA-Z0-9]+/);
                 if (match) fileName = match[0];
            }
        } catch (e) {
            log('warn', 'Failed to parse x-cos-meta-attr', { error: e.message });
        }
    }
    
    // 2. 尝试从 Content-Disposition 中提取
    if (!fileName && contentDisposition) {
        const matchUtf8 = contentDisposition.match(/filename\*=utf-8''([^;]+)/i);
        if (matchUtf8 && matchUtf8[1]) {
            fileName = decodeURIComponent(matchUtf8[1]);
        } else {
            const match = contentDisposition.match(/filename=["']?([^"';]+)["']?/i);
            if (match && match[1]) {
                try {
                    fileName = decodeURIComponent(match[1]);
                } catch (e) {
                    fileName = match[1];
                }
            }
        }
    }

    return fileName;
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
        
        // 尝试从Header提取文件名
        const extractedName = extractFilenameFromHeaders(response.headers);
        let fileName = extractedName;

        if (!fileName) {
             fileName = `${crypto.randomUUID()}.${ext}`;
        } else {
            // 确保后缀名正确
            const extractedExt = path.extname(fileName).replace('.', '');
            if (!extractedExt || extractedExt !== ext) {
                // 如果提取的文件名后缀与检测到的类型不符，或者没有后缀，使用检测到的后缀
                // 这里保留原文件名主体，只修正后缀? 或者直接追加?
                // 简单策略：如果原文件名没后缀，追加。如果有，信任原文件名(可能有特例)，或者强行修正
                // 为了安全，如果检测出是图片，最好确保后缀也是图片格式
                if (!path.extname(fileName)) {
                    fileName = `${fileName}.${ext}`;
                }
            }
        }
        
        // 确保文件名安全
        fileName = fileName.replace(/[\/\\]/g, '_');
        
        const filePath = path.join(publicDir, fileName);
        fs.writeFileSync(filePath, outputBuffer);

        return filePath;
    } catch (error) {
        log('error', 'Failed to download and save image', { error: error.message });
        throw error;
    }
};

/**
 * 下载文件并保存到本地 public 目录 (处理加密)
 * @param {string} fileUrl 
 * @param {string} [originalFileName] 原始文件名（可选）
 * @returns {Promise<string>} 本地文件路径
 */
export const downloadAndSaveFile = async (fileUrl, originalFileName) => {
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
        const extractedName = extractFilenameFromHeaders(response.headers);
        let fileName = extractedName;

        if (originalFileName && !fileName) {
            fileName = originalFileName;
        } else if (!fileName) {
             // 如果无法解析文件名，使用随机名 + .txt 后缀（因为我们已经删除了 detectFileExt 这种不可靠的推断）
            fileName = `${crypto.randomUUID()}.txt`;
        }
        
        // 确保文件名安全
        fileName = fileName.replace(/[\/\\]/g, '_');
        
        // 如果没有后缀，尝试从 originalFileName 补全，或者默认 .txt
        if (!path.extname(fileName)) {
             if (originalFileName && path.extname(originalFileName)) {
                 fileName = `${fileName}${path.extname(originalFileName)}`;
             } else {
                 fileName = `${fileName}.txt`;
             }
        }
        
        const filePath = path.join(publicDir, fileName);
        fs.writeFileSync(filePath, outputBuffer);

        return filePath;
    } catch (error) {
        log('error', 'Failed to download and save file', { error: error.message });
        throw error;
    }
};
