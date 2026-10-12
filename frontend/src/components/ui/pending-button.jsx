import * as React from 'react';
import { Button } from '@/components/ui/button';

/**
 * A button that knows it is working: while `pending` it shows `pendingLabel`,
 * disables itself (so repeat taps do nothing) and sets `aria-busy`.
 */
const PendingButton = React.forwardRef(({
    pending = false, pendingLabel, disabled = false, children, ...props
}, ref) => (
    <Button
        ref={ref}
        {...props}
        disabled={disabled || pending}
        aria-busy={pending ? 'true' : undefined}
    >
        {pending && pendingLabel ? pendingLabel : children}
    </Button>
));
PendingButton.displayName = 'PendingButton';

export default PendingButton;
