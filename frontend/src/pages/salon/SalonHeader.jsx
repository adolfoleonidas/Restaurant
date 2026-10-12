import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Grid2X2, ShoppingCart, Link2 } from 'lucide-react';
import { countOf } from '@/lib/format';

/**
 * Title, summary line, branch scope selector, search and the main floor buttons.
 */
export default function SalonHeader({
    branchCatalog, canTake, chooseScope, isOwner,
    navigate, openAreas, scope, search,
    searchRef, selectMode, setSearch, startSelection,
    summary,
}) {
    return (
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
                <p className="page-kicker mb-1">Salón</p>
                <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
                    <Grid2X2 className="h-6 w-6 text-primary" /> Salón
                </h1>
                <p className="text-sm text-muted-foreground" data-testid="salon-resumen">
                    En cocina: {countOf(summary.toPrep, 'plato', 'platos')} · Listos: {countOf(summary.toReady, 'plato', 'platos')} · Por cobrar: {countOf(summary.toPay, 'mesa', 'mesas')}
                </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
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
                <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-3.5 sm:top-3 text-muted-foreground" />
                    <Input ref={searchRef} className="pl-9 w-44" placeholder="Buscar mesa  ( / )" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="salon-search-input" />
                </div>
                {summary.toPrep > 0 && (
                    <Button variant="outline" onClick={() => navigate('/cocina')} data-testid="salon-ir-cocina">
                        Cocina ({summary.toPrep})
                    </Button>
                )}
                {canTake && !selectMode && (
                    <>
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
