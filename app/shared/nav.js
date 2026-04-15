import { PAGES, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

/**
 * Navigation items in display order.
 * Each entry: { key, label, href }
 * key matches a PAGES key and is used to mark the active page.
 */
const NAV_ITEMS = [
  { key: 'cockpit',  label: 'Cockpit',       href: PAGES.cockpit },
  { key: 'kalender', label: 'Kalender',       href: PAGES.kalender },
  { key: 'finanzen', label: 'Finanzen',       href: PAGES.finanzen },
  { key: 'herde',    label: 'Herde',          href: PAGES.herde },
  { key: 'weide',    label: 'Weide & Klima',  href: PAGES.weide },
  { key: 'markt',    label: 'Markt',          href: PAGES.markt },
  { key: 'operativ', label: 'Operativ',       href: PAGES.operativ },
  { key: 'berichte', label: 'Berichte',       href: PAGES.berichte },
  { key: 'bonus',    label: 'Bonus & Prognose', href: PAGES.bonus },
  { key: 'admin',    label: 'Admin',          href: PAGES.admin },
];

async function handleLogout(e) {
  e.preventDefault();
  try {
    if (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY) {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      await client.auth.signOut();
    }
  } catch (err) {
    console.error('Logout error:', err);
  }
  window.location.href = 'login.html';
}

/**
 * Render the navigation bar and inject it into the page.
 *
 * Looks for a container element with the attribute `data-nav` or the
 * class `nav`. If none exists, the nav is inserted right after the
 * first `.header` element (matching the existing page layout).
 *
 * @param {string} activePage - key of the active page (e.g. 'cockpit', 'herde')
 */
export function renderNav(activePage) {
  const links = NAV_ITEMS.map(item => {
    const cls = item.key === activePage ? ' class="active"' : '';
    return `<a href="${item.href}"${cls}>${item.label}</a>`;
  }).join('\n        ');

  const logoutLink = `<a href="#" id="nav-logout" style="margin-left:auto; color:#b91c1c;" title="Abmelden">&#x23FB; Abmelden</a>`;

  const html = `<nav class="nav">
        ${links}
        ${logoutLink}
    </nav>`;

  // Find or create the mount point
  let target = document.querySelector('[data-nav]') || document.querySelector('#main-nav') || document.querySelector('.nav');

  if (target) {
    target.outerHTML = html;
  } else {
    // Insert after the header
    const header = document.querySelector('.header');
    if (header) {
      header.insertAdjacentHTML('afterend', html);
    }
  }

  // Attach logout handler (element was just injected)
  const btn = document.getElementById('nav-logout');
  if (btn) btn.addEventListener('click', handleLogout);
}
