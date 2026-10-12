import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** The one "Nuevo pedido" control: used in the empty-table card and the action bar. */
export default function NewOrderButton({ variant = 'default', disabled, onClick, expanded }) {
    return (
        <Button
            variant={variant}
            className="w-full h-12 touch-target-coarse"
            disabled={disabled}
            onClick={onClick}
            aria-expanded={expanded}
            data-testid="mesa-sheet-nuevo-pedido"
        >
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" /> Nuevo pedido
        </Button>
    );
}
