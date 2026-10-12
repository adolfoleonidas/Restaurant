/**
 * One word per concept for the whole UI. Screens import from here instead of
 * choosing their own synonym ("servir"/"entregar", "cancelar"/"anular", ...).
 * The register is tuteo (Peru).
 */
export const GLOSSARY = {
    // Taking food to the table.
    serve: {
        action: 'Entregar',
        done: 'Entregado',
        ready: 'Listo para entregar',
        pending: 'Por entregar',
    },
    kitchen: 'Cocina',
    // "Cancelar" only dismisses a dialog; money and orders are "anulados".
    cancel: {
        dismiss: 'Cancelar',
        void: 'Anular',
        voided: 'Anulado',
        voidedPlural: 'Anulados',
        order: 'Pedido anulado',
    },
    shift: 'Turno',
    menu: 'Carta',
    team: 'Equipo',
};

/** Deployment environment as the system panel shows it. */
export const ENVIRONMENT_LABELS = {
    production: 'Producción',
    development: 'Desarrollo',
    test: 'Pruebas',
    staging: 'Preproducción',
};

/** Record counts of the system panel (the API sends English collection names). */
export const RECORD_LABELS = {
    tables: 'Mesas',
    products: 'Platos',
    categories: 'Categorías',
    users: 'Usuarios',
    orders: 'Pedidos',
    payments: 'Pagos',
    branches: 'Sucursales',
    zones: 'Zonas',
};
