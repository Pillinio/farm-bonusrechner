// shared/bonus-live-loader.js
// ES module to fetch live farm data and apply as defaults to the bonus calculator.

/**
 * Fetch live defaults from the bonus-defaults Edge Function.
 *
 * @param {string} supabaseUrl  e.g. "https://xxx.supabase.co"
 * @param {string} anonKey      Supabase anon/public key
 * @returns {Promise<object|null>}  Defaults object or null on failure
 */
export async function loadLiveDefaults(supabaseUrl, anonKey) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/bonus-defaults`, {
      headers: {
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      console.warn(`bonus-defaults returned ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (err) {
    console.warn('Failed to load live defaults:', err);
    return null;
  }
}

/**
 * Format a number in German locale (1.234.567) for text inputs.
 *
 * @param {number} value
 * @returns {string}
 */
function formatGerman(value) {
  return Math.round(value).toLocaleString('de-DE');
}

/**
 * Safely set a DOM input value if the element exists and the value is valid.
 *
 * @param {string} id        DOM element ID
 * @param {*}      value     Value to set
 * @param {object} options
 * @param {boolean} options.formatted  If true, format as German number string
 */
function setInput(id, value, { formatted = false } = {}) {
  if (value == null || value === '' || (typeof value === 'number' && isNaN(value))) return;
  const el = document.getElementById(id);
  if (!el) return;

  if (formatted) {
    el.value = formatGerman(value);
  } else {
    el.value = value;
  }
}

/**
 * Apply live defaults to all bonus calculator DOM inputs.
 * After setting values, triggers updateValue() for range sliders
 * and calculate() to refresh results.
 *
 * @param {object} defaults  Object from loadLiveDefaults()
 */
export function applyDefaults(defaults) {
  if (!defaults) return;

  // Range sliders (numeric value, no formatting)
  setInput('herdSize', defaults.herdSize);
  setInput('slaughterWeight', defaults.slaughterWeight);
  setInput('salesRate', defaults.salesRate);

  // Number input
  setInput('pricePerKg', defaults.pricePerKg);

  // Text inputs with German number formatting
  setInput('huntingRevenue', defaults.huntingRevenue, { formatted: true });
  setInput('rentRevenue', defaults.rentRevenue, { formatted: true });
  setInput('otherRevenue', defaults.otherRevenue, { formatted: true });
  setInput('baseCosts', defaults.baseCosts, { formatted: true });
  setInput('baseSalary', defaults.baseSalary, { formatted: true });

  // Update range slider displays
  const rangeIds = ['herdSize', 'slaughterWeight', 'salesRate'];
  for (const id of rangeIds) {
    if (typeof window.updateValue === 'function') {
      window.updateValue(id);
    }
  }

  // Recalculate
  if (typeof window.calculate === 'function') {
    window.calculate();
  }
}

/**
 * Show a small indicator in the UI showing data source and date.
 *
 * @param {object} defaults  Object from loadLiveDefaults()
 */
export function showDataSourceIndicator(defaults) {
  if (!defaults) return;

  // Remove existing indicator if present
  const existing = document.getElementById('liveDataIndicator');
  if (existing) existing.remove();

  const indicator = document.createElement('div');
  indicator.id = 'liveDataIndicator';
  indicator.style.cssText = [
    'position: fixed',
    'bottom: 12px',
    'right: 12px',
    'padding: 6px 14px',
    'border-radius: 6px',
    'font-size: 13px',
    'font-weight: 500',
    'z-index: 9999',
    'box-shadow: 0 2px 8px rgba(0,0,0,0.15)',
    'cursor: pointer',
    'transition: opacity 0.3s',
  ].join(';');

  if (defaults.source === 'live') {
    indicator.style.background = '#d4edda';
    indicator.style.color = '#155724';
    indicator.style.border = '1px solid #c3e6cb';
    indicator.textContent = `Live-Daten vom ${defaults.dataDate}`;
  } else {
    indicator.style.background = '#fff3cd';
    indicator.style.color = '#856404';
    indicator.style.border = '1px solid #ffeaa7';
    indicator.textContent = 'Manuelle Eingabe (Standardwerte)';
  }

  // Show warnings on hover if any
  if (defaults.warnings && defaults.warnings.length > 0) {
    indicator.title = defaults.warnings.join('\n');
  }

  // Click to dismiss
  indicator.addEventListener('click', () => {
    indicator.style.opacity = '0';
    setTimeout(() => indicator.remove(), 300);
  });

  document.body.appendChild(indicator);
}

/**
 * Convenience: load live defaults, apply them, and show an indicator.
 * Falls back silently to existing hardcoded defaults.
 *
 * @param {string} supabaseUrl
 * @param {string} anonKey
 * @returns {Promise<object|null>}  The loaded defaults or null
 */
export async function initLiveDefaults(supabaseUrl, anonKey) {
  const defaults = await loadLiveDefaults(supabaseUrl, anonKey);
  if (defaults) {
    applyDefaults(defaults);
    showDataSourceIndicator(defaults);
  }
  return defaults;
}
