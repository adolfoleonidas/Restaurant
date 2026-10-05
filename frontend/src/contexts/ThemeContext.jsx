import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';

const themes = [
  { id: 'fresco', name: 'Fresco', description: 'Azul/Blanco - Profesional y limpio' },
  { id: 'restaurante', name: 'Restaurante', description: 'Verde moderno - Estilo restaurante' },
  { id: 'calido', name: 'Cálido', description: 'Naranja/Marrón - Acogedor tradicional' },
];

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
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('restaurant-dark-mode');
    return stored !== null && stored === 'true';
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

  // La cocina queda siempre en oscuro (pantalla de pase, tablet); el resto de
  // la app respeta la elección del usuario. La ruta llega por setActivePath.
  const kitchenDark = (activePath || '').startsWith('/cocina');
  const effectiveDark = darkMode || kitchenDark;

  // Aplicar tema y dark mode
  useEffect(() => {
    if (loading) return;

    // Remover clases de tema anteriores
    themes.forEach(t => document.body.classList.remove(`theme-${t.id}`));
    // Agregar clase del tema actual
    document.body.classList.add(`theme-${theme}`);
    
    // Aplicar dark mode (solo la elección del usuario se persiste: el modo de
    // la cocina no debe quedar grabado al salir de la pantalla).
    if (effectiveDark) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
    localStorage.setItem('restaurant-dark-mode', darkMode.toString());
    
    // Cargar CSS del tema
    loadThemeCSS(theme);
  }, [theme, effectiveDark, darkMode, loading]);

  const loadThemeCSS = (themeId) => {
    const existingLink = document.getElementById('theme-css');
    if (existingLink) {
      existingLink.remove();
    }
    
    if (themeId === 'fresco') {
      // Fresco es el default en index.css, no necesita cargar nada
      return;
    }
    
    const link = document.createElement('link');
    link.id = 'theme-css';
    link.rel = 'stylesheet';
    link.href = `/themes/theme-${themeId}.css`;
    document.head.appendChild(link);
  };

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
    setDarkMode(!darkMode);
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
