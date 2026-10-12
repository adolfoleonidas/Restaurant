import React from 'react';

/**
 * Tabs to charge the whole account, by items or in equal parts, plus the equal-parts stepper.
 */
export default function ScopeTabs({
    part, payMode, people, setDetailOpen,
    setPart, setPayMode, setPeople,
}) {
    return (
        <>
            {/* Scope Tabs */}
            <div className="scope-tabs" role="tablist" aria-label="Como dividir la cuenta">
                {[['all', 'Toda la cuenta'], ['items', 'Por items'], ['equal', 'Partes iguales']].map(([k, lab]) => (
                    <button key={k} className="scope-tab" role="tab" aria-selected={payMode === k} onClick={() => { setPayMode(k); if (k === 'items') setDetailOpen(true); }}>
                        {lab}
                    </button>
                ))}
            </div>

            {/* Split settings */}
            {payMode === 'equal' && (
                <div className="split-settings">
                    <span className="split-label">Dividir entre</span>
                    <div className="stepper">
                        <button onClick={() => people > 2 && setPeople(people - 1)} disabled={people <= 2} aria-label="Una persona menos">-</button>
                        <output aria-label="Numero de personas">{people}</output>
                        <button onClick={() => people < 12 && setPeople(people + 1)} disabled={people >= 12} aria-label="Una persona mas">+</button>
                    </div>
                    <select className="split-select" value={part} onChange={(e) => setPart(Number(e.target.value))}>
                        {Array.from({ length: people }, (_, i) => (
                            <option key={i} value={i}>Parte {i + 1}</option>
                        ))}
                    </select>
                </div>
            )}
        </>
    );
}
