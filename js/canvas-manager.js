// ===== 画布管理器（优化版）=====
// 核心改进：
// 1. Pointer Events API 统一处理鼠标/触控板/触摸屏
// 2. 贝塞尔曲线平滑笔触（减少锇齿）
// 3. 动态笔触粗细（基于速度）
// 4. rAF 节流绘制
// 5. 支持自定义画布尺寸
// 6. 独立透视辅助层

export class CanvasManager {
    constructor(mainCanvasId, perspectiveCanvasId) {
        this.mainCanvas = document.getElementById(mainCanvasId);
        this.perspectiveCanvas = document.getElementById(perspectiveCanvasId);
        this.ctx = null;
        this.perspCtx = null;

        // 绘画状态
        this.isDrawing = false;
        this.isPanning = false;

        // 笔触参数
        this.brushColor = '#000000';
        this.brushSize = 5;
        this.brushOpacity = 1;
        this.currentTool = 'brush';
        this.canvasBg = '#ffffff';

        // 平滑相关
        this.points = [];        // 当前笔触路径点
        this._lastPressure = 1;  // 上次压感值

        // 历史记录（撤销/重做）
        this.history = [];
        this.historyStep = -1;
        this.maxHistory = 50;

        // 变换状态
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;

        // 页面坐标缓存
        this._canvasRect = null;
        this._rafPending = false;

        // 双指触摸跟踪
        this._lastTouchDist = 0;
        this._lastMidX = 0;
        this._lastMidY = 0;

        // 透视辅助
        this.perspectiveType = 'none';

        // 空间键（平移模式）
        this._spaceDown = false;

        this._bindEvents();
        console.log('✅ 画布管理器已初始化');
    }

    // ===== 初始化画布 =====
    initCanvas(width, height, bg = '#ffffff') {
        this.canvasBg = bg;
        this.mainCanvas.width = width;
        this.mainCanvas.height = height;
        this.perspectiveCanvas.width = width;
        this.perspectiveCanvas.height = height;
        this.ctx = this.mainCanvas.getContext('2d', { willReadFrequently: true });
        this.perspCtx = this.perspectiveCanvas.getContext('2d');
        this._fillBackground();
        this.saveState();
        this._centerCanvas();
        console.log(`✅ 画布初始化完成: ${width} × ${height}，背景: ${bg}`);
    }

    // ===== 从图片初始化画布 =====
    initFromImage(imgSrc) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const { width, height } = img;
                this.mainCanvas.width = width;
                this.mainCanvas.height = height;
                this.perspectiveCanvas.width = width;
                this.perspectiveCanvas.height = height;
                this.ctx = this.mainCanvas.getContext('2d', { willReadFrequently: true });
                this.perspCtx = this.perspectiveCanvas.getContext('2d');
                this.ctx.fillStyle = '#ffffff';
                this.ctx.fillRect(0, 0, width, height);
                this.ctx.drawImage(img, 0, 0);
                this.saveState();
                this._centerCanvas();
                this._updateCanvasInfo(width, height);
                console.log(`✅ 已从图片初始化画布: ${width} × ${height}`);
                resolve({ width, height });
            };
            img.onerror = reject;
            img.src = imgSrc;
        });
    }

    // ===== 填充背景 =====
    _fillBackground() {
        if (!this.ctx) return;
        if (this.canvasBg === 'transparent') {
            this.ctx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
        } else {
            this.ctx.fillStyle = this.canvasBg;
            this.ctx.fillRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
        }
    }

    // ===== 画布居中 =====
    _centerCanvas() {
        const container = this.mainCanvas.parentElement;
        const wrapper = container.parentElement;
        const wrapRect = wrapper.getBoundingClientRect();
        const canvasW = this.mainCanvas.width;
        const canvasH = this.mainCanvas.height;
        const fitScale = Math.min((wrapRect.width - 80) / canvasW, (wrapRect.height - 80) / canvasH, 1);
        this.scale = fitScale;
        this.translateX = 0;
        this.translateY = 0;
        this._applyTransform();
        this._updateZoomDisplay();
    }

    // ===== 绑定事件 =====
    _bindEvents() {
        const canvas = this.mainCanvas;
        canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e), { passive: false });
        canvas.addEventListener('pointermove', (e) => this._onPointerMove(e), { passive: false });
        canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
        canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e));
        canvas.addEventListener('pointerleave', (e) => { if (this.isDrawing) this._onPointerUp(e); });
        canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        canvas.addEventListener('touchend', () => { this._lastTouchDist = 0; });
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !e.target.matches('input, textarea')) {
                e.preventDefault();
                this._spaceDown = true;
                canvas.style.cursor = 'grab';
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this._spaceDown = false;
                canvas.style.cursor = 'crosshair';
            }
        });
    }

    // ===== Pointer 事件处理 =====
    _onPointerDown(e) {
        e.preventDefault();
        this.mainCanvas.setPointerCapture(e.pointerId);
        if (this._spaceDown || e.button === 1) {
            this.isPanning = true;
            this._panStartX = e.clientX;
            this._panStartY = e.clientY;
            this.mainCanvas.style.cursor = 'grabbing';
            return;
        }
        if (e.button !== 0) return;
        this.isDrawing = true;
        this._canvasRect = this.mainCanvas.getBoundingClientRect();
        const [x, y] = this._clientToCanvas(e.clientX, e.clientY);
        const pressure = e.pressure > 0 ? e.pressure : 1;
        this.points = [{ x, y, pressure }];
        this._lastPressure = pressure;
        this._applyBrushStyle(pressure);
        this.ctx.beginPath();
        this.ctx.arc(x, y, this.brushSize / 2 * Math.max(0.5, pressure), 0, Math.PI * 2);
        this.ctx.fill();
    }

    _onPointerMove(e) {
        e.preventDefault();
        if (this.isPanning) {
            const dx = e.clientX - this._panStartX;
            const dy = e.clientY - this._panStartY;
            this.translateX += dx;
            this.translateY += dy;
            this._panStartX = e.clientX;
            this._panStartY = e.clientY;
            this._applyTransform();
            return;
        }
        if (!this.isDrawing || !this._canvasRect) return;
        const [x, y] = this._clientToCanvas(e.clientX, e.clientY);
        const pressure = e.pressure > 0 ? e.pressure : 1;
        this.points.push({ x, y, pressure });
        if (!this._rafPending) {
            this._rafPending = true;
            requestAnimationFrame(() => { this._drawStroke(); this._rafPending = false; });
        }
    }

    _onPointerUp(e) {
        if (this.isPanning) {
            this.isPanning = false;
            this.mainCanvas.style.cursor = this._spaceDown ? 'grab' : 'crosshair';
            return;
        }
        if (this.isDrawing) {
            this.isDrawing = false;
            this.points = [];
            this.saveState();
        }
    }

    // ===== 核心笔触绘制（贝塞尔平滑）=====
    _drawStroke() {
        if (this.points.length < 2) return;
        const pts = this.points;
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        this._applyBrushStyle(last.pressure);
        this.ctx.beginPath();
        if (pts.length === 2) {
            this.ctx.moveTo(prev.x, prev.y);
            this.ctx.lineTo(last.x, last.y);
        } else {
            const prevPrev = pts[pts.length - 3];
            const mx = (prev.x + last.x) / 2;
            const my = (prev.y + last.y) / 2;
            this.ctx.moveTo((prevPrev.x + prev.x) / 2, (prevPrev.y + prev.y) / 2);
            this.ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        }
        this.ctx.stroke();
    }

    // ===== 应用画笔样式 =====
    _applyBrushStyle(pressure = 1) {
        if (!this.ctx) return;
        const dynamicSize = this.brushSize * Math.max(0.5, pressure);
        if (this.currentTool === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.strokeStyle = 'rgba(0,0,0,1)';
            this.ctx.fillStyle = 'rgba(0,0,0,1)';
            this.ctx.globalAlpha = 1;
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
            this.ctx.strokeStyle = this.brushColor;
            this.ctx.fillStyle = this.brushColor;
            this.ctx.globalAlpha = this.brushOpacity;
        }
        this.ctx.lineWidth = dynamicSize;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    // ===== 坐标转换（屏幕 → 画布）=====
    _clientToCanvas(clientX, clientY) {
        const rect = this._canvasRect || this.mainCanvas.getBoundingClientRect();
        return [(clientX - rect.left) / this.scale, (clientY - rect.top) / this.scale];
    }

    // ===== 触摸事件（双指缩放）=====
    _onTouchStart(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            this.isDrawing = false;
            const t1 = e.touches[0], t2 = e.touches[1];
            this._lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            this._lastMidX = (t1.clientX + t2.clientX) / 2;
            this._lastMidY = (t1.clientY + t2.clientY) / 2;
        }
    }

    _onTouchMove(e) {
        if (e.touches.length === 2 && this._lastTouchDist > 0) {
            e.preventDefault();
            const t1 = e.touches[0], t2 = e.touches[1];
            const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const midX = (t1.clientX + t2.clientX) / 2;
            const midY = (t1.clientY + t2.clientY) / 2;
            const factor = newDist / this._lastTouchDist;
            this._applyZoom(factor, midX, midY);
            this.translateX += midX - this._lastMidX;
            this.translateY += midY - this._lastMidY;
            this._lastTouchDist = newDist;
            this._lastMidX = midX;
            this._lastMidY = midY;
            this._applyTransform();
            this._updateZoomDisplay();
        }
    }

    // ===== 鼠标滚轮缩放 =====
    _onWheel(e) {
        e.preventDefault();
        const factor = Math.pow(1.1, -e.deltaY / 100);
        const rect = this.mainCanvas.getBoundingClientRect();
        this._applyZoom(factor, e.clientX - rect.left + rect.left, e.clientY);
        this._applyTransform();
        this._updateZoomDisplay();
    }

    _applyZoom(factor, originClientX, originClientY) {
        const rect = this.mainCanvas.getBoundingClientRect();
        const mouseX = originClientX - rect.left;
        const mouseY = originClientY - rect.top;
        const cx = (mouseX - this.translateX) / this.scale;
        const cy = (mouseY - this.translateY) / this.scale;
        const newScale = Math.max(0.05, Math.min(32, this.scale * factor));
        this.translateX = mouseX - cx * newScale;
        this.translateY = mouseY - cy * newScale;
        this.scale = newScale;
    }

    // ===== 公开缩放方法 =====
    zoom(factor) {
        const rect = this.mainCanvas.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const canvasCx = (cx - this.translateX) / this.scale;
        const canvasCy = (cy - this.translateY) / this.scale;
        const newScale = Math.max(0.05, Math.min(32, this.scale * factor));
        this.translateX = cx - canvasCx * newScale;
        this.translateY = cy - canvasCy * newScale;
        this.scale = newScale;
        this._animateTransform();
        this._updateZoomDisplay();
    }

    resetZoom() { this._centerCanvas(); this._animateTransform(); }

    _animateTransform() {
        const container = this.mainCanvas.parentElement;
        container.classList.add('animating');
        this._applyTransform();
        setTimeout(() => container.classList.remove('animating'), 260);
    }

    _applyTransform() {
        const container = this.mainCanvas.parentElement;
        container.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
    }

    _updateZoomDisplay() {
        const el = document.getElementById('zoomLevel');
        if (el) el.textContent = Math.round(this.scale * 100) + '%';
    }

    _updateCanvasInfo(w, h) {
        const el = document.getElementById('canvasInfo');
        const statusEl = document.getElementById('canvasSizeStatus');
        const text = `${w} × ${h} px`;
        if (el) el.textContent = text;
        if (statusEl) statusEl.textContent = `画布: ${text}`;
    }

    // ===== 撤销 / 重做 =====
    saveState() {
        if (!this.ctx) return;
        this.history = this.history.slice(0, this.historyStep + 1);
        const imageData = this.ctx.getImageData(0, 0, this.mainCanvas.width, this.mainCanvas.height);
        this.history.push(imageData);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.historyStep++;
        }
    }

    undo() {
        if (this.historyStep > 0) {
            this.historyStep--;
            this.ctx.putImageData(this.history[this.historyStep], 0, 0);
        }
    }

    redo() {
        if (this.historyStep < this.history.length - 1) {
            this.historyStep++;
            this.ctx.putImageData(this.history[this.historyStep], 0, 0);
        }
    }

    clear() {
        if (!this.ctx) return;
        this._fillBackground();
        this.saveState();
    }

    // ===== 工具设置 =====
    setTool(tool) {
        this.currentTool = tool;
        const container = this.mainCanvas.parentElement;
        if (tool === 'eraser') container.classList.add('eraser-mode');
        else container.classList.remove('eraser-mode');
    }

    setBrushColor(color) { this.brushColor = color; }
    setBrushSize(size) { this.brushSize = size; }
    setBrushOpacity(opacity) { this.brushOpacity = opacity; }

    // ===== 透视辅助 =====
    setPerspectiveType(type) {
        this.perspectiveType = type;
        this._drawPerspective();
    }

    _drawPerspective() {
        if (!this.perspCtx) return;
        const ctx = this.perspCtx;
        const w = this.perspectiveCanvas.width;
        const h = this.perspectiveCanvas.height;
        ctx.clearRect(0, 0, w, h);
        if (this.perspectiveType === 'none') return;
        const cx = w / 2;
        const cy = h / 2;
        ctx.strokeStyle = 'rgba(100, 149, 237, 0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 7]);
        if (this.perspectiveType === 'one-point') {
            this._drawVPFrom(ctx, { x: cx, y: cy }, w, h);
        } else if (this.perspectiveType === 'two-point') {
            this._drawVPFrom(ctx, { x: w * 0.15, y: cy }, w, h);
            this._drawVPFrom(ctx, { x: w * 0.85, y: cy }, w, h);
            ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
        } else if (this.perspectiveType === 'three-point') {
            this._drawVPFrom(ctx, { x: w * 0.2, y: cy * 0.85 }, w, h);
            this._drawVPFrom(ctx, { x: w * 0.8, y: cy * 0.85 }, w, h);
            this._drawVPFrom(ctx, { x: cx, y: h * 0.92 }, w, h);
        }
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(100, 149, 237, 0.85)';
        const vps = this._getVPs(w, h, cx, cy);
        vps.forEach(vp => { ctx.beginPath(); ctx.arc(vp.x, vp.y, 5, 0, Math.PI * 2); ctx.fill(); });
    }

    _getVPs(w, h, cx, cy) {
        if (this.perspectiveType === 'one-point') return [{ x: cx, y: cy }];
        if (this.perspectiveType === 'two-point') return [{ x: w * 0.15, y: cy }, { x: w * 0.85, y: cy }];
        if (this.perspectiveType === 'three-point') return [{ x: w * 0.2, y: cy * 0.85 }, { x: w * 0.8, y: cy * 0.85 }, { x: cx, y: h * 0.92 }];
        return [];
    }

    _drawVPFrom(ctx, vp, w, h) {
        const corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h }, { x: w / 2, y: 0 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }, { x: w, y: h / 2 }];
        corners.forEach(c => { ctx.beginPath(); ctx.moveTo(vp.x, vp.y); ctx.lineTo(c.x, c.y); ctx.stroke(); });
    }

    // ===== 导出 =====
    getCanvasDataURL() {
        if (!this.mainCanvas) return null;
        return this.mainCanvas.toDataURL('image/png');
    }

    export(format = 'png') {
        return this.mainCanvas.toDataURL(`image/${format}`);
    }

    // ===== 从图片加载到画布（叠加）=====
    loadFromImage(imgSrc) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const w = this.mainCanvas.width;
                const h = this.mainCanvas.height;
                const scale = Math.min(w / img.width, h / img.height, 1);
                const dw = img.width * scale;
                const dh = img.height * scale;
                const dx = (w - dw) / 2;
                const dy = (h - dh) / 2;
                this.ctx.globalAlpha = 1;
                this.ctx.globalCompositeOperation = 'source-over';
                this.ctx.drawImage(img, dx, dy, dw, dh);
                this.saveState();
                resolve();
            };
            img.onerror = reject;
            img.src = imgSrc;
        });
    }
}
