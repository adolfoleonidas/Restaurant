// Lógica de reset-sw.html. Vive en un archivo propio (mismo origen) y no en línea
// porque la CSP (`script-src 'self'` + el hash del script de modo oscuro) bloquea
// cualquier otro script inline: con el inline, la página de rescate no hacía nada.
(async () => {
  const msg = document.getElementById('msg');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    msg.textContent = 'Listo. Abriendo la versión nueva…';
  } catch (e) {
    msg.textContent = 'Listo (con avisos). Abriendo la versión nueva…';
  }
  setTimeout(() => { window.location.replace('/'); }, 600);
})();
