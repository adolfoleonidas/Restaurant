import { fmtMoney } from '@/lib/format';

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

export function printCajaReceipt({ restaurantName, label, order, payment, items }) {
    const lines = (items || order?.items || []).map((it) => {
        const qty = it.pay_qty || it.quantity;
        const name = esc(it.product_name || it.name);
        return `<tr><td>${qty}× ${name}</td><td style="text-align:right">${fmtMoney((it.unit_price || 0) * qty)}</td></tr>`;
    }).join('');
    const html = `<!doctype html><html><head><title>Comprobante</title>
      <style>
        body{font-family:ui-sans-serif,system-ui,sans-serif;padding:16px;max-width:320px;margin:0 auto;color:#222}
        h1{font-size:18px;margin:0 0 4px}
        .muted{color:#666;font-size:12px}
        table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
        td{padding:4px 0}
        .total{font-size:16px;font-weight:700;border-top:1px dashed #999;padding-top:8px}
      </style></head><body>
      <h1>${esc(restaurantName || 'Sabor Peruano')}</h1>
      <div class="muted">${esc(label || '')} · Pedido #${esc(order?.order_number || payment?.order_number || '')}</div>
      <table>${lines}</table>
      <div class="total">Pagado ${fmtMoney(payment?.amount)} · ${payment?.method || ''}</div>
      ${payment?.change_amount ? `<div>Vuelto ${fmtMoney(payment.change_amount)}</div>` : ''}
      ${payment?.remaining > 0 ? `<div class="muted">Saldo ${fmtMoney(payment.remaining)}</div>` : '<div class="muted">Cuenta cubierta</div>'}
      <div class="muted" style="margin-top:16px">${new Date().toLocaleString('es-PE')}</div>
      </body></html>`;
    const w = window.open('', 'comprobante', 'width=420,height=640');
    if (!w) return false;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
    return true;
}
