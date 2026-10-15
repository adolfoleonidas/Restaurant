import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtMoney } from '@/lib/format';
import {
    applyMenuTemplate, deleteMenuTemplate, getMenuDay, listMenuTemplates, repeatMenuTemplate, saveMenuTemplate,
} from '@/lib/api/menu';
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
    { key: 'catalog', label: 'Catálogo' },
];

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

    useEffect(() => {
        if (!hoyServidor && data?.date && diaAbierto === undefined) setHoyServidor(data.date);
    }, [data, diaAbierto, hoyServidor]);
    // Solo los precios que el dueño ha tocado. Los demás van sin precio, para que
    // sigan el del catálogo: mandar el que se muestra lo congelaría en este día, y
    // un precio viejo arrastrado es cobrar mal sin que nadie lo note.
    const [precios, setPrecios] = useState({});
    // Tarjetas o lista: en computadora la tabla del salón es más cómoda para el
    // trabajo en bloque; en el celular, la lista compacta.
    const [modo, setModo] = useState('cards');
    const ids = useMemo(() => {
        if (seleccion) return seleccion;
        return new Set((data?.selection || []).map((item) => item.product_id));
    }, [seleccion, data]);

    // La carta fija se ofrece siempre: se refleja aquí para que la pantalla diga la
    // verdad antes de guardar, y no después.
    const catalogo = useMemo(
        () => (data?.catalog || []).map((p) => ({
            ...p,
            offered_today: p.is_fixed || ids.has(p.product_id),
            today_price: precios[p.product_id] !== undefined && precios[p.product_id] !== ''
                ? precios[p.product_id]
                : p.today_price,
        })),
        [data, ids, precios],
    );

    /** La selección que se manda al servidor, con los precios que se tocaron. */
    const seleccionParaGuardar = () => [...ids].map((product_id) => {
        const bruto = precios[product_id];
        if (bruto === undefined || bruto === '') return { product_id, price: null };
        const importe = Number(bruto);
        return { product_id, price: Number.isFinite(importe) && importe >= 0 ? importe : null };
    });

    // La semana: los siete días desde el «hoy» del servidor, con su estado real.
    // Se piden al abrir la pestaña, no al montar, para no castigar la pantalla que
    // el dueño usa a diario con siete peticiones que no va a mirar.
    const sumaDias = (fecha, dias) => {
        const d = new Date(`${fecha}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + dias);
        return d.toISOString().slice(0, 10);
    };

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
            toast.success('Menú publicado: la carta ya lo muestra');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo publicar el menú'));
        }
    };

    const guardarBorrador = async () => {
        try {
            await save(seleccionParaGuardar(), false);
            setSeleccion(null);
            toast.success('Guardado como borrador. La carta no cambia hasta publicar');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo guardar el borrador'));
        }
    };

    const traerDeOtroDia = async () => {
        if (!desde) { toast.error('Elige de qué día copiar'); return; }
        try {
            const payload = await copyFrom(desde);
            setSeleccion(null);
            toast.success(`Traídos ${payload.copied} platos del ${desde}`);
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

    return (
        <div className="space-y-4" data-testid="gestionar-menu">
            <div>
                <p className="page-kicker mb-1">Carta</p>
                <h1 className="font-display text-3xl font-semibold">Gestionar menú</h1>
                <p className="text-sm text-muted-foreground">
                    Elige lo que se vende hoy sin tocar el catálogo. Mañana empieza en blanco.
                </p>
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
                        className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'week' && (
                <section className="space-y-3" data-testid="menu-semana">
                    <p className="text-sm text-muted-foreground">
                        Los próximos siete días. Programar esta semana no repite todas las semanas:
                        eso se activará aparte, porque no es lo mismo.
                    </p>
                    {semana === null && <p className="text-sm text-muted-foreground" data-testid="menu-semana-cargando">Leyendo la semana…</p>}
                    {semana !== null && (
                        <div className="rounded-xl border border-border divide-y">
                            {semana.map(({ fecha, dia }) => (
                                <div key={fecha} className="flex items-center gap-3 px-3 py-2" data-testid={`menu-dia-${fecha}`}>
                                    <span className="tabular-nums text-sm w-28 shrink-0">{fecha}</span>
                                    <span className="min-w-0 flex-1 text-sm text-muted-foreground" data-testid={`menu-dia-estado-${fecha}`}>
                                        {dia?.published ? 'Publicado' : (dia?.has_menu ? 'Borrador' : 'Sin menú')}
                                    </span>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => { setDiaAbierto(fecha); setTab('today'); setSeleccion(null); setPrecios({}); }}
                                        data-testid={`menu-dia-abrir-${fecha}`}
                                    >
                                        Abrir
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="rounded-xl border border-border p-3 space-y-3" data-testid="menu-plantillas">
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
                    <p className="text-sm text-muted-foreground">
                        La carta fija se ofrece siempre. Lo demás solo se ofrece los días en que
                        lo pongas en el menú.
                    </p>
                    <div className="rounded-xl border border-border divide-y">
                        {(data?.catalog || []).map((p) => (
                            <div key={p.product_id} className="flex items-center gap-3 px-3 py-2" data-testid={`menu-catalogo-${p.product_id}`}>
                                <span className="min-w-0 flex-1 truncate font-medium" title={p.name}>{p.name}</span>
                                <span className="tabular-nums text-sm shrink-0">{fmtMoney(p.base_price)}</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={p.is_fixed ? 'default' : 'outline'}
                                    onClick={() => marcarFija(p.product_id, !p.is_fixed)}
                                    data-testid={`menu-fija-${p.product_id}`}
                                >
                                    {p.is_fixed ? 'Carta fija' : 'Del día'}
                                </Button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {tab === 'today' && (
                <>
                    {/* Abrir otro día desde la semana no puede ser invisible: si no,
                        se publicaría en la fecha equivocada sin darse cuenta. */}
                    {diaAbierto && (
                        <div className="flex items-center gap-2 flex-wrap rounded-xl border border-border bg-muted/40 px-3 py-2" data-testid="menu-dia-abierto">
                            <span className="text-sm font-medium">Estás editando el {diaAbierto}</span>
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
                    <div className="flex items-end gap-2 flex-wrap">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1" htmlFor="menu-desde">Copiar de otro día</label>
                            <Input
                                id="menu-desde"
                                type="date"
                                className="h-11"
                                value={desde}
                                onChange={(e) => setDesde(e.target.value)}
                                data-testid="menu-copiar-desde"
                            />
                        </div>
                        <Button type="button" variant="outline" onClick={traerDeOtroDia} disabled={saving} data-testid="menu-copiar">
                            Traer esos platos
                        </Button>
                        <div className="flex-1" />
                        <Button type="button" variant="outline" onClick={guardarBorrador} disabled={saving || loading} data-testid="menu-guardar">
                            Guardar borrador
                        </Button>
                        <Button type="button" onClick={publicar} disabled={saving || loading} data-testid="menu-publicar">
                            {saving ? 'Guardando…' : 'Publicar menú'}
                        </Button>
                    </div>

                    {loading && <p className="text-sm text-muted-foreground" data-testid="menu-cargando">Cargando…</p>}
                    {error && <p className="text-sm text-destructive" data-testid="menu-error">{error}</p>}

                    {!loading && !error && (
                        <MenuDayView
                            catalog={catalogo}
                            mode={modo}
                            onModeChange={setModo}
                            saving={saving}
                            onToggleOffered={alternarOfrecido}
                            onToggleSoldOut={alternarAgotado}
                            onPriceChange={(productId, valor) => setPrecios((previos) => ({ ...previos, [productId]: valor }))}
                            onBulkOffer={alternarVarios}
                        />
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
