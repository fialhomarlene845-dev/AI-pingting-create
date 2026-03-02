// ===== AI 生图后端路由 =====
// 接收前端画布快照 + 提示词 + 参考图，转发给 Gemini API 进行图像生成
// API Key 安全存放在服务端环境变量中

export async function POST(req) {
    try {
        const {
            prompt,           // 完整提示词文本
            sourceImage,      // 画布快照 (base64 data URL)
            referenceImages,  // 参考图数组 (base64 data URL[])
            referencePrompts, // 参考图描述数组
            model             // 模型标识: 'nano-banana' | 'nano-banana-pro'
        } = await req.json();

        // 从环境变量读取 API Key
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({
                error: '请在 .env.local 中配置 GEMINI_API_KEY'
            }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        // 模型配置映射
        const modelConfig = {
            'nano-banana': {
                id: 'gemini-2.5-flash-preview-native-audio-dialog',
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-native-audio-dialog:generateContent',
            },
            'nano-banana-pro': {
                id: 'gemini-2.5-pro-preview-06-05',
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-06-05:generateContent',
            }
        };

        const selectedModel = modelConfig[model] || modelConfig['nano-banana'];

        // 构建 Gemini 请求体
        const parts = [{ text: prompt }];

        // 附加画布快照（源图像）
        if (sourceImage) {
            const base64Data = sourceImage.split(',')[1];
            if (base64Data) {
                parts.push({ inline_data: { mime_type: 'image/png', data: base64Data } });
                parts.push({ text: '以上是当前的画布草图，请基于此进行创作。' });
            }
        }

        // 附加参考图及其描述
        if (referenceImages && referenceImages.length > 0) {
            referenceImages.forEach((img, i) => {
                if (img) {
                    const base64Data = img.split(',')[1];
                    if (base64Data) {
                        parts.push({ inline_data: { mime_type: 'image/png', data: base64Data } });
                        const refDesc = referencePrompts && referencePrompts[i] ? referencePrompts[i] : `参考图 ${i + 1}`;
                        parts.push({ text: `参考此图像的风格或内容：${refDesc}` });
                    }
                }
            });
        }

        // 要求输出图像
        parts.push({ text: '请直接生成并输出符合以上要求的图像。' });

        const body = {
            contents: [{ parts }],
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ],
            generationConfig: {
                responseModalities: ['IMAGE', 'TEXT'],
                maxOutputTokens: 4096,
                temperature: 0.7,
            }
        };

        console.log(`📡 后端转发请求至 ${selectedModel.id}...`);

        const response = await fetch(`${selectedModel.endpoint}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(`Gemini API 错误: ${errData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const imageURL = extractImageURL(data);

        return new Response(JSON.stringify({ imageURL, model: selectedModel.id }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('AI 生图后端错误:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

/**
 * 从 Gemini API 响应数据中提取图像 URL
 */
function extractImageURL(data) {
    if (data.image_base64) return `data:image/png;base64,${data.image_base64}`;
    if (data.image_url) return data.image_url;

    const candidates = data.candidates || [];
    for (const c of candidates) {
        const parts = c.content?.parts || [];
        for (const part of parts) {
            if (part.inline_data?.mime_type?.startsWith('image/')) {
                console.log('🎨 成功从 inline_data 提取图像');
                return `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`;
            }
        }
    }

    if (candidates[0]?.content?.parts?.[0]?.text) {
        const text = candidates[0].content.parts[0].text;
        console.warn('⚠️ 模型未返回图像，返回了文本:', text);
        throw new Error(`AI 未生成图像，模型回复：${text}`);
    }

    if (data.predictions && data.predictions[0]?.bytesBase64Encoded) {
        return `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`;
    }

    throw new Error('无法从 API 响应中提取图像');
}
