import React from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { formatAttendanceDateTime } from '../../utils/attendanceDisplay';
import { CalendarClock, Loader2 } from 'lucide-react';

export const AttendanceTable = ({
  filteredAttendance,
  loading,
  calculateHours,
  handleUpdateStatus,
  setSelectedRecord,
  setIsDetailModalOpen,
  updateLoading,
}) => {
  if (loading) {
    return (
      <>
        <tr>
          <td colSpan={8} className="px-6 py-8">
            <div className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Loading attendance records…
            </div>
          </td>
        </tr>
        {Array.from({ length: 5 }, (_, row) => (
          <tr key={`attendance-skeleton-${row}`} aria-hidden="true" className="animate-pulse">
            <td className="px-6 py-5"><div className="h-4 w-24 rounded bg-muted" /></td>
            <td className="px-6 py-5"><div className="h-4 w-32 rounded bg-muted" /><div className="mt-2 h-3 w-20 rounded bg-muted/70" /></td>
            <td className="px-6 py-5"><div className="h-6 w-24 rounded-full bg-muted" /></td>
            <td className="px-6 py-5"><div className="h-4 w-20 rounded bg-muted" /></td>
            <td className="px-6 py-5"><div className="h-4 w-20 rounded bg-muted" /></td>
            <td className="px-6 py-5"><div className="h-4 w-12 rounded bg-muted" /></td>
            <td className="px-6 py-5"><div className="mx-auto h-6 w-20 rounded-full bg-muted" /></td>
            <td className="px-6 py-5"><div className="ml-auto h-8 w-16 rounded bg-muted" /></td>
          </tr>
        ))}
      </>
    );    
  }

  if (filteredAttendance.length === 0) {
    return (
      <>
        <tr>
          <td colSpan={8} className="px-6 py-14 text-center">
            <div className="mx-auto flex max-w-sm flex-col items-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/70 text-muted-foreground">
                <CalendarClock className="h-5 w-5" />
              </span>
              <span className="font-semibold text-foreground">No attendance records found</span>
              <span className="mt-1 text-sm text-muted-foreground">Try another date or adjust your filters.</span>
            </div>
          </td>
        </tr>
      </>
    );
  }

  return (
    <>
      {filteredAttendance.map((record, index) => {
        // First completed shift — shown in the summary row (the shift that counts)
        const firstCompletedShift = record.shifts?.find(s => s.checkOut && !s.missed) || null;
        const lastShift = record.shifts && record.shifts.length > 0
          ? record.shifts[record.shifts.length - 1]
          : null;
        const displayCheckIn = firstCompletedShift ? firstCompletedShift.checkIn : record.checkIn;
        const legacyMissedCheckout = record.status === 'Absent' && !record.duration && record.checkIn === record.checkOut;
        const displayCheckOut = legacyMissedCheckout ? null : (firstCompletedShift ? firstCompletedShift.checkOut : record.checkOut);
        const hasMultipleShifts = record.shifts && record.shifts.length > 1;
        // isActive only when the LAST shift has no checkout (open or missed) AND no prior shift was completed
        const isActive = record.status !== 'Absent' && record.checkIn && !record.checkOut && !lastShift?.missed && !lastShift?.checkOut;

        return (
          <tr key={record._id || index} className={`hover:bg-muted/30 transition-colors ${record.userId?.status === 'Deleted' ? 'line-through opacity-50 bg-muted/20' : ''}`}>
            <td className="px-6 py-4 font-medium">
              <div className="flex items-center gap-2">
                {record.date}
                {hasMultipleShifts && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                    {record.shifts.length} shifts
                  </span>
                )}
              </div>
            </td>
            <td className="px-6 py-4">
              <div className="flex flex-col">
                <span className="font-bold text-slate-900">
                  {record.userId?.name || 'Unknown'}
                  {record.userId?.status === 'Deleted' && (
                    <span className="text-rose-500 text-xs ml-2 font-semibold">(Deleted)</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{record.userId?.employeeId}</span>
              </div>
            </td>
            <td className="px-6 py-4">
              <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/8 text-primary border border-primary/15">
                {record.userId?.department || <span className="text-muted-foreground/50 font-normal">—</span>}
              </span>
            </td>
            <td className="px-6 py-4 text-muted-foreground font-medium">{formatAttendanceDateTime(displayCheckIn)}</td>
            <td className="px-6 py-4 text-muted-foreground font-medium">
              {displayCheckOut
                ? formatAttendanceDateTime(displayCheckOut)
                : isActive
                  ? <span className="text-amber-500 font-medium">Active</span>
                  : '-'}
            </td>
            <td className="px-6 py-4 font-bold text-primary">{calculateHours(record.duration)}</td>
            <td className="px-6 py-4 text-center">
              <Badge variant={isActive ? 'destructive' : record.status === 'Present' ? 'success' : record.status === 'Late' ? 'warning' : 'destructive'}>
                {isActive ? 'Missed Checkout' : record.status}
              </Badge>
            </td>
            <td className="px-6 py-4 text-right">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSelectedRecord(record); setIsDetailModalOpen(true); }}
              >
                Details
              </Button>
            </td>
          </tr>
        );
      })}
    </>
  );
};
