import { LogEntry, LogTab } from '../types';

type LogSubscriber = (log: LogEntry) => void;

const LOG_STORAGE_KEY = 'botpy_console_logs';

class LogService {
    private allLogs: LogEntry[] = [];
    private subscribers: LogSubscriber[] = [];
    private readonly MAX_LOGS = 1000;

    constructor() {
        this.loadLogsFromStorage();
        if (this.allLogs.length === 0) {
            // This is the very first run or logs were cleared. Add an initial log.
            const initialLog: LogEntry = {
                timestamp: new Date().toISOString(),
                level: 'INFO',
                message: 'Log service initialized. No persisted logs found.',
            };
            this.allLogs.push(initialLog);
            this.persistLogsToStorage();
        } else {
            console.log(`Log service initialized. Loaded ${this.allLogs.length} logs from local storage.`);
        }
    }

    private persistLogsToStorage() {
        try {
            const logsToStore = JSON.stringify(this.allLogs);
            localStorage.setItem(LOG_STORAGE_KEY, logsToStore);
        } catch (error) {
            console.error('Failed to persist logs to localStorage:', error);
        }
    }

    private loadLogsFromStorage() {
        try {
            const storedLogs = localStorage.getItem(LOG_STORAGE_KEY);
            if (storedLogs) {
                const parsedLogs: LogEntry[] = JSON.parse(storedLogs);
                if (Array.isArray(parsedLogs)) {
                    this.allLogs = parsedLogs.slice(-this.MAX_LOGS);
                }
            }
        } catch (error) {
            console.error('Failed to load logs from localStorage:', error);
            localStorage.removeItem(LOG_STORAGE_KEY);
        }
    }

    public log(level: LogEntry['level'], message: string) {
        const newLog: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
        };

        this.allLogs.push(newLog);
        if (this.allLogs.length > this.MAX_LOGS) {
            this.allLogs.shift();
        }
        
        this.subscribers.forEach(cb => cb(newLog));
        
        this.persistLogsToStorage();
    }

    public subscribe(callback: LogSubscriber) {
        if (!this.subscribers.includes(callback)) {
            this.subscribers.push(callback);
        }
    }
    
    public unsubscribe(callback: LogSubscriber) {
        this.subscribers = this.subscribers.filter(cb => cb !== callback);
    }

    public getLogs(tab: LogTab = 'ALL'): LogEntry[] {
        if (tab === 'ALL') {
            return [...this.allLogs];
        }
        // Simplified getLogs with on-the-fly filtering
        return this.allLogs.filter(log => log.level === tab);
    }
}

export const logService = new LogService();
