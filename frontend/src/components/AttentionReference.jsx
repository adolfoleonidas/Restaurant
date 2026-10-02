import React from 'react';

export function validBusinessDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= monthDays[month - 1];
}

export function hasAttentionReference(order) {
    const number = order?.attention_number;
    return order?.order_type !== 'delivery'
        && order?.acceptance_status === 'aceptado'
        && typeof number === 'number'
        && Number.isSafeInteger(number)
        && number > 0
        && validBusinessDate(order?.attention_business_date);
}

export default function AttentionReference({ order, branchNames = null, branchName = null, publicView = false, className = '' }) {
    if (!hasAttentionReference(order)) return null;
    const resolvedBranch = branchName || (!publicView && order.branch_id ? branchNames?.[order.branch_id] || order.branch_id : null);
    return (
        <div className={`text-xs text-muted-foreground ${className}`} data-testid="attention-reference">
            <span>Atención {order.attention_number}</span>
            <span> · {order.attention_business_date}</span>
            {!publicView && resolvedBranch && <span> · {resolvedBranch}</span>}
        </div>
    );
}
