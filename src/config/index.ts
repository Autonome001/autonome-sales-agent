import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

const ConfigSchema = z.object({
  // Supabase
  supabase: z.object({
    url: z.string().url(),
    anonKey: z.string().min(1),
    serviceRoleKey: z.string().min(1),
  }),
  
  // Anthropic
  anthropic: z.object({
    apiKey: z.string().min(1),
  }),
  
  // Apify
  apify: z.object({
    apiToken: z.string().min(1),
  }),
  
  // Optional OpenAI
  openai: z.object({
    apiKey: z.string().optional(),
  }),
  
  // App
  app: z.object({
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const config = {
    supabase: {
      url: process.env.SUPABASE_URL || '',
      anonKey: process.env.SUPABASE_ANON_KEY || '',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    },
    apify: {
      apiToken: process.env.APIFY_API_TOKEN || '',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
    },
    app: {
      nodeEnv: process.env.NODE_ENV as 'development' | 'production' | 'test' || 'development',
      logLevel: process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' || 'info',
    },
  };

  // Validate in production, warn in development
  try {
    return ConfigSchema.parse(config);
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
    console.warn('⚠️  Config validation failed (non-critical in development):', error);
    return config as Config;
  }
}

export const config = loadConfig();

// Export individual configs for convenience
export const { supabase: supabaseConfig, anthropic: anthropicConfig, apify: apifyConfig } = config;
