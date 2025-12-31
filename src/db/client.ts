import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../config/index.js';

// Database types (generated from schema)
export interface Database {
  public: {
    Tables: {
      leads: {
        Row: {
          id: string;
          first_name: string | null;
          last_name: string | null;
          email: string;
          phone: string | null;
          linkedin_url: string | null;
          company_name: string | null;
          job_title: string | null;
          seniority: string | null;
          industry: string | null;
          website_url: string | null;
          city: string | null;
          state: string | null;
          country: string | null;
          timezone: string | null;
          status: string;
          research_data: Record<string, any> | null;
          research_completed_at: string | null;
          email_1_subject: string | null;
          email_1_body: string | null;
          email_2_body: string | null;
          email_3_subject: string | null;
          email_3_body: string | null;
          sender_email: string | null;
          opt_out_token: string;
          gmail_thread_id: string | null;
          email_1_sent_at: string | null;
          email_2_sent_at: string | null;
          email_3_sent_at: string | null;
          replied_at: string | null;
          meeting_booked_at: string | null;
          source: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['leads']['Row'], 'id' | 'created_at' | 'updated_at' | 'opt_out_token'> & {
          id?: string;
          opt_out_token?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['leads']['Insert']>;
      };
      events: {
        Row: {
          id: string;
          lead_id: string | null;
          event_type: string;
          event_data: Record<string, any> | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['events']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['events']['Insert']>;
      };
    };
  };
}

// Create Supabase client with service role for backend operations
export const supabase: SupabaseClient<Database> = createClient<Database>(
  supabaseConfig.url,
  supabaseConfig.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Helper to check connection
export async function checkConnection(): Promise<boolean> {
  try {
    const { error } = await supabase.from('leads').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}
