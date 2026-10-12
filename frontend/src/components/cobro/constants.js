import { Banknote, Smartphone, CreditCard, Building2, ArrowLeftRight } from 'lucide-react';
import { PAYMENT_METHODS } from '@/lib/paymentMethods';

const METHOD_ICONS = {
    cash: Banknote, yape: Smartphone, plin: Smartphone, card: CreditCard, transfer: Building2, mixed: ArrowLeftRight,
};

/** Payment methods with the icon the charge dialog shows for each one. */
export const METHODS = PAYMENT_METHODS.map((m) => ({ id: m.id, name: m.name, Icon: METHOD_ICONS[m.id] }));
export const TIP_CHIPS = [0, 5, 10, 15];
export const KEYPAD_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];
