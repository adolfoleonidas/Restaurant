import React, { createContext, useContext, useEffect, useState } from 'react';
import { login as loginRequest, getMe } from '@/lib/api/auth';
import { canAccessRole } from '@/lib/functions';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem('token');
        const u = localStorage.getItem('user');
        let cancelled = false;
        if (token && u) {
            try {
                setUser(JSON.parse(u));
            } catch { /* ignore */ }
            // The stored user is a login-time snapshot: functions granted since
            // (e.g. 'cobro') only show up once it is refreshed from the server.
            // The screen does not wait for it, and a failure keeps the snapshot
            // (offline must still work). A 401 is handled by the axios interceptor.
            getMe().then(({ data }) => {
                if (cancelled || !data || localStorage.getItem('token') !== token) return;
                localStorage.setItem('user', JSON.stringify(data));
                setUser(data);
            }).catch(() => { /* keep the stored user */ });
        }
        setLoading(false);
        return () => { cancelled = true; };
    }, []);

    const login = async (email, password) => {
        const { data } = await loginRequest(email, password);
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        setUser(data.user);
        return data.user;
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
        window.location.href = '/login';
    };

    const hasRole = (roles) => canAccessRole(user, roles);

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, hasRole }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
};
