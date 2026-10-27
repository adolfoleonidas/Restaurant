import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Eye } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { fmtMoney } from '@/lib/format';
import {
    applyMenuTemplate, deleteMenuTemplate, getMenuDay, listMenuTemplates, repeatMenuTemplate, saveMenuTemplate,
} from '@/lib/api/menu';
import { listCategories } from '@/lib/api/categories';
import { toast } from 'sonner';

import MenuDayView from './MenuDayView';
import useMenuDay from './useMenuDay';
import { updateProduct } from '@/lib/api/products';
import { apiErrorMessage } from '@/lib/apiError';
import ConfirmDialog from '@/components/ConfirmDialog';

/**
 * «Gestionar menú»: qué se vende hoy.
 *
 * La fecha la decide el servidor (y con su zona horaria): si la calculara el
 * navegador, un dispositivo con la hora mal puesta publicaría el menú del día
 * equivocado —y el menú va justo por fecha, así que eso es publicar en el día que
 * no es—.
 *
 * La selección de hoy se edita en local y se envía al guardar: así el dueño puede
 * montar el menú entero y publicarlo de una vez, en vez de mandar una petición por
 * cada interruptor que toca.
 */
const TABS = [
    { key: 'today', label: 'Hoy' },
    { key: 'week', label: 'Semana' },
    { key: 'catalog', label: 'Carta fija' },
];

const LONG_DATE = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
const SHORT_DATE = new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', month: 'short' });

function dayDate(value) {
    return value ? new Date(`${value}T12:00:00`) : null;
}

function longDate(value) {
    const date = dayDate(value);
    return date ? LONG_DATE.format(date) : '';
}

function shortDate(value, today) {
    if (!value) return '';
    if (value === today) return 'Hoy';
    const date = dayDate(value);
    if (!date) return value;
    return SHORT_DATE.format(date);
}

function sumaDias(fecha, dias) {
    const d = new Date(`${fecha}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

export default function GestionarMenu() {
    // El día que se está editando. `undefined` = hoy, y quien decide cuál es hoy es
    // el servidor (con su zona horaria): un dispositivo con la hora mal puesta
    // publicaría el menú del día equivocado.
    const [diaAbierto, setDiaAbierto] = useState(undefined);
    const { data, loading, error, saving, save, toggleSoldOut, copyFrom, reload } = useMenuDay(diaAbierto);
    const [tab, setTab] = useState('today');
    const [seleccion, setSeleccion] = useState(null);
    const [desde, setDesde] = useState('');
    // El «hoy» del servidor, que llega en el primer día cargado. Se guarda aparte
    // para que la semana no se mueva cuando el dueño abre otro día.
    const [hoyServidor, setHoyServidor] = useState(null);
    const [semana, setSemana] = useState(null);
    // Plantillas: una selección con nombre para no volver a montar el mismo menú.
    const [plantillas, setPlantillas] = useState(null);
    const [nombre, setNombre] = useState('');
    // Días para repetir. Vacío a propósito: no hay repetición por defecto.
    const [diasRepetir, setDiasRepetir] = useState([]);
    const [semanas, setSemanas] = useState(1);
    // Plantilla esperando confirmación de borrado, y la que está en vuelo: borrar
    // es destructivo y el botón no tenía ni diálogo ni guarda de doble envío.
    const [porBorrar, setPorBorrar] = useState(null);
    const [borrando, setBorrando] = useState(false);
    const [plantillasError, setPlantillasError] = useState(null);
    // Nombres de categoría para agrupar el catálogo. La pantalla funciona sin
    // ellos: si el catálogo no trae `category_id` (o la lectura falla), todo cae
    // en un grupo «Carta» y no se pierde ningún plato.
    const [categorias, setCategorias] = useState([]);

    useEffect(() => {
        if (!hoyServidor && data?.date && diaAbierto === undefined) setHoyServidor(data.date);
    }, [data, diaAbierto, hoyServidor]);

    const tieneCategorias = useMemo(
        () => (data?.catalog || []).some((product) => product.category_id),
        [data?.catalog],
    );
    useEffect(() => {
        if (!tieneCategorias) return undefined;
        let vivo = true;
        listCategories()
            .then(({ data: filas }) => { if (vivo) setCategorias(Array.isArray(filas) ? filas : []); })
            .catch(() => { /* el agrupado cae a «Carta» */ });
        return () => { vivo = false; };
    }, [tieneCategorias, data?.date]);
    // Solo los precios que el dueño ha tocado. Los demás van sin precio, para que
    // sigan el del catálogo: mandar el que se muestra lo congelaría en este día, y
    // un precio viejo arrastrado es cobrar mal sin que nadie lo note.
    const [precios, setPrecios] = useState({});
    // Tarjetas o lista: en computadora la tabla del salón es más cómoda para el
    // trabajo en bloque; en el celular, la lista compacta.
    const [modo, setModo] = useState(() => (
        typeof window !== 'undefined' && window.innerWidth < 768 ? 'list' : 'cards'
    ));
    // La lista compacta es la vista natural del teléfono; si la ventana cambió
    // de tamaño antes de montar, se corrige una vez sin pisar la elección manual.
    useEffect(() => {
        if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches) {
            setModo((actual) => (actual === 'cards' ? 'list' : actual));
        }
    }, []);
    const ids = useMemo(() => {
        if (seleccion) return seleccion;
        return new Set((data?.selection || []).map((item) => item.product_id));
    }, [seleccion, data]);

    // La carta fija se ofrece siempre: se refleja aquí para que la pantalla diga la
    // verdad antes de guardar, y no después. `price_override` separa lo que hoy se
    // escribe (borrador local) del precio efectivo que muestra el servidor.
    const catalogo = useMemo(
        () => (data?.catalog || []).map((p) => {
            const guardado = (data?.selection || []).find((item) => item.product_id === p.product_id)?.price;
            const borrador = precios[p.product_id];
            return {
                ...p,
                offered_today: p.is_fixed || ids.has(p.product_id),
                price_override: borrador !== undefined ? borrador : (guardado ?? null),
                today_price: borrador !== undefined && borrador !== '' ? borrador : p.today_price,
            };
        }),
        [data, ids, precios],
    );

    const ofrecidos = catalogo.filter((product) => product.offered_today).length;
    const agotados = catalogo.filter((product) => product.sold_out).length;
    const ayer = data?.date ? sumaDias(data.date, -1) : null;

    /**
     * La selección que se manda al servidor. Los precios que el dueño no tocó
     * conservan el que ya tenía el día: si no, guardar otro cambio borraría en
     * silencio el precio especial de hoy.
     */
    const seleccionParaGuardar = () => [...ids].map((product_id) => {
        const bruto = precios[product_id];
        const guardado = (data?.selection || []).find((item) => item.product_id === product_id)?.price ?? null;
        if (bruto === undefined) return { product_id, price: guardado };
        if (bruto === '') return { product_id, price: null };
        const importe = Number(bruto);
        return { product_id, price: Number.isFinite(importe) && importe >= 0 ? importe : null };
    });

    /** ¿Hay cambios locales que todavía no se guardaron? */
    const dirty = useMemo(() => {
        if (!data) return false;
        const guardados = new Map((data.selection || []).map((item) => [item.product_id, item.price ?? null]));
        if (ids.size !== guardados.size) return true;
        for (const product_id of ids) {
            if (!guardados.has(product_id)) return true;
            if (precios[product_id] === undefined) continue;
            const siguiente = precios[product_id] === '' ? null : Number(precios[product_id]);
            if (!Number.isFinite(siguiente) && precios[product_id] !== '') return true;
            if (siguiente !== guardados.get(product_id)) return true;
        }
        return false;
    }, [data, ids, precios]);

    // La semana: los siete días desde el «hoy» del servidor, con su estado real.
    // Se piden al abrir la pestaña, no al montar, para no castigar la pantalla que
    // el dueño usa a diario con siete peticiones que no va a mirar.
    /** Los siete días desde el «hoy» del servidor, con su estado real. */
    const cargarSemana = useCallback(async () => {
        if (!hoyServidor) return;
        const fechas = Array.from({ length: 7 }, (_, i) => sumaDias(hoyServidor, i));
        const filas = await Promise.all(fechas.map((fecha) => (
            getMenuDay(fecha).then((r) => ({ fecha, dia: r.data })).catch(() => ({ fecha, dia: null }))
        )));
        setSemana(filas);
    }, [hoyServidor]);

    useEffect(() => {
        if (tab !== 'week' || !hoyServidor) return;
        setSemana(null);
        cargarSemana();
    }, [tab, hoyServidor, cargarSemana]);

    // Las plantillas se piden al abrir la semana, igual que los días.
    useEffect(() => {
        if (tab !== 'week') return;
        let vivo = true;
        setPlantillasError(null);
        listMenuTemplates()
            .then((r) => { if (vivo) setPlantillas(r.data || []); })
            // Antes el fallo dejaba `[]`, y la pantalla decía «Todavía no hay
            // plantillas»: el dueño no podía distinguir que no tiene ninguna de
            // que la lista no llegó.
            .catch((e) => {
                if (vivo) {
                    setPlantillas([]);
                    setPlantillasError(apiErrorMessage(e, 'No se pudieron leer las plantillas'));
                }
            });
        return () => { vivo = false; };
    }, [tab]);

    const recargarPlantillas = async () => {
        const { data: filas } = await listMenuTemplates();
        setPlantillas(filas || []);
    };

    const guardarPlantilla = async () => {
        try {
            const { data } = await saveMenuTemplate({ name: nombre, from_date: diaAbierto || hoyServidor });
            await recargarPlantillas();
            setNombre('');
            toast.success(data.replaced
                ? `Plantilla «${data.name}» actualizada con ${data.count} platos`
                : `Plantilla «${data.name}» guardada con ${data.count} platos`);
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo guardar la plantilla'));
        }
    };

    const usarPlantilla = async (plantilla) => {
        try {
            const { data } = await applyMenuTemplate(plantilla.id, { date: diaAbierto });
            toast.success(`${data.applied} platos traídos de «${data.template}». Guarda o publica para aplicarlo`);
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo usar la plantilla'));
        }
    };

    const borrarPlantilla = async (plantilla) => {
        if (!plantilla || borrando) return;
        setBorrando(true);
        try {
            await deleteMenuTemplate(plantilla.id);
            await recargarPlantillas();
            toast.success('Plantilla borrada');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo borrar'));
        } finally {
            setBorrando(false);
        }
    };

    const alternarDiaRepetir = (dia) => {
        setDiasRepetir((previos) => (previos.includes(dia) ? previos.filter((d) => d !== dia) : [...previos, dia]));
    };

    const repetirPlantilla = async (plantilla) => {
        // Sin días no se manda nada: no hay repetición por defecto, y adivinar
        // «toda la semana» sería programar algo que nadie pidió.
        if (diasRepetir.length === 0) { toast.error('Elige qué días repetir'); return; }
        try {
            const { data } = await repeatMenuTemplate(plantilla.id, {
                from_date: hoyServidor,
                weekdays: diasRepetir,
                weeks: semanas,
            });
            await cargarSemana();
            if (diaAbierto) await reload();
            toast.success(`«${data.template}» en ${data.count === 1 ? '1 día' : `${data.count} días`}: ${data.days.join(', ')}`);
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo repetir'));
        }
    };

    const publicar = async () => {
        try {
            await save(seleccionParaGuardar(), true);
            setSeleccion(null);
            setPrecios({});
            toast.success('Menú publicado: la carta ya lo muestra');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo publicar el menú'));
        }
    };

    const guardarBorrador = async () => {
        try {
            await save(seleccionParaGuardar(), false);
            setSeleccion(null);
            setPrecios({});
            toast.success('Guardado como borrador. La carta no cambia hasta publicar');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo guardar el borrador'));
        }
    };

    const traerDeOtroDia = async (fecha = desde) => {
        if (!fecha) { toast.error('Elige de qué día copiar'); return; }
        try {
            const payload = await copyFrom(fecha);
            setSeleccion(null);
            setPrecios({});
            toast.success(`Traídos ${payload.copied} platos del ${fecha}. Revisa y publica para que la carta cambie.`);
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo copiar ese día'));
        }
    };

    const alternarOfrecido = (productId, ofrecer) => {
        const siguiente = new Set(ids);
        if (ofrecer) siguiente.add(productId); else siguiente.delete(productId);
        setSeleccion(siguiente);
    };

    /** Trabajo en bloque: el mismo cambio para varios platos de una vez. */
    const alternarVarios = (productIds, ofrecer) => {
        const siguiente = new Set(ids);
        for (const productId of productIds) {
            if (ofrecer) siguiente.add(productId); else siguiente.delete(productId);
        }
        setSeleccion(siguiente);
    };

    const alternarAgotado = async (productId, agotado) => {
        try {
            await toggleSoldOut(productId, agotado);
            toast.success(agotado ? 'Agotado. Los pedidos ya tomados siguen' : 'Vuelve a la carta');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo marcar'));
        }
    };

    /**
     * Carta fija: se ofrece siempre, sin volver a seleccionarla cada mañana.
     *
     * Es lo que evita que publicar un menú del día esconda las bebidas: sin esto,
     * todo lo que no esté en el menú de hoy desaparece de la carta.
     */
    const marcarFija = async (productId, fija) => {
        try {
            await updateProduct(productId, { is_fixed: fija });
            await reload();
            toast.success(fija
                ? 'Carta fija: se ofrecerá siempre, sin depender del menú del día'
                : 'Del día: solo se ofrecerá si lo pones en el menú de hoy');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo cambiar'));
        }
    };

    const fijos = catalogo.filter((product) => product.is_fixed).length;
    const estado = !data
        ? null
        : data.published
            ? { label: 'Publicado', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' }
            : data.has_menu
                ? { label: 'Borrador', className: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200' }
                : ids.size > 0
                    ? { label: 'Sin guardar', className: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200' }
                    : fijos > 0
                        ? { label: 'Solo carta fija', className: 'border-border bg-muted text-muted-foreground' }
                        : { label: 'Sin menú', className: 'border-border bg-muted text-muted-foreground' };
    const pageTitle = tab === 'today' ? 'Menú de hoy' : tab === 'week' ? 'Semana del menú' : 'Carta fija';
    const pageSubtitle = tab === 'today'
        ? <> Elige qué se vende hoy. <strong>Guardar</strong> deja un borrador; <strong>Publicar</strong> es lo que cambia la carta del cliente. </>
        : tab === 'week'
            ? 'Revisa los próximos siete días y abre el que quieras editar.'
            : 'Decide qué platos se ofrecen todos los días, sin volver a elegirlos cada mañana.';

    return (
        <div className={`space-y-4 ${tab === 'today' ? 'pb-32 md:pb-0' : ''}`} data-testid="gestionar-menu">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                    <p className="page-kicker mb-1">Carta</p>
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="font-display text-3xl font-semibold">{pageTitle}</h1>
                        {tab === 'today' && estado && (
                            <span data-testid="menu-estado" className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${estado.className}`}>
                                {estado.label}
                            </span>
                        )}
                        {tab === 'today' && dirty && data?.has_menu && (
                            <span data-testid="menu-cambios" className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">
                                Cambios sin guardar
                            </span>
                        )}
                    </div>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{pageSubtitle}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {tab === 'today' && data?.date && (
                            <span className="inline-flex items-center gap-1">
                                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                                {longDate(data.date)}
                            </span>
                        )}
                        {tab === 'today' && data && (
                            <span>
                                {ofrecidos} de {catalogo.length} platos ofrecidos
                                {agotados > 0 ? ` · ${agotados} agotado${agotados === 1 ? '' : 's'}` : ''}
                            </span>
                        )}
                        <a className="inline-flex min-h-6 items-center gap-1 text-primary underline-offset-2 hover:underline" href="/menu" target="_blank" rel="noreferrer">
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Ver carta
                        </a>
                    </div>
                </div>

                {/* Una sola barra de acciones: fija sobre la navegación en móvil y
                    estática a la derecha en escritorio. Evita duplicar botones y
                    solo existe en «Hoy»: guardar/publicar pertenecen al día. */}
                {tab === 'today' && <div className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+var(--safe-bottom))] z-30 border-t bg-card p-3 md:static md:inset-auto md:z-auto md:border-0 md:bg-transparent md:p-0">
                    <div className="mb-2 min-w-0 md:hidden">
                        <p className="text-sm font-semibold">{dirty ? 'Cambios sin guardar' : (data?.published ? 'Publicado' : 'Sin cambios')}</p>
                        <p className="text-xs text-muted-foreground">{ofrecidos} de {catalogo.length} platos ofrecidos</p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="h-11 flex-1 md:flex-none"
                            onClick={guardarBorrador}
                            disabled={saving || loading || !data || Boolean(error)}
                            data-testid="menu-guardar"
                        >
                            {saving ? 'Guardando…' : 'Guardar borrador'}
                        </Button>
                        <Button
                            type="button"
                            className="h-11 flex-1 md:flex-none"
                            onClick={publicar}
                            disabled={saving || loading || !data || Boolean(error) || ofrecidos === 0}
                            title={ofrecidos === 0
                                ? 'Ofrece al menos un plato para publicar el menú'
                                : undefined}
                            data-testid="menu-publicar"
                        >
                            {saving ? 'Guardando…' : 'Publicar menú'}
                        </Button>
                    </div>
                </div>}
            </div>

            <div className="flex items-center gap-1 border-b" role="tablist" aria-label="Secciones">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.key}
                        onClick={() => setTab(t.key)}
                        data-testid={`menu-tab-${t.key}`}
                        className={`min-h-11 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'week' && (
                <section className="space-y-3" data-testid="menu-semana">
                    <div className="rounded-xl border border-border bg-card p-3">
                        <p className="text-sm font-medium">Próximos siete días</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Abre un día para editarlo. Programar esta semana no repite todas las semanas:
                            eso se activará aparte, porque no es lo mismo.
                        </p>
                    </div>
                    {semana === null && <p className="text-sm text-muted-foreground" data-testid="menu-semana-cargando">Leyendo la semana…</p>}
                    {semana !== null && (
                        <div className="overflow-hidden rounded-xl border border-border bg-card divide-y">
                            {semana.map(({ fecha, dia }) => {
                                const weekState = dia?.published
                                    ? { label: 'Publicado', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' }
                                    : dia?.has_menu
                                        ? { label: 'Borrador', className: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200' }
                                        : { label: 'Sin menú', className: 'border-border bg-muted text-muted-foreground' };
                                const isToday = fecha === hoyServidor;
                                return (
                                    <div
                                        key={fecha}
                                        className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${isToday ? 'bg-primary/5' : ''}`}
                                        data-testid={`menu-dia-${fecha}`}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium">{shortDate(fecha, hoyServidor)}</p>
                                            <p className="text-xs tabular-nums text-muted-foreground">{fecha}</p>
                                        </div>
                                        <span
                                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${weekState.className}`}
                                            data-testid={`menu-dia-estado-${fecha}`}
                                        >
                                            {weekState.label}
                                        </span>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => { setDiaAbierto(fecha); setTab('today'); setSeleccion(null); setPrecios({}); }}
                                            data-testid={`menu-dia-abrir-${fecha}`}
                                        >
                                            {isToday ? 'Editar hoy' : 'Abrir'}
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="rounded-xl border border-border bg-card p-3 space-y-3" data-testid="menu-plantillas">
                        <div>
                            <p className="text-sm font-medium">Plantillas de menú</p>
                            <p className="text-xs text-muted-foreground">
                                Guarda una selección para reutilizarla en otro día. No guarda precios ni el estado de agotado.
                            </p>
                        </div>
                        <div className="flex items-end gap-2 flex-wrap">
                            <div className="min-w-[12rem] flex-1">
                                <label className="block text-xs text-muted-foreground mb-1" htmlFor="menu-plantilla-nombre">
                                    Guardar {diaAbierto ? `el ${diaAbierto}` : 'hoy'} como plantilla
                                </label>
                                <Input
                                    id="menu-plantilla-nombre"
                                    className="h-11"
                                    placeholder="Almuerzo habitual"
                                    value={nombre}
                                    onChange={(e) => setNombre(e.target.value)}
                                    data-testid="menu-plantilla-nombre"
                                />
                            </div>
                            <Button type="button" variant="outline" onClick={guardarPlantilla} data-testid="menu-plantilla-guardar">
                                Guardar plantilla
                            </Button>
                        </div>

                        <div>
                            <p className="text-xs text-muted-foreground mb-1">
                                Repetir en (elige los días — nada se repite solo):
                            </p>
                            <div className="flex items-center gap-1 flex-wrap" data-testid="menu-repetir-dias">
                                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((etiqueta, indice) => (
                                    <Button
                                        key={etiqueta}
                                        type="button"
                                        size="sm"
                                        variant={diasRepetir.includes(indice) ? 'default' : 'outline'}
                                        aria-pressed={diasRepetir.includes(indice)}
                                        onClick={() => alternarDiaRepetir(indice)}
                                        data-testid={`menu-repetir-dia-${indice}`}
                                    >
                                        {etiqueta}
                                    </Button>
                                ))}
                                <Input
                                    type="number"
                                    min="1"
                                    max="8"
                                    className="h-9 w-16"
                                    aria-label="Semanas"
                                    value={semanas}
                                    onChange={(e) => setSemanas(Number(e.target.value) || 1)}
                                    data-testid="menu-repetir-semanas"
                                />
                                <span className="text-xs text-muted-foreground">semanas</span>
                            </div>
                        </div>

                        {plantillas === null && <p className="text-sm text-muted-foreground" data-testid="menu-plantillas-cargando">Leyendo plantillas…</p>}
                        {plantillasError && (
                            <p className="text-sm text-destructive" data-testid="menu-plantillas-error">{plantillasError}</p>
                        )}
                        {plantillas !== null && plantillas.length === 0 && !plantillasError && (
                            <p className="text-sm text-muted-foreground" data-testid="menu-plantillas-vacio">
                                Todavía no hay plantillas. Guarda un día que te guste y reutilízalo.
                            </p>
                        )}
                        {plantillas !== null && plantillas.map((plantilla) => (
                            <div key={plantilla.id} className="flex items-center gap-2 flex-wrap border-t pt-2" data-testid={`menu-plantilla-${plantilla.id}`}>
                                <span className="min-w-0 flex-1 truncate font-medium" title={plantilla.name}>{plantilla.name}</span>
                                <span className="text-xs text-muted-foreground shrink-0">{plantilla.count} platos</span>
                                <Button type="button" size="sm" onClick={() => usarPlantilla(plantilla)} data-testid={`menu-plantilla-usar-${plantilla.id}`}>
                                    Usar {diaAbierto ? `en el ${diaAbierto}` : 'hoy'}
                                </Button>
                                <Button type="button" size="sm" variant="outline" onClick={() => repetirPlantilla(plantilla)} data-testid={`menu-plantilla-repetir-${plantilla.id}`}>
                                    Repetir
                                </Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setPorBorrar(plantilla)} disabled={borrando} data-testid={`menu-plantilla-borrar-${plantilla.id}`}>
                                    Borrar
                                </Button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {tab === 'catalog' && (
                <section className="space-y-3" data-testid="menu-catalogo">
                    <div className="rounded-xl border border-border bg-card p-3">
                        <p className="text-sm font-medium">Carta fija</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Un plato de carta fija se ofrece todos los días (bebidas, clásicos). Uno «del día»
                            solo aparece si lo agregas al menú de hoy.
                        </p>
                    </div>
                    <div className="divide-y overflow-hidden rounded-xl border border-border bg-card">
                        {(data?.catalog || []).map((p) => {
                            const category = categorias.find((item) => item.id === p.category_id)?.name;
                            return (
                                <div key={p.product_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-testid={`menu-catalogo-${p.product_id}`}>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium" title={p.name}>{p.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {category ? `${category} · ` : ''}{fmtMoney(p.base_price)}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium text-muted-foreground">
                                            {p.is_fixed ? 'Siempre' : 'Solo del día'}
                                        </span>
                                        <Switch
                                            checked={Boolean(p.is_fixed)}
                                            onCheckedChange={(value) => marcarFija(p.product_id, value)}
                                            aria-label={`${p.name}: ${p.is_fixed ? 'quitar de carta fija' : 'marcar como carta fija'}`}
                                            data-testid={`menu-fija-${p.product_id}`}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {tab === 'today' && (
                <>
                    {/* Abrir otro día desde la semana no puede ser invisible: si no,
                        se publicaría en la fecha equivocada sin darse cuenta. */}
                    {diaAbierto && (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2" data-testid="menu-dia-abierto">
                            <CalendarDays className="h-4 w-4 shrink-0 text-amber-800 dark:text-amber-200" aria-hidden="true" />
                            <span className="min-w-0 flex-1 text-sm font-medium">
                                Estás editando el <strong>{diaAbierto}</strong>, no el menú de hoy.
                            </span>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => { setDiaAbierto(undefined); setSeleccion(null); setPrecios({}); }}
                                data-testid="menu-volver-hoy"
                            >
                                Volver a hoy
                            </Button>
                        </div>
                    )}

                    {loading && (
                        <div className="rounded-xl border border-border bg-card p-4">
                            <p className="text-sm text-muted-foreground" data-testid="menu-cargando">Cargando el menú de hoy…</p>
                        </div>
                    )}
                    {error && (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                            <p className="min-w-0 flex-1 text-sm text-destructive" data-testid="menu-error">{error}</p>
                            <Button type="button" size="sm" variant="outline" onClick={reload}>Reintentar</Button>
                        </div>
                    )}

                    {!loading && !error && (
                        <>
                            {catalogo.length > 0 && ofrecidos === 0 && (
                                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3" data-testid="menu-sin-ofrecidos">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold">Hoy no ofreces ningún plato del menú.</p>
                                        <p className="text-xs text-muted-foreground">
                                            La carta mostrará solo la carta fija. Copia el menú de ayer o elige platos abajo.
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => traerDeOtroDia(ayer)}
                                        disabled={!ayer || saving}
                                        data-testid="menu-copiar-ayer"
                                    >
                                        Copiar el menú de ayer
                                    </Button>
                                </div>
                            )}

                            <details className="group rounded-xl border border-border bg-card px-3 py-2" data-testid="menu-copiar-panel">
                                <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-sm font-medium">
                                    <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    Copiar platos de otro día
                                    <span className="ml-auto hidden text-xs font-normal text-muted-foreground sm:inline">
                                        No copia precios ni el estado de agotado
                                    </span>
                                </summary>
                                <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                                    <div>
                                        <label className="mb-1 block text-xs text-muted-foreground" htmlFor="menu-desde">Día de origen</label>
                                        <Input
                                            id="menu-desde"
                                            type="date"
                                            className="h-11"
                                            value={desde}
                                            max={data?.date || undefined}
                                            onChange={(e) => setDesde(e.target.value)}
                                            data-testid="menu-copiar-desde"
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-11"
                                        onClick={() => traerDeOtroDia()}
                                        disabled={saving}
                                        data-testid="menu-copiar"
                                    >
                                        Traer esos platos
                                    </Button>
                                    {ayer && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="h-11"
                                            onClick={() => traerDeOtroDia(ayer)}
                                            disabled={saving}
                                            data-testid="menu-copiar-ayer-panel"
                                        >
                                            Usar el de ayer
                                        </Button>
                                    )}
                                </div>
                            </details>

                            <MenuDayView
                                catalog={catalogo}
                                categories={categorias}
                                mode={modo}
                                onModeChange={setModo}
                                saving={saving}
                                onToggleOffered={alternarOfrecido}
                                onToggleSoldOut={alternarAgotado}
                                onPriceChange={(productId, valor) => setPrecios((previos) => ({ ...previos, [productId]: valor }))}
                                onBulkOffer={alternarVarios}
                            />
                        </>
                    )}
                </>
            )}

            <ConfirmDialog
                open={Boolean(porBorrar)}
                title={`¿Borrar la plantilla «${porBorrar?.name}»?`}
                description="La plantilla se elimina; los menús ya publicados con ella no cambian."
                confirmLabel="Borrar"
                pending={borrando}
                onCancel={() => setPorBorrar(null)}
                onConfirm={() => { const plantilla = porBorrar; setPorBorrar(null); borrarPlantilla(plantilla); }}
            />
        </div>
    );
}
