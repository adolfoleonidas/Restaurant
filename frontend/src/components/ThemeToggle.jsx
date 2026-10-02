import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/contexts/ThemeContext';

export function ThemeToggle() {
    const { darkMode, toggle } = useTheme();
    return (
        <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-sm"
            onClick={toggle}
            aria-label={darkMode ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            data-testid="theme-toggle"
        >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
    );
}
