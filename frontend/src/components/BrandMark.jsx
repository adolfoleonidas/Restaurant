import React from 'react';

export function BrandMark({ name = 'Sabor Peruano', kicker = 'Barranco · Lima', compact = false }) {
    return (
        <div className="flex items-center gap-2.5 min-w-0">
            <div
                className={`shrink-0 rotate-45 bg-primary ${compact ? 'h-7 w-7' : 'h-8 w-8'}`}
                aria-hidden
            />
            <div className="min-w-0 -ml-0.5">
                <div className={`font-display italic leading-tight truncate ${compact ? 'text-base' : 'text-lg'} font-semibold`}>
                    {name}
                </div>
                {!compact && kicker ? (
                    <div className="page-kicker truncate">{kicker}</div>
                ) : null}
            </div>
        </div>
    );
}
