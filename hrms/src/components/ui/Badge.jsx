import React from 'react';

const Badge = ({ children, variant = "default", className = "" }) => {
    const variants = {
        default: "bg-primary/10 text-primary border-primary/20",
        success: "bg-green-500/10 text-green-600 border-green-500/20",
        warning: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
        destructive: "bg-red-500/10 text-red-600 border-red-500/20",
        secondary: "bg-secondary text-secondary-foreground border-transparent",
    };

    const selectedVariant = variants[variant] || variants.default;

    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${selectedVariant} ${className}`}>
            {children}
        </span>
    );
};

export { Badge };
