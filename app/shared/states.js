// Consistent loading, error, and empty state components
export function showLoading(container) {
  container.innerHTML = '<div class="state-loading"><div class="spinner"></div><p>Daten werden geladen...</p></div>';
}

export function showError(container, message = 'Fehler beim Laden der Daten.') {
  container.innerHTML = `<div class="state-error"><span>⚠️</span><p>${message}</p><button onclick="location.reload()">Erneut versuchen</button></div>`;
}

export function showEmpty(container, message = 'Noch keine Daten vorhanden.') {
  container.innerHTML = `<div class="state-empty"><span>📭</span><p>${message}</p></div>`;
}
