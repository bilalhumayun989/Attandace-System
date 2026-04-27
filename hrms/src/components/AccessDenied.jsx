import React from 'react';
import { ShieldOff } from 'lucide-react';

/**
 * Shown when a logged-in admin navigates to a route they don't have permission for.
 */
const AccessDenied = ({ message = "You don't have permission to view this page." }) => {
    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-4 animate-in fade-in duration-500">
            <div className="flex items-center justify-center h-20 w-20 rounded-full bg-destructive/10">
                <ShieldOff className="h-10 w-10 text-destructive" />
            </div>
            <div className="text-center space-y-2 max-w-sm">
                <h2 className="text-2xl font-bold tracking-tight">Access Denied</h2>
                <p className="text-muted-foreground text-sm">{message}</p>
                <p className="text-xs text-muted-foreground">
                    Contact your system administrator if you believe this is a mistake.
                </p>
            </div>
        </div>
    );
};

export default AccessDenied;
