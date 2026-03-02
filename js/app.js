// ===== 应用主控制器 =====
// 负责：
// 1. 开始屏流程（上传图片 / 空白画布 → 预设尺寸 → 创建）
// 2. 画布工具栏事件绑定
// 3. AI 面板事件绑定
// 4. 全局快捷键

import { CanvasManager } from './canvas-manager.js';
import { AIService } from './ai-service.js';

class App {
    constructor() {
        this.canvasManager = new CanvasManager('mainCanvas', 'perspectiveCanvas');
        this.aiService = new AIService();

        // 当前选中的预设
        this._selectedPreset = { w: 1080, h: 1080, name: '正方形' };
        this._selectedBg = 'white';

        this._initStartScreen();
        this._initKeyboard();
    }

    // ================================================================
    // 开始屏
    // ================================================================
    _initStartScreen() {
        // 上传图片开始
        const uploadCard = document.getElementById('uploadStartCard');
        const uploadInput = document.getElementById('uploadStartInput');
        uploadCard.addEventListener('click', () => uploadInput.click());
        uploadInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => this._startFromImage(ev.target.result);
            reader.readAsDataURL(file);
        });

        // 空白画布 → 显示预设区
        document.getElementById('blankCanvasCard').addEventListener('click', () => this._showPresets());
        document.getElementById('backToStartBtn').addEventListener('click', () => this._hidePresets());

        // 预设卡片点击
        document.querySelectorAll('.preset-card').forEach(card => {
            card.addEventListener('click', () => {
                if (card.id === 'customPresetCard') {
                    this._toggleCustomInputs();
                    return;
                }
                document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this._selectedPreset = { w: parseInt(card.dataset.w), h: parseInt(card.dataset.h), name: card.dataset.name };
                document.getElementById('customInputs').style.display = 'none';
            });
        });

        // 自定义输入更新预设
        document.getElementById('customWidth').addEventListener('input', () => this._updateCustomPreset());
        document.getElementById('customHeight').addEventListener('input', () => this._updateCustomPreset());

        // 背景选择
        document.querySelectorAll('.bg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._selectedBg = btn.dataset.bg;
            });
        });

        // 创建画布按钮
        document.getElementById('createCanvasBtn').addEventListener('click', () => this._createCanvas());
    }

    _showPresets() {
        document.querySelector('.start-actions').style.display = 'none';
        document.getElementById('canvasPresetArea').style.display = 'block';
    }

    _hidePresets() {
        document.getElementById('canvasPresetArea').style.display = 'none';
        document.querySelector('.start-actions').style.display = 'flex';
    }

    _toggleCustomInputs() {
        const inputs = document.getElementById('customInputs');
        const visible = inputs.style.display !== 'none';
        inputs.style.display = visible ? 'none' : 'block';
        if (!visible) {
            document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
            document.getElementById('customPresetCard').classList.add('selected');
            this._updateCustomPreset();
        }
    }

    _updateCustomPreset() {
        const w = parseInt(document.getElementById('customWidth').value) || 1024;
        const h = parseInt(document.getElementById('customHeight').value) || 1024;
        this._selectedPreset = { w, h, name: '自定义' };
    }

    _createCanvas() {
        const { w, h, name } = this._selectedPreset;
        const bg = this._selectedBg === 'transparent' ? 'transparent' : '#ffffff';
        this.canvasManager.initCanvas(w, h, bg);
        this._showApp();
        document.getElementById('canvasInfo').textContent = `${w} × ${h} px`;
        document.getElementById('canvasSizeStatus').textContent = `画布: ${w} × ${h} px`;
        this.showToast(`✅ 已创建 ${name} 画布 (${w} × ${h} px)`);
        this._initMainApp();
    }

    _startFromImage(imgDataURL) {
        this._showApp();
        this.canvasManager.initFromImage(imgDataURL).then(({ width, height }) => {
            this.showToast(`✅ 已打开图片 (${width} × ${height} px)`);
        });
        this._initMainApp();
    }

    _showApp() {
        document.getElementById('startOverlay').style.display = 'none';
        document.getElementById('appContainer').style.display = 'flex';
        this._initToolbar();
        this._initAIPanel();
    }

    // ================================================================
    // 工具栏
    // ================================================================
    _initToolbar() {
        if (this._toolbarBound) return;
        this._toolbarBound = true;

        // 画笔工具
        document.getElementById('brushTool').addEventListener('click', () => {
            this.canvasManager.setTool('brush');
            this._activateTool('brushTool');
        });

        // 橡皮擦
        document.getElementById('eraserTool').addEventListener('click', () => {
            this.canvasManager.setTool('eraser');
            this._activateTool('eraserTool');
        });

        // 透视辅助
        document.getElementById('perspectiveTool').addEventListener('click', (e) => {
            const panel = document.getElementById('perspectivePanel');
            panel.classList.toggle('visible');
            e.stopPropagation();
        });

        // 点击其他地方关闭透视面板
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('perspectivePanel');
            if (!panel.contains(e.target) && e.target.id !== 'perspectiveTool') panel.classList.remove('visible');
        });

        // 透视类型选择
        document.querySelectorAll('.persp-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                this.canvasManager.setPerspectiveType(type);
                document.querySelectorAll('.persp-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('perspectivePanel').classList.remove('visible');
                const perspBtn = document.getElementById('perspectiveTool');
                if (type === 'none') perspBtn.classList.remove('active');
                else perspBtn.classList.add('active');
            });
        });

        // 颜色选择器
        const colorPicker = document.getElementById('colorPicker');
        const colorDisplay = document.getElementById('colorDisplay');
        colorPicker.addEventListener('input', (e) => {
            colorDisplay.style.backgroundColor = e.target.value;
            this.canvasManager.setBrushColor(e.target.value);
        });

        // 画笔大小
        const brushSize = document.getElementById('brushSize');
        const brushSizeVal = document.getElementById('brushSizeValue');
        brushSize.addEventListener('input', (e) => {
            brushSizeVal.textContent = e.target.value;
            this.canvasManager.setBrushSize(parseInt(e.target.value));
        });

        // 不透明度
        const opacity = document.getElementById('brushOpacity');
        const opacityVal = document.getElementById('brushOpacityValue');
        opacity.addEventListener('input', (e) => {
            opacityVal.textContent = e.target.value + '%';
            this.canvasManager.setBrushOpacity(parseInt(e.target.value) / 100);
        });

        // 撤销 / 重做
        document.getElementById('undoBtn').addEventListener('click', () => this.canvasManager.undo());
        document.getElementById('redoBtn').addEventListener('click', () => this.canvasManager.redo());

        // 新建画布
        document.getElementById('newCanvasBtn').addEventListener('click', () => this._returnToStart());

        // 导出
        document.getElementById('exportBtn').addEventListener('click', () => this._exportImage());

        // 缩放控制
        document.getElementById('zoomIn').addEventListener('click', () => this.canvasManager.zoom(1.25));
        document.getElementById('zoomOut').addEventListener('click', () => this.canvasManager.zoom(0.8));
        document.getElementById('zoomReset').addEventListener('click', () => this.canvasManager.resetZoom());

        // AI 面板收起/展开
        document.getElementById('aiPanelToggle').addEventListener('click', () => {
            const workspace = document.getElementById('workspace');
            const collapsed = workspace.classList.toggle('ai-collapsed');
            const arrow = document.getElementById('toggleArrow');
            arrow.setAttribute('points', collapsed ? '6 12 10 8 6 4' : '10 12 6 8 10 4');
        });
    }

    _activateTool(toolId) {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(toolId).classList.add('active');
    }

    _returnToStart() {
        document.getElementById('canvasPresetArea').style.display = 'none';
        document.querySelector('.start-actions').style.display = 'flex';
        document.getElementById('appContainer').style.display = 'none';
        document.getElementById('startOverlay').style.display = 'flex';
    }

    _exportImage() {
        const dataURL = this.canvasManager.export('png');
        const link = document.createElement('a');
        link.download = `pingting-create-${Date.now()}.png`;
        link.href = dataURL;
        link.click();
        this.showToast('✅ 图像已导出');
    }

    // ================================================================
    // AI 面板
    // ================================================================
    _initAIPanel() {
        if (this._aiPanelBound) return;
        this._aiPanelBound = true;

        // 模型选择
        document.querySelectorAll('.model-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                this.aiService.setModel(card.dataset.model);
            });
        });

        // 使用画布按钮
        document.getElementById('useCanvasBtn').addEventListener('click', () => {
            const snapshot = this.canvasManager.getCanvasDataURL();
            if (!snapshot) { this.showToast('❌ 画布尚未初始化', 'error'); return; }
            this.aiService.setSourceImage(snapshot);
            const btn = document.getElementById('useCanvasBtn');
            btn.classList.add('active');
            this.showToast('✅ 已使用画布作为参考');
            setTimeout(() => btn.classList.remove('active'), 2000);
        });

        // 高级选项折叠
        const rulesToggle = document.getElementById('rulesToggle');
        const rulesContent = document.getElementById('rulesContent');
        rulesToggle.addEventListener('click', () => {
            const open = rulesContent.style.display !== 'none';
            rulesContent.style.display = open ? 'none' : 'block';
            rulesToggle.classList.toggle('open', !open);
        });

        // 参考图上传
        document.querySelectorAll('.ref-upload-area').forEach((area, index) => {
            const input = area.querySelector('.ref-input');
            input.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.aiService.addReferenceImage(index, ev.target.result);
                    this._showRefPreview(area, index, ev.target.result);
                };
                reader.readAsDataURL(file);
            });
        });

        // 生成按钮
        document.getElementById('generateBtn').addEventListener('click', () => this._handleGenerate());

        // 应用结果到画布
        document.getElementById('applyToCanvasBtn').addEventListener('click', () => {
            const imgSrc = document.getElementById('resultImage').src;
            if (!imgSrc) return;
            this.canvasManager.loadFromImage(imgSrc).then(() => this.showToast('✅ 已将结果应用到画布'));
        });

        // 保存结果
        document.getElementById('saveResultBtn').addEventListener('click', () => {
            const imgSrc = document.getElementById('resultImage').src;
            if (!imgSrc) return;
            const link = document.createElement('a');
            link.download = `ai-result-${Date.now()}.png`;
            link.href = imgSrc;
            link.click();
            this.showToast('✅ 图像已保存');
        });
    }

    _initMainApp() {
        document.getElementById('statusText').textContent = '就绪';
    }

    _showRefPreview(area, index, imgData) {
        area.classList.add('has-image');
        area.innerHTML = `
            <img src="${imgData}" class="ref-preview" alt="参考图 ${index + 1}">
            <button class="ref-remove" onclick="window.app._removeRef(${index}, this.closest('.ref-upload-area'))">×</button>
        `;
        const descs = document.querySelectorAll('.ref-desc');
        if (descs[index]) descs[index].disabled = false;
    }

    _removeRef(index, area) {
        this.aiService.removeReferenceImage(index);
        area.classList.remove('has-image');
        area.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>参考图 ${index + 1}</span>
            <input type="file" accept="image/*" class="ref-input">
        `;
        const input = area.querySelector('.ref-input');
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                this.aiService.addReferenceImage(index, ev.target.result);
                this._showRefPreview(area, index, ev.target.result);
            };
            reader.readAsDataURL(file);
        });
        const descs = document.querySelectorAll('.ref-desc');
        if (descs[index]) { descs[index].disabled = true; descs[index].value = ''; }
    }

    async _handleGenerate() {
        const mainPrompt = document.getElementById('mainPrompt').value.trim();
        if (!mainPrompt) { this.showToast('❌ 请先输入描述提示词', 'error'); return; }

        const generationRules = document.getElementById('generationRules').value.trim();
        const refDescs = document.querySelectorAll('.ref-desc');
        const referencePrompts = Array.from(refDescs).map(d => d.value.trim());

        // 自动截取画布快照作为输入
        const snapshot = this.canvasManager.getCanvasDataURL();
        if (snapshot) {
            this.aiService.setSourceImage(snapshot);
            console.log('📸 已自动截取画布快照作为输入');
        }

        this._setGenerating(true);
        document.getElementById('resultArea').style.display = 'none';
        document.getElementById('statusText').textContent = 'AI 生成中...';

        try {
            const result = await this.aiService.generateImage({ mainPrompt, generationRules, referencePrompts });

            // 在 AI 面板中显示结果预览
            document.getElementById('resultImage').src = result.imageURL;
            document.getElementById('resultModel').textContent = result.model;
            document.getElementById('resultArea').style.display = 'block';

            // 自动将生成结果应用到画布
            await this.canvasManager.loadFromImage(result.imageURL);
            console.log('🖼️ 生成结果已自动应用到画布');

            document.getElementById('statusText').textContent = '生成完成 · 已应用到画布';
            this.showToast(`✅ ${result.model} 生成完成，已自动应用到画布`);

        } catch (err) {
            console.error('AI 生成失败:', err);
            this.showToast('❌ 生成失败: ' + err.message, 'error');
            document.getElementById('statusText').textContent = '生成失败';
        } finally {
            this._setGenerating(false);
        }
    }

    _setGenerating(loading) {
        document.getElementById('loadingState').style.display = loading ? 'flex' : 'none';
        document.getElementById('generateBtn').disabled = loading;
    }

    // ================================================================
    // 键盘快捷键
    // ================================================================
    _initKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.target.matches('input, textarea, select')) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.canvasManager.undo(); }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); this.canvasManager.redo(); }
            if (e.key === 'b' || e.key === 'B') { this.canvasManager.setTool('brush'); this._activateTool('brushTool'); }
            if (e.key === 'e' || e.key === 'E') { this.canvasManager.setTool('eraser'); this._activateTool('eraserTool'); }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); this._exportImage(); }
        });
    }

    // ================================================================
    // Toast 通知
    // ================================================================
    showToast(message, type = 'success') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('toast-hide');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// 挂载全局实例
window.app = new App();
