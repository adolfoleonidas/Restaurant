import { createContext, useContext, useEffect, useState } from 'react';

const themes = [
  { id: 'fresco', name: 'Fresco', description: 'Azul/Blanco - Profesional y limpio' },
  { id: 'restaurante', name: 'Restaurante', description: 'Verde cálido - Estilo restaurante' },
  { id: 'calido', name: 'Cálido', description: 'Naranja/Marrón - Acogedor' },
];

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('restaurant-theme') || 'fresco';
    }
    return 'fresco';
  });

  useEffect(() => {
    // Remover clases de tema anteriores
    document.body.classList.remove(...themes.map(t => `theme-${t.id}`));
    // Agregar clase del tema actual
    document.body.classList.add(`theme-${theme}`);
    // Persistir
    localStorage.setItem('restaurant-theme', theme);
    
    // Importar el CSS del tema dinámicamente
    loadThemeCSS(theme);
  }, [theme]);

  const loadThemeCSS = async (themeId) => {
    if (themeId === 'fresco') return; // Fresco es el default en index.css
    
    const existingLink = document.getElementById('theme-css');
    if (existingLink) {
      existingLink.remove();
    }
    
    const link = document.createElement('link');
    link.id = 'theme-css';
    link.rel = 'stylesheet';
    link.href = `/themes/theme-${themeId}.css`;
    document.head.appendChild(link);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
