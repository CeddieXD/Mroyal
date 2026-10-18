// js/loader.js
export async function loadComponent(id, filePath) {
    const response = await fetch(filePath);
    const html = await response.text();
    document.getElementById(id).innerHTML = html;
}