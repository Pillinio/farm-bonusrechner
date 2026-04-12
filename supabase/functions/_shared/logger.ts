export function createLogger(supabaseClient: any, source: string) {
  return {
    async info(message: string, details?: Record<string, unknown>) {
      console.log(`[${source}] ${message}`);
      await supabaseClient.from('app_logs').insert({ level: 'info', source, message, details });
    },
    async warn(message: string, details?: Record<string, unknown>) {
      console.warn(`[${source}] ${message}`);
      await supabaseClient.from('app_logs').insert({ level: 'warn', source, message, details });
    },
    async error(message: string, details?: Record<string, unknown>) {
      console.error(`[${source}] ${message}`);
      await supabaseClient.from('app_logs').insert({ level: 'error', source, message, details });
    },
  };
}
