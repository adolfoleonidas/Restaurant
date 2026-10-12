import React from 'react';
import {
    TABLE_STATUS_LABELS, ORDER_STATUS_LABELS, TABLE_STATE_CLASS, ORDER_STATE_CLASS, TABLE_STATE_DOT, ORDER_STATE_DOT,
} from '@/constants/status';

export const StateBadge = ({ status, type = 'table', testId, className = '' }) => {
    const isTable = type === 'table';
    const labels = isTable ? TABLE_STATUS_LABELS : ORDER_STATUS_LABELS;
    const klass = isTable ? TABLE_STATE_CLASS[status] : ORDER_STATE_CLASS[status];
    const dotColor = isTable ? TABLE_STATE_DOT[status] : ORDER_STATE_DOT[status];
    return (
        <span
            data-testid={testId || `${type}-estado-badge`}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium border ${klass || ''} ${className}`}
        >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dotColor }} data-testid={`${type}-estado-dot`} />
            {labels[status] || status}
        </span>
    );
};
