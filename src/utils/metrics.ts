import { logger } from './logger.js';

/**
 * Autonome Sales System - Simple Metrics Collector
 * 
 * Tracks system health and performance metrics in-memory.
 */

interface SystemMetrics {
    pipelineRuns: number;
    leadsDiscovered: number;
    leadsResearched: number;
    emailsGenerated: number;
    emailsSent: number;
    errorsCaught: number;
    startTime: number;
    quarantinedLeads: number;
}

class MetricsService {
    private metrics: SystemMetrics = {
        pipelineRuns: 0,
        leadsDiscovered: 0,
        leadsResearched: 0,
        emailsGenerated: 0,
        emailsSent: 0,
        errorsCaught: 0,
        startTime: Date.now(),
        quarantinedLeads: 0,
    };

    increment(metric: keyof Omit<SystemMetrics, 'startTime'>, amount: number = 1) {
        this.metrics[metric] += amount;
    }

    set(metric: keyof Omit<SystemMetrics, 'startTime'>, value: number) {
        this.metrics[metric] = value;
    }

    getSummary() {
        const uptimeSeconds = Math.floor((Date.now() - this.metrics.startTime) / 1000);
        return {
            ...this.metrics,
            uptimeSeconds,
            successRate: this.calculateSuccessRate(),
        };
    }

    private calculateSuccessRate(): string {
        const totalAttempts = this.metrics.emailsSent + this.metrics.errorsCaught;
        if (totalAttempts === 0) return '0%';
        return `${((this.metrics.emailsSent / totalAttempts) * 100).toFixed(1)}%`;
    }

    logMetricsSummary() {
        const summary = this.getSummary();
        logger.info('📊 System Metrics Summary', { metadata: summary });
    }
}

export const metrics = new MetricsService();
export default metrics;
