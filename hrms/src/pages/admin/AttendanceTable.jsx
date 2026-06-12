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
      <tbody>
        <tr>
          <td colSpan={7} className="p-12 text-center text-muted-foreground">
            <div className="mx-auto animate-spin mb-2">Loading...</div>
          </td>
        </tr>
      </tbody>
    );
  }

  if (filteredAttendance.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={7} className="p-12 text-center text-muted-foreground">No matching records found.</td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody>
      {filteredAttendance.map((record, index) => (
        <tr key={record._id || index} className={`hover:bg-muted/30 transition-colors ${record.userId?.status === 'Deleted' ? 'line-through opacity-50 bg-muted/20' : ''}`}>
          <td className="px-6 py-4 font-medium">{record.date}</td>
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
          <td className="px-6 py-4 text-muted-foreground font-medium">{format12h(record.checkIn)}</td>
          <td className="px-6 py-4 text-muted-foreground font-medium">{format12h(record.checkOut)}</td>
          <td className="px-6 py-4 font-bold text-primary">{calculateHours(record.duration)}</td>
          <td className="px-6 py-4 text-center">
            <Badge variant={(record.checkIn && !record.checkOut) ? 'destructive' : record.status === 'Present' ? 'success' : record.status === 'Late' ? 'warning' : 'destructive'}>
              {(record.checkIn && !record.checkOut) ? 'Missed Checkout' : record.status}
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
      ))}
    </tbody>
  );
};
