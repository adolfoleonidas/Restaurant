import React from 'react';
import { buildLabel } from '@/lib/buildInfo';

/**
 * La versión de la app que está corriendo, en letra chica.
 *
 * Sirve para una pregunta que hoy no tiene respuesta desde ningún otro lado: ¿el
 * teléfono del mozo está usando la build nueva o una vieja que le quedó guardada
 * al service worker? Se compara este texto con lo desplegado y se acabó la duda.
 */
export default function BuildStamp({ className = '', prefix = 'mesa-sheet' }) {
    return (
        <span
            className={`block text-[11px] text-muted-foreground ${className}`}
            data-testid={`${prefix}-version`}
        >
            {buildLabel()}
        </span>
    );
}
