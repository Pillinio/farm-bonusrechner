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

  const warnCount = Array.isArray(defaults.warnings) ? defaults.warnings.length : 0;

  if (defaults.source === 'live' && warnCount === 0) {
    indicator.style.background = '#d4edda';
    indicator.style.color = '#155724';
    indicator.style.border = '1px solid #c3e6cb';
    indicator.textContent = `Live-Daten vom ${defaults.dataDate}`;
  } else if (defaults.source === 'live' && warnCount > 0) {
    // Teilweise Live-Daten — einige Queries haben Warnungen geworfen,
    // der User soll das sehen (nicht nur im title-Tooltip).
    indicator.style.background = '#fff3cd';
    indicator.style.color = '#856404';
    indicator.style.border = '1px solid #ffeaa7';
    indicator.textContent = `Live-Daten vom ${defaults.dataDate} · ${warnCount} Warnung${warnCount === 1 ? '' : 'en'}`;
  } else {
    indicator.style.background = '#f8d7da';
    indicator.style.color = '#721c24';
    indicator.style.border = '1px solid #f5c6cb';
    indicator.textContent = warnCount > 0
      ? `Fallback-Werte · ${warnCount} Warnung${warnCount === 1 ? '' : 'en'} (Hover)`
      : 'Manuelle Eingabe (Standardwerte)';
  }

  if (warnCount > 0) {
    indicator.title = defaults.warnings.join('\n');
    // Zusätzlich zur UI auch in die Browser-Konsole loggen — erleichtert
    // Debugging ohne dass der User über die Badge hovern muss.
    console.warn('bonus-defaults warnings:', defaults.warnings);
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
