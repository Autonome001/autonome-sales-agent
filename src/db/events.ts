import { supabase } from './client.js';

export interface EventData {
  lead_id?: string;
  event_type: string;
  event_data?: Record<string, any>;
}

export const eventsDb = {
  /**
   * Log an event
   */
  async log(event: EventData): Promise<void> {
    const { error } = await supabase
      .from('events')
      .insert(event);
    
    if (error) {
      console.error('Failed to log event:', error);
      // Don't throw - event logging shouldn't break the flow
    }
  },

  /**
   * Log multiple events
   */
  async logMany(events: EventData[]): Promise<void> {
    const { error } = await supabase
      .from('events')
      .insert(events);
    
    if (error) {
      console.error('Failed to log events:', error);
    }
  },

  /**
   * Get events for a lead
   */
  async getForLead(leadId: string, limit = 100): Promise<EventData[]> {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      throw new Error(`Failed to fetch events: ${error.message}`);
    }
    
    return data ?? [];
  },

  /**
   * Get recent events of a specific type
   */
  async getByType(eventType: string, limit = 100): Promise<EventData[]> {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('event_type', eventType)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      throw new Error(`Failed to fetch events: ${error.message}`);
    }
    
    return data ?? [];
  },
};
