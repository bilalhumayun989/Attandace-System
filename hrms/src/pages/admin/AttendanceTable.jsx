import React from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';

export const AttendanceTable = ({
  filteredAttendance,
  loading,
  format12h,
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
          <td colSpan={8} className="p-12 text-center text-muted-foreground">
            <div className="mx-auto animate-spin mb-2">Loading...</div>
          </td>
        </tr>
      </>
    );    
  }

  if (filteredAttendance.length === 0) {
    return (
      <>
        <tr>
          <td colSpan={8} className="p-12 text-center text-muted-foreground">No matching records found.</td>
        </tr>
      </>
    );
  }

  return (
    <>
      {filteredAttendance.map((record, index) => {
        // First completed shift — shown in the summary row (the shift that counts)
        const firstCompletedShift = record.shifts?.find(s => s.checkOut) || null;
        const lastShift = record.shifts && record.shifts.length > 0
          ? record.shifts[record.shifts.length - 1]
          : null;
        const displayCheckIn = firstCompletedShift ? firstCompletedShift.checkIn : record.checkIn;
        const displayCheckOut = firstCompletedShift ? firstCompletedShift.checkOut : record.checkOut;
        const hasMultipleShifts = record.shifts && record.shifts.length > 1;
        // isActive only when the LAST shift has no checkout (open or missed) AND no prior shift was completed
        const isActive = record.checkIn && !record.checkOut && !(lastShift && lastShift.checkOut);

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
            <td className="px-6 py-4 text-muted-foreground font-medium">{format12h(displayCheckIn)}</td>
            <td className="px-6 py-4 text-muted-foreground font-medium">
              {displayCheckOut
                ? format12h(displayCheckOut)
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
