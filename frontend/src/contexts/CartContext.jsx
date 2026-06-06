import React, { createContext, useContext, useEffect, useState } from 'react';

const KEY = 'public_cart_v1';
const CartContext = createContext(null);

export const CartProvider = ({ children }) => {
    const [items, setItems] = useState([]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) setItems(JSON.parse(raw));
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ }
    }, [items]);

    const addProduct = (product, qty = 1, notes = '') => {
        setItems((cur) => {
            const idx = cur.findIndex((x) => x.product_id === product.id);
            if (idx >= 0) {
                const copy = [...cur];
                copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + qty };
                return copy;
            }
            return [...cur, {
                product_id: product.id, name: product.name, price: product.price,
                image_url: product.image_url, quantity: qty, notes,
            }];
        });
    };

    const updateQty = (productId, qty) => {
        setItems((cur) => {
            if (qty <= 0) return cur.filter((x) => x.product_id !== productId);
            return cur.map((x) => x.product_id === productId ? { ...x, quantity: qty } : x);
        });
    };

    const setNotes = (productId, notes) => {
        setItems((cur) => cur.map((x) => x.product_id === productId ? { ...x, notes } : x));
    };

    const remove = (productId) => setItems((cur) => cur.filter((x) => x.product_id !== productId));
    const clear = () => setItems([]);

    const subtotal = items.reduce((s, x) => s + x.price * x.quantity, 0);
    const count = items.reduce((s, x) => s + x.quantity, 0);

    return (
        <CartContext.Provider value={{ items, addProduct, updateQty, setNotes, remove, clear, subtotal, count }}>
            {children}
        </CartContext.Provider>
    );
};

export const useCart = () => {
    const ctx = useContext(CartContext);
    if (!ctx) throw new Error('useCart must be used within CartProvider');
    return ctx;
};
