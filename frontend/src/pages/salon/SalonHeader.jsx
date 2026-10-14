import React from 'react';
import { Grid2X2, Link2, Search, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { countOf, fmtMoney } from '@/lib/format';

export default function SalonHeader({ summary, floorDue, isOwner, branchCatalog, scope, chooseScope, searchRef, search, setSearch, navigate, canTake, canGoKitchen, selectMode, startSelection, openAreas, searchOpen = false, onToggleFilters }) {
    return (
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
                <p className="page-kicker mb-1">Salón</p>
                <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
                    <Grid2X2 className="h-6 w-6 text-primary" /> Salón
                </h1>
                <p className="text-sm text-muted-foreground" data-testid="salon-resumen">
                    En cocina: {countOf(summary.toPrep, 'plato', 'platos')} · Listos: {countOf(summary.toReady, 'plato', 'platos')} · Por cobrar: {countOf(summary.toPay, 'mesa', 'mesas')} ·{' '}
                    <span data-testid="salon-total-en-mesas">{fmtMoney(floorDue)} en mesas</span>
                </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
                {/* Buscar y filtrar están plegados por defecto: en el teléfono
                    empujaban la lista de mesas fuera de la pantalla y el mozo tenía
                    que desplazarse para ver una sola. Quien los usa siempre los deja
                    abiertos: la elección se recuerda por dispositivo. */}
                <Button
                    variant="outline"
                    onClick={onToggleFilters}
                    aria-expanded={searchOpen}
                    data-testid="salon-toggle-filtros"
                >
                    <Search className="h-4 w-4 mr-2" />
                    {searchOpen ? 'Ocultar filtros' : 'Buscar y filtros'}
                </Button>
                {isOwner && branchCatalog.branches.length > 0 && (
                    <select
                        aria-label="Sucursal del salón"
                        data-testid="salon-sucursal"
                        className="h-11 rounded-sm border border-input bg-background px-3 text-sm sm:h-10"
                        value={scope || ''}
                        onChange={(e) => chooseScope(e.target.value)}
                        disabled={branchCatalog.loading}
                    >
                        {branchCatalog.branches.map((branch) => (
                            <option key={branch.id} value={`branch:${branch.id}`}>{branch.name}</option>
                        ))}
                        <option value="legacy">Sin sucursal</option>
                    </select>
                )}
                {searchOpen && (
                    <div className="relative">
                        <Search className="h-4 w-4 absolute left-3 top-3.5 sm:top-3 text-muted-foreground" />
                        <Input ref={searchRef} className="pl-9 w-44" placeholder="Buscar mesa  ( / )" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="salon-search-input" />
                    </div>
                )}
                {canGoKitchen && summary.toPrep > 0 && (
                    <Button variant="outline" onClick={() => navigate('/cocina')} data-testid="salon-ir-cocina">
                        Cocina ({summary.toPrep})
                    </Button>
                )}
                {canTake && !selectMode && (
                    <>
                        {/* Unir mesas se queda a la vista: juntar dos mesas es una
                            operación del servicio, no un ajuste de la vista. Lo que
                            se pliega es buscar y filtrar. */}
                        <Button variant="outline" onClick={startSelection} data-testid="salon-unir-mesas">
                            <Link2 className="h-4 w-4 mr-1" /> Unir mesas
                        </Button>
                        <Button onClick={() => openAreas()} data-testid="salon-nuevo-pedido">
                            <ShoppingCart className="h-4 w-4 mr-1" /> Nuevo pedido
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
