/**
 * Floor state tokens (colour + label) for the Salón screen.
 *
 * Single source of truth: the legend, the table card and the table sheet all
 * read from here, so a state can never look "Libre" in one place and green in
 * another, and the card badge does not need its own hardcoded hex values.
 */
export const FLOOR_STYLE = {
    libre: { label: 'Libre', bg: '#E7F6EE', fg: '#0F5132', border: '#BFE7D0', dot: '#22C55E' },
    sentados: { label: 'Ocupada', bg: '#FDE3E3', fg: '#8C1D1D', border: '#F5B5B5', dot: '#EF4444' },
    preparando: { label: 'Preparando', bg: '#FFF6DB', fg: '#6B4E00', border: '#F3E2A6', dot: '#F59E0B' },
    listo: { label: 'Listo', bg: '#E0EEFF', fg: '#0B3A66', border: '#A9CFF5', dot: '#3B82F6' },
    cuenta: { label: 'Cuenta', bg: '#FFE0CC', fg: '#8C3A12', border: '#F5B488', dot: '#E07A5F' },
    entregado: { label: 'Entregado', bg: '#EAF6F5', fg: '#0F4F49', border: '#BFE5E0', dot: '#14B8A6' },
    pagada: { label: 'Cuenta pagada', bg: '#F2F2F2', fg: '#3F3F46', border: '#D4D4D8', dot: '#71717A' },
    // `atencion` es la cuenta **anulada** con la visita todavía abierta: el
    // pedido se canceló pero nadie cerró la mesa. Se llamaba «Atención abierta»,
    // que no dice qué pasa ni qué hacer; la campana de la tarjeta ya avisa de que
    // reclama acción.
    atencion: { label: 'Cuenta anulada', bg: '#F3F0FF', fg: '#3B2A66', border: '#D9D2F0', dot: '#7C6BC4' },
    reservada: { label: 'Reservada', bg: '#F3F0FF', fg: '#3B2A66', border: '#D9D2F0', dot: '#7C6BC4' },
    inactiva: { label: 'Inactiva', bg: '#EFEFEF', fg: '#71717A', border: '#D4D4D8', dot: '#A1A1AA' },
};
