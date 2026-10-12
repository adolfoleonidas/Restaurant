import { createContext, useContext } from 'react';

const EMPTY = new Set();

/**
 * Keys of the floor actions in flight (`deliver:<orderId>`, `bill:<orderId>`,
 * `release:<tableId>`...). The Salón provides it so any card, menu or bar button
 * can show its own pending label without every prop being threaded down.
 */
export const PendingActionsContext = createContext(EMPTY);

export const usePendingActions = () => useContext(PendingActionsContext);
