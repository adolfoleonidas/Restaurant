import React from 'react';
import { Megaphone, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useAssistant } from '@/contexts/AssistantContext';
import useAnnouncements from '@/hooks/useAnnouncements';

const ELIGIBLE_ROLES = ['admin', 'cocina', 'mozo', 'cajero'];

/**
 * AssistantBar — isolated control + captions for the voice assistant.
 * Off by default; when the browser has no speech synthesis it still shows the
 * caption so the operator keeps the information.
 */
export function AssistantBar() {
    const { user } = useAuth();
    const { enabled, setEnabled, supported, caption, cancel } = useAssistant();
    useAnnouncements();

    if (!user || !ELIGIBLE_ROLES.includes(user.role)) return null;

    return (
        <div className="flex items-center gap-1.5">
            {caption && (
                <span
                    className="hidden md:inline max-w-[22rem] truncate text-xs text-muted-foreground"
                    role="status"
                    data-testid="assistant-caption"
                >
                    {caption}
                </span>
            )}
            <Button
                type="button"
                variant={enabled ? 'default' : 'outline'}
                size="sm"
                className="rounded-sm hidden sm:inline-flex"
                onClick={() => setEnabled(!enabled)}
                aria-pressed={enabled}
                title={supported
                    ? 'Asistente de voz: anuncia pedidos, cuentas y comprobantes'
                    : 'Tu navegador no soporta voz; se muestran subtítulos'}
                data-testid="assistant-toggle"
            >
                {enabled ? <Volume2 className="h-4 w-4 mr-1" /> : <Megaphone className="h-4 w-4 mr-1" />}
                {enabled ? 'Voz activa' : 'Voz'}
            </Button>
            {enabled && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-sm"
                    onClick={cancel}
                    title="Silenciar el anuncio actual"
                    data-testid="assistant-silence"
                >
                    <VolumeX className="h-4 w-4" />
                </Button>
            )}
        </div>
    );
}
