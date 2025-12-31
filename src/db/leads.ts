import { supabase, Database } from './client.js';
import type { Lead, CreateLead, LeadStatus } from '../types/index.js';

type LeadRow = Database['public']['Tables']['leads']['Row'];
type LeadInsert = Database['public']['Tables']['leads']['Insert'];

export const leadsDb = {
  /**
   * Find a lead by ID
   */
  async findById(id: string): Promise<Lead | null> {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error || !data) return null;
    return data as Lead;
  },

  /**
   * Find a lead by email
   */
  async findByEmail(email: string): Promise<Lead | null> {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();
    
    if (error || !data) return null;
    return data as Lead;
  },

  /**
   * Find a lead by LinkedIn URL
   */
  async findByLinkedIn(linkedinUrl: string): Promise<Lead | null> {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('linkedin_url', linkedinUrl)
      .single();
    
    if (error || !data) return null;
    return data as Lead;
  },

  /**
   * Check if a lead exists by email or LinkedIn URL
   */
  async exists(email?: string, linkedinUrl?: string): Promise<boolean> {
    if (email) {
      const { count } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('email', email.toLowerCase());
      if (count && count > 0) return true;
    }
    
    if (linkedinUrl) {
      const { count } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('linkedin_url', linkedinUrl);
      if (count && count > 0) return true;
    }
    
    return false;
  },

  /**
   * Create a new lead
   */
  async create(lead: CreateLead): Promise<Lead> {
    const insert: LeadInsert = {
      ...lead,
      email: lead.email.toLowerCase(),
      status: 'scraped',
    };

    const { data, error } = await supabase
      .from('leads')
      .insert(insert)
      .select()
      .single();
    
    if (error) {
      throw new Error(`Failed to create lead: ${error.message}`);
    }
    
    return data as Lead;
  },

  /**
   * Create multiple leads (bulk insert with duplicate handling)
   */
  async createMany(leads: CreateLead[]): Promise<{ created: Lead[]; skipped: number }> {
    const created: Lead[] = [];
    let skipped = 0;

    // Process in batches to avoid overwhelming the database
    const batchSize = 50;
    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);
      
      for (const lead of batch) {
        // Check for duplicates
        const exists = await this.exists(lead.email, lead.linkedin_url ?? undefined);
        if (exists) {
          skipped++;
          continue;
        }

        try {
          const newLead = await this.create(lead);
          created.push(newLead);
        } catch (error) {
          // Handle race condition duplicates
          if ((error as Error).message.includes('duplicate')) {
            skipped++;
          } else {
            console.error(`Failed to create lead ${lead.email}:`, error);
          }
        }
      }
    }

    return { created, skipped };
  },

  /**
   * Update a lead
   */
  async update(id: string, updates: Partial<LeadRow>): Promise<Lead> {
    const { data, error } = await supabase
      .from('leads')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      throw new Error(`Failed to update lead: ${error.message}`);
    }
    
    return data as Lead;
  },

  /**
   * Update lead status
   */
  async updateStatus(id: string, status: LeadStatus): Promise<Lead> {
    return this.update(id, { status });
  },

  /**
   * Find leads by status
   */
  async findByStatus(status: LeadStatus, limit = 100): Promise<Lead[]> {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: true })
      .limit(limit);
    
    if (error) {
      throw new Error(`Failed to fetch leads: ${error.message}`);
    }
    
    return (data ?? []) as Lead[];
  },

  /**
   * Find leads ready for email sending
   */
  async findReadyForEmail(emailNumber: 1 | 2 | 3, timezone?: string, limit = 50): Promise<Lead[]> {
    const statusMap = {
      1: 'ready',
      2: 'email_1_sent',
      3: 'email_2_sent',
    };

    let query = supabase
      .from('leads')
      .select('*')
      .eq('status', statusMap[emailNumber])
      .is('opted_out', null)
      .is('replied_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);
    
    if (timezone) {
      query = query.eq('timezone', timezone);
    }

    const { data, error } = await query;
    
    if (error) {
      throw new Error(`Failed to fetch leads for email: ${error.message}`);
    }
    
    return (data ?? []) as Lead[];
  },

  /**
   * Get lead counts by status
   */
  async getStatusCounts(): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from('leads')
      .select('status');
    
    if (error) {
      throw new Error(`Failed to fetch status counts: ${error.message}`);
    }

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      counts[row.status] = (counts[row.status] || 0) + 1;
    }
    
    return counts;
  },

  /**
   * Search leads
   */
  async search(query: string, limit = 50): Promise<Lead[]> {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .or(`email.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%,company_name.ilike.%${query}%`)
      .limit(limit);
    
    if (error) {
      throw new Error(`Failed to search leads: ${error.message}`);
    }
    
    return (data ?? []) as Lead[];
  },
};
