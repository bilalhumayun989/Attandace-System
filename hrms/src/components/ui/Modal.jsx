import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from './Card';

const Modal = ({ isOpen, onClose, title, children, footer }) => {
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-md animate-in fade-in duration-300 p-4">
            <div
                className="fixed inset-0"
                onClick={onClose}
            />
            <Card className="w-full max-w-[95%] sm:max-w-lg md:max-w-xl z-50 shadow-2xl animate-in zoom-in-95 duration-300 border-muted/20 flex flex-col max-h-[90vh]">
                <CardHeader className="flex flex-row items-center justify-between shrink-0 border-b border-border/50">
                    <CardTitle className="text-xl font-bold">{title}</CardTitle>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full hover:bg-muted/50">
                        <X size={18} />
                    </Button>
                </CardHeader>
                <CardContent className="overflow-y-auto py-6 px-6 custom-scrollbar">
                    {children}
                </CardContent>
                {footer && (
                    <CardFooter className="justify-end space-x-2 bg-muted/20 p-4">
                        {footer}
                    </CardFooter>
                )}
            </Card>
        </div>
    );
};

export { Modal };
