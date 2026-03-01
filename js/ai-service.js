// ===== AI 服务（nano Banana 系列）=====
// 通过后端 API 路由代理请求，API Key 安全存放在服务端
// 支持两个模型：
//   - nano Banana（快速生成）
//   - nano Banana Pro（高质量输出）

export class AIService {
    constructor() {
        // API Key 现在由后端管理，前端仅需要后端地址
        // 若后端不可用，则回退到直接调用（需要填入 apiKey）
        this.apiKey = '';  // 留空表示使用后端代理模式

        // 后端生图 API 路由地址
        this.backendURL = '/api/generate';

        // 可用模型配置（Nano Banana 系列 = Gemini 图像生成模型）
        this.models = {
            'nano-banana': {
                id: 'gemini-2.5-flash-preview-native-audio-dialog',
                name: 'nano Banana',
                description: '快速生成 · 创意丰富',
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-native-audio-dialog:generateContent',
                supportsSourceImage: true,
                supportsReferenceImages: true,
            },
            'nano-banana-pro': {
                id: 'gemini-2.5-pro-preview-06-05',
                name: 'nano Banana Pro',
                description: '高质量 · 细节精准',
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-06-05:generateContent',
                supportsSourceImage: true,
                supportsReferenceImages: true,
            }
        };

        // 当前选中模型
        this.currentModel = 'nano-banana';

        // 图像数据
        this.sourceImage = null;          // 画布快照
        this.referenceImages = [null, null, null]; // 最多 3 张参考图

        console.log('✅ AI 服务已初始化（后端代理模式）');
    }

    // ===== 模型管理 =====
    setModel(modelKey) {
        if (this.models[modelKey]) {
            this.currentModel = modelKey;
            console.log(`🔄 切换模型: ${this.models[modelKey].name} (${this.models[modelKey].id})`);
        } else {
            console.warn(`⚠️ 未知模型: ${modelKey}`);
        }
    }

    getCurrentModel() {
        return this.models[this.currentModel];
    }

    // ===== 图像管理 =====
    setSourceImage(dataURL) { this.sourceImage = dataURL; }
    clearSourceImage() { this.sourceImage = null; }

    addReferenceImage(index, dataURL) {
        if (index >= 0 && index < 3) this.referenceImages[index] = dataURL;
    }

    removeReferenceImage(index) {
        if (index >= 0 && index < 3) this.referenceImages[index] = null;
    }

    // ===== 主生成入口 =====
    async generateImage({ mainPrompt, generationRules, referencePrompts }) {
        const model = this.models[this.currentModel];
        console.log(`🤖 开始 AI 生成，模型: ${model.name}`);

        let promptText = `请根据以下要求生成或重绘图像。\n[主要描述] ${mainPrompt}`;

        if (generationRules && generationRules.trim()) {
            promptText += `\n[生成规则] ${generationRules.trim()}`;
        }

        try {
            // 优先使用后端代理模式
            return await this._callBackendAPI(promptText, referencePrompts, model);
        } catch (backendError) {
            console.warn('⚠️ 后端代理失败，尝试直接调用:', backendError.message);

            if (this.apiKey && this.apiKey.trim() !== '') {
                try {
                    return await this._callDirectAPI(promptText, referencePrompts, model);
                } catch (directError) {
                    console.error('❌ 直接调用也失败:', directError);
                    throw directError;
                }
            }

            throw backendError;
        }
    }

    // ===== 通过后端 API 代理调用 =====
    async _callBackendAPI(promptText, referencePrompts, model) {
        console.log(`📡 通过后端代理发送请求，模型: ${model.id}...`);

        const requestBody = {
            prompt: promptText,
            sourceImage: model.supportsSourceImage ? this.sourceImage : null,
            referenceImages: model.supportsReferenceImages ? this.referenceImages.filter(img => img !== null) : [],
            referencePrompts: referencePrompts || [],
            model: this.currentModel
        };

        const response = await fetch(this.backendURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || `后端 API 错误: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.imageURL) throw new Error('后端未返回图像数据');

        return { imageURL: data.imageURL, prompt: promptText, model: model.name };
    }

    // ===== 直接调用 Gemini API（回退模式）=====
    async _callDirectAPI(promptText, referencePrompts, model) {
        console.log(`📡 直接调用 ${model.id}...`);

        const parts = [{ text: promptText }];

        if (model.supportsSourceImage && this.sourceImage) {
            parts.push({ inline_data: { mime_type: 'image/png', data: this.sourceImage.split(',')[1] } });
            parts.push({ text: "以上是当前的画布草图，请基于此进行创作。" });
        }

        if (model.supportsReferenceImages) {
            this.referenceImages.forEach((img, i) => {
                if (img) {
                    parts.push({ inline_data: { mime_type: 'image/png', data: img.split(',')[1] } });
                    const refDesc = referencePrompts && referencePrompts[i] ? referencePrompts[i] : `参考图 ${i + 1}`;
                    parts.push({ text: `参考此图像的风格或内容：${refDesc}` });
                }
            });
        }

        parts.push({ text: "请直接生成并输出符合以上要求的图像。" });

        const body = {
            contents: [{ parts }],
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ],
            generationConfig: {
                responseModalities: ['IMAGE', 'TEXT'],
                maxOutputTokens: 4096,
                temperature: 0.7,
            }
        };

        const response = await fetch(`${model.endpoint}?key=${this.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(`Gemini API 错误: ${errData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const imageURL = this._extractImageURL(data);
        return { imageURL, prompt: promptText, model: model.name };
    }

    _extractImageURL(data) {
        console.log('📦 正在解析 API 响应数据:', data);

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
            console.warn('⚠️ 模型未返回图像，返回了文本描述:', text);
            throw new Error(`AI 未生成图像，AI 回复：${text}`);
        }

        if (data.predictions && data.predictions[0]?.bytesBase64Encoded) {
            return `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`;
        }

        throw new Error('无法从 API 响应中提取图像。');
    }

    // ===== 演示模式（API 未配置时使用）=====
    async demoGenerate(prompt) {
        return new Promise((resolve) => {
            setTimeout(() => {
                const canvas = document.createElement('canvas');
                canvas.width = 512;
                canvas.height = 512;
                const ctx = canvas.getContext('2d');

                const grad = ctx.createLinearGradient(0, 0, 512, 512);
                grad.addColorStop(0, '#1a0533');
                grad.addColorStop(0.5, '#2d1258');
                grad.addColorStop(1, '#0a2060');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, 512, 512);

                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                for (let i = 0; i < 60; i++) {
                    const x = Math.random() * 512;
                    const y = Math.random() * 512;
                    const r = Math.random() * 1.5 + 0.3;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.fill();
                }

                ctx.textAlign = 'center';
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = 'bold 22px Inter, sans-serif';
                ctx.fillText('🍌 nano Banana', 256, 220);
                ctx.font = '13px Inter, sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.fillText('（API 未配置 · 演示模式）', 256, 260);
                ctx.fillStyle = 'rgba(160,130,220,0.7)';
                ctx.font = '11px Inter, sans-serif';
                const short = prompt.length > 50 ? prompt.substring(0, 50) + '…' : prompt;
                ctx.fillText(short, 256, 300);

                resolve({ imageURL: canvas.toDataURL('image/png'), prompt, model: 'nano Banana（演示）' });
            }, 1800);
        });
    }
}
