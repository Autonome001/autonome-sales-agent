import { config } from '../config/index.js';

export interface CreateReplicaParams {
    replicaId: string;
    script: string;
    backgroundUrl?: string;
    videoName?: string;
    variables?: Record<string, string>;
}

export interface TavusVideo {
    video_id: string;
    status: 'queuing' | 'generating' | 'ready' | 'failed';
    download_url?: string;
    hosted_url?: string;
    error_message?: string;
}

export class TavusService {
    private apiKey: string;
    private baseUrl = 'https://tavusapi.com/v2';

    constructor() {
        this.apiKey = process.env.TAVUS_API_KEY || '';
        if (!this.apiKey) {
            console.warn('⚠️ TAVUS_API_KEY is not set. Video generation will fail.');
        }
    }

    /**
     * Generate a new personalized video
     */
    async generateVideo(params: CreateReplicaParams): Promise<TavusVideo> {
        if (!this.apiKey) throw new Error('Tavus API key missing');

        const response = await fetch(`${this.baseUrl}/videos`, {
            method: 'POST',
            headers: {
                'x-api-key': this.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                replica_id: params.replicaId,
                script: params.script,
                video_name: params.videoName || `outreach-${Date.now()}`,
                background_url: params.backgroundUrl,
                variables: params.variables
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Tavus API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        return data as TavusVideo;
    }

    /**
     * Get video status
     */
    async getVideo(videoId: string): Promise<TavusVideo> {
        if (!this.apiKey) throw new Error('Tavus API key missing');

        const response = await fetch(`${this.baseUrl}/videos/${videoId}`, {
            headers: {
                'x-api-key': this.apiKey
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch video: ${response.status}`);
        }

        return await response.json() as TavusVideo;
    }
}

export const tavusService = new TavusService();
