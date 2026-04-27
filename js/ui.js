/* UI utilities: tab switching, HTML escaping */

export function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

export function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const targetId = tab.dataset.tab;
            document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
            const targetPanel = document.getElementById(`${targetId}-tab`);
            if (targetPanel) targetPanel.classList.add('active');
        });
    });
}

// Centralized Layout Logic
export function isLandscape(orientation) {
    return orientation === 'landscape';
}

export function syncLayout(container, orientation) {
    if (!container) return;

    // Remove existing layout classes to ensure clean state
    container.classList.remove('layout-portrait', 'layout-landscape', 'orientation-portrait', 'orientation-landscape');

    // Add new layout classes
    const layoutClass = isLandscape(orientation) ? 'layout-landscape' : 'layout-portrait';
    const orientationClass = isLandscape(orientation) ? 'orientation-landscape' : 'orientation-portrait';

    container.classList.add(layoutClass);
    // Also add toggle class for specific styling needs
    container.classList.toggle(orientationClass, isLandscape(orientation));

    // Helper for preview elements within the container
    const previews = container.querySelectorAll('.image-placeholder');
    previews.forEach(el => {
        el.classList.remove('orientation-portrait', 'orientation-landscape');
        el.classList.add(orientationClass);
    });
}
