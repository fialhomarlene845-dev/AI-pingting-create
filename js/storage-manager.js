// ===== 本地存储管理器 =====
export class StorageManager {
    constructor() {
        this.dbName = 'PingtingCreateDB';
        this.dbVersion = 1;
        this.db = null;
        this.ready = this.init();
    }

    async init() {
        try {
            this.db = await this.openDatabase();
            console.log('✅ IndexedDB 初始化完成');
        } catch (error) {
            // IndexedDB 在某些环境（file://、隐私模式）下可能不可用，静默处理
            console.warn('⚠️ IndexedDB 不可用，将跳过本地存储:', error.message);
        }
    }

    openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('aiHistory')) {
                    const aiStore = db.createObjectStore('aiHistory', { keyPath: 'id', autoIncrement: true });
                    aiStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    async saveProject(projectId, projectData) {
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readwrite');
            const store = transaction.objectStore('projects');
            const request = store.put({ id: projectId, ...projectData, lastModified: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async loadProject(projectId) {
        if (!this.db) return null;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readonly');
            const request = transaction.objectStore('projects').get(projectId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveAIHistory(historyData) {
        if (!this.db) return;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['aiHistory'], 'readwrite');
            const request = transaction.objectStore('aiHistory').add({ ...historyData, timestamp: Date.now() });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}
