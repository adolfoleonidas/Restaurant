import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';

const themes = [
  { id: 'fresco', name: 'Fresco', description: 'Azul/Blanco - Profesional y limpio' },
  { id: 'restaurante', name: 'Restaurante', description: 'Verde moderno - Estilo restaurante' },
  { id: 'calido', name: 'Cálido', description: 'Naranja/Marrón - Acogedor tradicional' },
];

// Carga bajo demanda la hoja del tema activo. Vive fuera del componente para
// que sea estable y no entre en las dependencias de los efectos.
function applyThemeCSS(themeId) {
  const existingLink = document.getElementById('theme-css');
  if (existingLink) {
    existingLink.remove();
  }

  if (themeId === 'fresco') {
    // Fresco es el default en index.css, no necesita cargar nada.
    return;
  }

  const link = document.createElement('link');
  link.id = 'theme-css';
  link.rel = 'stylesheet';
  link.href = `/themes/theme-${themeId}.css`;
  document.head.appendChild(link);
}

// Default value so components (and tests) can render outside a ThemeProvider.
const fallbackTheme = {
  theme: 'fresco',
  setTheme: () => {},
  clearThemeOverride: () => {},
  themes,
  darkMode: false,
  kitchenDark: false,
  setActivePath: () => {},
  toggle: () => {},
  loading: false,
};

const ThemeContext = createContext(fallbackTheme);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('fresco');
  // La guía de diseño limita el modo oscuro a la pantalla de cocina (y opcional
  // a caja). Antes se derivaba de la preferencia del sistema, así que un tablet
  // con el SO en oscuro arrancaba el POS entero oscuro, incluida Caja.
  //
  // `null` significa "el usuario todavía no eligió": ahí la cocina puede ponerse
  // oscura por su cuenta. En cuanto el usuario toca el interruptor, su elección
  // manda en todas las pantallas, cocina incluida.
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem('restaurant-dark-mode');
    if (stored === null) return null;
    return stored === 'true';
  });
  // Ruta activa, reportada desde el router (ThemeProvider vive fuera de él).
  const [activePath, setActivePath] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : ''));
  const [loading, setLoading] = useState(true);

  // Cargar tema del restaurante desde la API
  useEffect(() => {
    const loadRestaurantTheme = async () => {
      try {
        // Sin sesión, /restaurants/current responde 401: la carta pública lee el
        // endpoint público, que también devuelve theme_id.
        const hasSession = typeof localStorage !== 'undefined' && !!localStorage.getItem('token');
        const { data } = hasSession
          ? await api.get('/restaurants/current')
          : await api.get('/public/restaurant');
        const restaurantTheme = data.theme_id || 'fresco';
        const localOverride = localStorage.getItem('restaurant-theme');
        
        // Usar override local si existe (para pruebas), sino el del restaurante
        const finalTheme = localOverride || restaurantTheme;
        setThemeState(finalTheme);
        setLoading(false);
      } catch (error) {
        // Si no hay autenticación o error, usar default
        const localTheme = localStorage.getItem('restaurant-theme') || 'fresco';
        setThemeState(localTheme);
        setLoading(false);
      }
    };

    loadRestaurantTheme();
  }, []);

  // Ninguna pantalla cambia el tema por su cuenta. Antes la cocina se ponía
  // oscura sola, y quien no había elegido nada entraba a una pantalla negra que
  // no pidió. Ahora manda, en este orden: lo que eligió el usuario en la app y,
  // si todavía no eligió, lo que pide su dispositivo.
  const prefersDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
  const kitchenDark = (activePath || '').startsWith('/cocina');
  const userChoice = darkMode === null ? null : darkMode;
  const effectiveDark = userChoice === null ? prefersDark : userChoice;

  // Aplicar el tema (clase + hoja CSS) SOLO cuando cambia el tema. Recargar la
  // hoja en cada toggle de modo oscuro provocaba un parpadeo (FOUC) y una
  // petición de red extra por cada clic.
  useEffect(() => {
    if (loading) return;

    // Quita cualquier clase theme-* previa, incluidas variantes que ya no están
    // en la lista de temas (si no, podrían quedar dos temas aplicados a la vez).
    Array.from(document.body.classList)
      .filter((cls) => cls.startsWith('theme-'))
      .forEach((cls) => document.body.classList.remove(cls));
    document.body.classList.add(`theme-${theme}`);

    applyThemeCSS(theme);
  }, [theme, loading]);

  // Aplicar el modo oscuro SOLO cuando cambia el modo (o la ruta, para el modo
  // cocina). La elección del usuario se persiste; el modo de la cocina no debe
  // quedar grabado al salir de la pantalla.
  useEffect(() => {
    if (loading) return;

    if (effectiveDark) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
    // Solo se persiste una elección real del usuario: el oscuro automático de la
    // cocina no debe quedar grabado y seguir al usuario al salir de esa pantalla.
    if (userChoice === null) {
      localStorage.removeItem('restaurant-dark-mode');
    } else {
      localStorage.setItem('restaurant-dark-mode', String(userChoice));
    }
  }, [effectiveDark, userChoice, loading]);

  const setTheme = (newTheme) => {
    setThemeState(newTheme);
    // Guardar como override local
    localStorage.setItem('restaurant-theme', newTheme);
  };

  const clearThemeOverride = () => {
    localStorage.removeItem('restaurant-theme');
    // Recargar para obtener el tema del restaurante
    window.location.reload();
  };

  const toggle = () => {
    // El interruptor siempre deja una elección explícita: parte de lo que se ve
    // ahora y lo invierte.
    setDarkMode(!effectiveDark);
  };

  return (
    <ThemeContext.Provider value={{ 
      theme, 
      setTheme, 
      clearThemeOverride,
      themes, 
      darkMode: effectiveDark,
      kitchenDark,
      setActivePath,
      toggle,
      loading 
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
