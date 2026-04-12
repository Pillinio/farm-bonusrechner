// Client-side logger that sends to Supabase
export class AppLogger {
  constructor(supabase, source) {
    this.supabase = supabase;
    this.source = source;
    this.buffer = [];
    this.flushInterval = setInterval(() => this.flush(), 10000); // flush every 10s
  }

  log(level, message, details = null) {
    const entry = { level, source: this.source, message, details, created_at: new Date().toISOString() };
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[${this.source}] ${message}`, details || '');
    this.buffer.push(entry);
    if (level === 'error') this.flush(); // flush errors immediately
  }

  info(msg, details) { this.log('info', msg, details); }
  warn(msg, details) { this.log('warn', msg, details); }
  error(msg, details) { this.log('error', msg, details); }

  async flush() {
    if (this.buffer.length === 0) return;
    const entries = [...this.buffer];
    this.buffer = [];
    try {
      await this.supabase.from('app_logs').insert(entries);
    } catch (e) {
      console.error('Failed to flush logs:', e);
      // Re-add failed entries
      this.buffer.unshift(...entries);
    }
  }
}
