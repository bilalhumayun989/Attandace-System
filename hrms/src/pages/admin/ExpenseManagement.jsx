import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import {
    Wallet, TrendingDown, Gift, CreditCard, DollarSign,
    Loader2, Trash2, CheckCircle2, Clock, ChevronDown, User, AlertCircle
} from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', minimumFractionDigits: 0 }).format(n || 0);

// Compact format for small cards: Rs 23,000 → Rs 23K, Rs 1,150 → Rs 1.1K
const fmtCompact = (n) => {
    const v = n || 0;
    if (v >= 1000000) return `Rs ${(v / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
    if (v >= 1000)    return `Rs ${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    return `Rs ${v}`;
};

const getCurrentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };

const TYPE_META = {
    full_salary: { label: 'Full Salary',     color: 'bg-emerald-100 text-emerald-700', icon: DollarSign   },
    advance:     { label: 'Advance Salary',  color: 'bg-blue-100 text-blue-700',       icon: CreditCard   },
    deduction:   { label: 'Deduction',       color: 'bg-rose-100 text-rose-700',       icon: TrendingDown },
    bonus:       { label: 'Bonus',           color: 'bg-amber-100 text-amber-700',     icon: Gift         },
    custom:      { label: 'Custom Payment',  color: 'bg-purple-100 text-purple-700',   icon: Wallet       },
};

const PERIOD_LABELS = { '1-15': '1st – 15th', '16-end': '16th – End of Month', 'full-month': 'Full Month' };

// ─── Summary Card ────────────────────────────────────────────────────────────
const SummaryCard = ({ label, amount, sub, color = 'text-slate-800' }) => (
    <div className="bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 flex flex-col gap-1 shadow-sm">
        <span className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider leading-tight">{label}</span>
        {/* Compact on mobile, full amount on sm+ */}
        <span className={`text-sm font-black sm:hidden ${color}`}>{fmtCompact(amount)}</span>
        <span className={`text-lg font-black hidden sm:block ${color}`}>{fmt(amount)}</span>
        {sub && <span className="text-[10px] sm:text-xs text-slate-400 leading-tight">{sub}</span>}
    </div>
);

// ─── Main Component ──────────────────────────────────────────────────────────
const ExpenseManagement = ({ employees = [] }) => {
    const [month, setMonth] = useState(getCurrentMonth());
    const [selectedEmpId, setSelectedEmpId] = useState('');
    const [summary, setSummary] = useState(null);
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Modal state
    const [modal, setModal] = useState(null); // 'full_salary'|'advance'|'deduction'|'bonus'|'custom'

    // Form fields
    const [advancePeriod, setAdvancePeriod] = useState('1-15');
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [bonusPayNow, setBonusPayNow] = useState(true);
    const [salaryType, setSalaryType] = useState('full_month'); // 'full_month' | 'current_earned'

    const selectedEmp = employees.find(e => e._id === selectedEmpId);

    const fetchSummary = useCallback(async () => {
        if (!selectedEmpId) return;
        setLoadingSummary(true);
        setError('');
        try {
            const res = await fetch(`${API_BASE_URL}/expenses/summary/${selectedEmpId}?month=${month}`, {
                headers: { 'X-Role-Context': 'Admin' }, credentials: 'include'
            });
            const data = await res.json();
            if (res.ok) setSummary(data);
            else setError(data.message || 'Failed to load summary.');
        } catch { setError('Server error.'); }
        finally { setLoadingSummary(false); }
    }, [selectedEmpId, month]);

    useEffect(() => { fetchSummary(); }, [fetchSummary]);

    const openModal = (type) => {
        setModal(type); setAmount(''); setNote('');
        setAdvancePeriod('1-15'); setBonusPayNow(true); setSalaryType('full_month');
        setError(''); setSuccess('');
    };
    const closeModal = () => { setModal(null); setError(''); };

    const apiCall = async (endpoint, body) => {
        setActionLoading(true); setError('');
        try {
            const res = await fetch(`${API_BASE_URL}/expenses/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Role-Context': 'Admin' },
                credentials: 'include',
                body: JSON.stringify({ userId: selectedEmpId, month, ...body })
            });
            const data = await res.json();
            if (res.ok) {
                setSummary(data.summary);
                setSuccess(data.message);
                closeModal();
                setTimeout(() => setSuccess(''), 4000);
            } else { setError(data.message || 'Action failed.'); }
        } catch { setError('Server error.'); }
        finally { setActionLoading(false); }
    };

    const handlePayPendingBonus = async (id) => {
        setActionLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/expenses/${id}/pay-bonus`, {
                method: 'PATCH', headers: { 'X-Role-Context': 'Admin' }, credentials: 'include'
            });
            const data = await res.json();
            if (res.ok) { setSummary(data.summary); setSuccess('Bonus paid!'); setTimeout(() => setSuccess(''), 3000); }
            else setError(data.message);
        } catch { setError('Server error.'); }
        finally { setActionLoading(false); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this expense entry?')) return;
        setActionLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/expenses/${id}`, {
                method: 'DELETE', headers: { 'X-Role-Context': 'Admin' }, credentials: 'include'
            });
            const data = await res.json();
            if (res.ok) { setSummary(data.summary); setSuccess('Deleted.'); setTimeout(() => setSuccess(''), 3000); }
            else setError(data.message);
        } catch { setError('Server error.'); }
        finally { setActionLoading(false); }
    };

    const handleSubmit = () => {
        if (modal === 'full_salary') return apiCall('full-salary', {
            salaryType,
            currentEarnedSalary: summary?.currentEarnedSalary,
            note
        });
        if (modal === 'advance')     return apiCall('advance', { advancePeriod, note });
        if (modal === 'deduction')   return apiCall('deduction', { amount: Number(amount), note });
        if (modal === 'bonus')       return apiCall('bonus', { amount: Number(amount), payNow: bonusPayNow, note });
        if (modal === 'custom')      return apiCall('custom', { amount: Number(amount), note });
    };

    // Advance amount preview
    const advancePreview = () => {
        if (!selectedEmp?.salary) return 0;
        if (advancePeriod === 'full-month') return selectedEmp.salary;
        return Math.round(selectedEmp.salary / 2);
    };

    return (
        <div className="space-y-5">
            {/* ── Controls ── */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm items-center w-full sm:w-auto">
                    <Input type="month" value={month} onChange={e => setMonth(e.target.value)}
                        className="bg-transparent text-sm font-semibold px-3 py-1.5 border-none h-auto shadow-none focus-visible:ring-0 w-full cursor-pointer" />
                </div>
                <div className="relative flex-1">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                    <select value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)}
                        className="w-full h-10 pl-9 pr-8 rounded-xl border border-slate-200 bg-white text-sm shadow-sm focus:ring-1 focus:ring-primary appearance-none">
                        <option value="">— Select Employee —</option>
                        {employees.map(e => (
                            <option key={e._id} value={e._id}>{e.name} ({e.employeeId})</option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                </div>
            </div>

            {/* ── Feedback ── */}
            {success && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-3 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4 shrink-0" /> {success}
                </div>
            )}
            {error && !modal && (
                <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm font-medium">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </div>
            )}

            {/* ── Prompt if no employee selected ── */}
            {!selectedEmpId && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                    <User className="h-12 w-12 opacity-30" />
                    <p className="text-sm font-medium">Select an employee to manage payments</p>
                </div>
            )}

            {/* ── Loading ── */}
            {selectedEmpId && loadingSummary && (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            )}

            {/* ── Main Content ── */}
            {selectedEmpId && !loadingSummary && summary && (
                <div className="space-y-5">
                    {/* Employee info banner */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white rounded-2xl border border-slate-200 px-4 py-4 shadow-sm">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <User className="h-5 w-5 text-primary" />
                            </div>
                            <div className="min-w-0">
                                <p className="font-bold text-slate-800 text-base truncate">{summary.user?.name}</p>
                                <p className="text-xs text-slate-400 truncate">{summary.user?.employeeId} · {summary.user?.department}</p>
                            </div>
                        </div>
                        <div className="sm:text-right border-t sm:border-t-0 sm:border-l border-slate-100 pt-3 sm:pt-0 sm:pl-4">
                            <p className="text-xs text-slate-400 font-medium">Base Salary</p>
                            <p className="text-lg font-black text-slate-800">{fmt(summary.baseSalary)}</p>
                        </div>
                    </div>

                    {/* Summary grid — 2 cols mobile → 4 cols tablet → 7 cols desktop */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
                        <SummaryCard label="Base Salary"   amount={summary.baseSalary}           color="text-slate-800"  />
                        <SummaryCard label="Curr. Earned"  amount={summary.currentEarnedSalary}
                            sub={`${summary.presentDays ?? '—'} days`}
                            color="text-indigo-600" />
                        <SummaryCard label="Advance"       amount={summary.totalAdvance}          color="text-blue-600"   />
                        <SummaryCard label="Deductions"    amount={summary.totalDeductions}       color="text-rose-600"   />
                        <SummaryCard label="Bonus Paid"    amount={summary.totalBonusPaid}        color="text-amber-600"  />
                        <SummaryCard label="Effective"     amount={summary.netPayable}            color="text-primary"    />
                        <SummaryCard label="Remaining"     amount={summary.remainingBalance}
                            color={summary.remainingBalance > 0 ? 'text-emerald-600' : 'text-slate-400'}
                            sub={summary.remainingBalance === 0 ? 'Fully paid' : 'Still due'} />
                    </div>

                    {/* Action buttons — 2 cols mobile → 5 cols desktop */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
                        <button onClick={() => openModal('full_salary')}
                            disabled={summary.fullSalaryPaid}
                            className="flex flex-col items-center gap-2 p-3 sm:p-4 rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                            <DollarSign className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-600" />
                            <span className="text-xs font-bold text-emerald-700 text-center leading-tight">
                                {summary.fullSalaryPaid ? '✓ Salary Paid' : 'Pay Full Salary'}
                            </span>
                        </button>
                        <button onClick={() => openModal('advance')}
                            className="flex flex-col items-center gap-2 p-3 sm:p-4 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 transition-all">
                            <CreditCard className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
                            <span className="text-xs font-bold text-blue-700 text-center leading-tight">Advance Salary</span>
                        </button>
                        <button onClick={() => openModal('deduction')}
                            className="flex flex-col items-center gap-2 p-3 sm:p-4 rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50 hover:bg-rose-100 hover:border-rose-400 transition-all">
                            <TrendingDown className="h-5 w-5 sm:h-6 sm:w-6 text-rose-600" />
                            <span className="text-xs font-bold text-rose-700 text-center leading-tight">Add Deduction</span>
                        </button>
                        <button onClick={() => openModal('bonus')}
                            className="flex flex-col items-center gap-2 p-3 sm:p-4 rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50 hover:bg-amber-100 hover:border-amber-400 transition-all">
                            <Gift className="h-5 w-5 sm:h-6 sm:w-6 text-amber-600" />
                            <span className="text-xs font-bold text-amber-700 text-center leading-tight">Add Bonus</span>
                        </button>
                        <button onClick={() => openModal('custom')}
                            className="col-span-2 sm:col-span-1 flex flex-col items-center gap-2 p-3 sm:p-4 rounded-2xl border-2 border-dashed border-purple-200 bg-purple-50 hover:bg-purple-100 hover:border-purple-400 transition-all">
                            <Wallet className="h-5 w-5 sm:h-6 sm:w-6 text-purple-600" />
                            <span className="text-xs font-bold text-purple-700 text-center leading-tight">Custom Payment</span>
                        </button>
                    </div>

                    {/* Transaction history */}
                    <Card className="border-slate-200 shadow-sm overflow-hidden">
                        <CardHeader className="pb-3 px-4 sm:px-6">
                            <CardTitle className="text-base font-bold">Transaction History — {month}</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            {summary.expenses.length === 0 ? (
                                <div className="text-center text-slate-400 text-sm py-10">No transactions recorded for this month.</div>
                            ) : (
                                <div className="divide-y divide-slate-100">
                                    {summary.expenses.map(exp => {
                                        const meta = TYPE_META[exp.type] || TYPE_META.custom;
                                        const Icon = meta.icon;
                                        const isPending = exp.status === 'Pending';
                                        return (
                                            <div key={exp._id} className="flex items-start gap-3 px-4 sm:px-5 py-3 hover:bg-slate-50 transition-colors">
                                                {/* Icon */}
                                                <div className={`h-8 w-8 sm:h-9 sm:w-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${meta.color}`}>
                                                    <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                                </div>

                                                {/* Details */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        <span className="text-sm font-semibold text-slate-800">{meta.label}</span>
                                                        {exp.type === 'full_salary' && (
                                                            <Badge variant="secondary" className="text-xs">
                                                                {exp.note?.startsWith('[Full Month]') ? 'Full Month' : exp.note?.startsWith('[Current Earned]') ? 'Current Earned' : ''}
                                                            </Badge>
                                                        )}
                                                        {exp.advancePeriod && (
                                                            <Badge variant="secondary" className="text-xs">{PERIOD_LABELS[exp.advancePeriod]}</Badge>
                                                        )}
                                                        <Badge variant={isPending ? 'warning' : 'success'} className="text-xs">
                                                            {isPending
                                                                ? <><Clock className="h-3 w-3 mr-1 inline" />Pending</>
                                                                : <><CheckCircle2 className="h-3 w-3 mr-1 inline" />Paid</>}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-xs font-medium text-slate-600 mt-0.5 truncate">
                                                        {exp.userId?.name || summary?.user?.name} · {exp.userId?.employeeId || summary?.user?.employeeId}
                                                    </p>
                                                    {exp.note && !['[Full Month]', '[Current Earned]'].includes(exp.note.trim()) && (
                                                        <p className="text-xs text-slate-400 truncate mt-0.5">
                                                            {exp.note.replace(/^\[(Full Month|Current Earned)\]\s*/, '')}
                                                        </p>
                                                    )}
                                                    <p className="text-xs text-slate-400 mt-0.5">
                                                        {new Date(exp.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    </p>
                                                </div>

                                                {/* Amount + Actions — stacked on mobile */}
                                                <div className="flex flex-col items-end gap-1 shrink-0">
                                                    <p className={`font-black text-sm sm:text-base ${exp.type === 'deduction' ? 'text-rose-600' : exp.type === 'bonus' ? 'text-amber-600' : 'text-slate-800'}`}>
                                                        {exp.type === 'deduction' ? '−' : '+'}{fmt(exp.amount)}
                                                    </p>
                                                    <div className="flex items-center gap-1">
                                                        {exp.type === 'bonus' && isPending && (
                                                            <Button size="sm" onClick={() => handlePayPendingBonus(exp._id)} disabled={actionLoading}
                                                                className="h-6 px-2 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded-lg">
                                                                Pay
                                                            </Button>
                                                        )}
                                                        {/* Delete disabled — paid transactions are permanent records
                                                        <Button size="icon" variant="ghost" onClick={() => handleDelete(exp._id)} disabled={actionLoading}
                                                            className="h-6 w-6 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg">
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                        */}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* ── Modals ── */}

            {/* Full Salary Modal */}
            <Modal isOpen={modal === 'full_salary'} onClose={closeModal} title="Pay Full Salary"
                footer={<>
                    <Button variant="outline" onClick={closeModal}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={actionLoading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <DollarSign className="h-4 w-4 mr-2" />} Pay Now
                    </Button>
                </>}>
                <div className="space-y-4">
                    {/* Salary type selector */}
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Select Payment Type</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button onClick={() => setSalaryType('full_month')}
                                className={`p-4 rounded-xl border-2 text-left transition-all ${salaryType === 'full_month' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-emerald-300'}`}>
                                <p className={`text-sm font-bold ${salaryType === 'full_month' ? 'text-emerald-700' : 'text-slate-600'}`}>Full Month Salary</p>
                                <p className={`text-2xl font-black mt-1 ${salaryType === 'full_month' ? 'text-emerald-700' : 'text-slate-800'}`}>{fmt(summary?.baseSalary)}</p>
                                <p className="text-xs text-slate-400 mt-1 leading-tight">Pays the full base salary regardless of attendance or overtime</p>
                            </button>
                            <button onClick={() => setSalaryType('current_earned')}
                                className={`p-4 rounded-xl border-2 text-left transition-all ${salaryType === 'current_earned' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
                                <p className={`text-sm font-bold ${salaryType === 'current_earned' ? 'text-indigo-700' : 'text-slate-600'}`}>Current Earned</p>
                                <p className={`text-2xl font-black mt-1 ${salaryType === 'current_earned' ? 'text-indigo-700' : 'text-slate-800'}`}>{fmt(summary?.currentEarnedSalary)}</p>
                                <p className="text-xs text-slate-400 mt-1 leading-tight">{summary?.presentDays ?? '—'} days present · based on actual attendance up to today</p>
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Note (optional)</label>
                        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Monthly salary payment" />
                    </div>
                    {error && <p className="text-sm text-rose-600 flex items-center gap-1"><AlertCircle className="h-4 w-4" />{error}</p>}
                </div>
            </Modal>

            {/* Advance Salary Modal */}
            <Modal isOpen={modal === 'advance'} onClose={closeModal} title="Pay Advance Salary"
                footer={<>
                    <Button variant="outline" onClick={closeModal}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={actionLoading} className="bg-blue-600 hover:bg-blue-700 text-white">
                        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />} Pay Advance
                    </Button>
                </>}>
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Select Period</label>
                        <div className="grid grid-cols-3 gap-2">
                            {Object.entries(PERIOD_LABELS).map(([val, lbl]) => (
                                <button key={val} onClick={() => setAdvancePeriod(val)}
                                    className={`p-3 rounded-xl border-2 text-xs font-bold transition-all text-center ${advancePeriod === val ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:border-blue-300'}`}>
                                    {lbl}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="bg-blue-50 rounded-xl p-4 text-center">
                        <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide">Advance Amount</p>
                        <p className="text-3xl font-black text-blue-700 mt-1">{fmt(advancePreview())}</p>
                        <p className="text-xs text-blue-400 mt-1">Will be deducted from final payroll</p>
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Note (optional)</label>
                        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Advance for 1st–15th" />
                    </div>
                    {error && <p className="text-sm text-rose-600 flex items-center gap-1"><AlertCircle className="h-4 w-4" />{error}</p>}
                </div>
            </Modal>

            {/* Deduction Modal */}
            <Modal isOpen={modal === 'deduction'} onClose={closeModal} title="Add Deduction"
                footer={<>
                    <Button variant="outline" onClick={closeModal}>Cancel</Button>
                    <Button onClick={handleSubmit}
                        disabled={actionLoading || !amount || Number(amount) <= 0 || Number(amount) > (summary?.remainingBalance || 0)}
                        className="bg-rose-600 hover:bg-rose-700 text-white">
                        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TrendingDown className="h-4 w-4 mr-2" />} Apply Deduction
                    </Button>
                </>}>
                <div className="space-y-4">
                    {/* Current balance info */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 rounded-xl p-3 text-center">
                            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Base Salary</p>
                            <p className="text-xl font-black text-slate-700">{fmt(summary?.baseSalary)}</p>
                        </div>
                        <div className="bg-emerald-50 rounded-xl p-3 text-center">
                            <p className="text-xs text-emerald-600 font-semibold uppercase tracking-wide">Remaining</p>
                            <p className="text-xl font-black text-emerald-700">{fmt(summary?.remainingBalance)}</p>
                        </div>
                    </div>
                    {summary?.fullSalaryPaid && (
                        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-3 py-2 text-xs font-medium">
                            <AlertCircle className="h-4 w-4 shrink-0" /> Full salary already paid — deductions cannot be added this month.
                        </div>
                    )}
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Deduction Amount (PKR)</label>
                        <Input type="number" min="1" max={summary?.remainingBalance}
                            disabled={summary?.fullSalaryPaid}
                            value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 5000" />
                    </div>
                    {Number(amount) > 0 && Number(amount) <= (summary?.remainingBalance || 0) && (
                        <div className="bg-rose-50 rounded-xl p-3 text-center">
                            <p className="text-xs text-rose-500 font-medium">Effective salary after deduction</p>
                            <p className="text-xl font-black text-rose-700">{fmt(Math.max(0, (summary?.baseSalary || 0) - (summary?.totalDeductions || 0) - Number(amount) + (summary?.totalBonusPaid || 0)))}</p>
                        </div>
                    )}
                    {Number(amount) > (summary?.remainingBalance || 0) && Number(amount) > 0 && (
                        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-3 py-2 text-xs font-medium">
                            <AlertCircle className="h-4 w-4 shrink-0" /> Cannot exceed remaining salary of {fmt(summary?.remainingBalance)}.
                        </div>
                    )}
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Note (optional)</label>
                        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Loan deduction" />
                    </div>
                    {error && <p className="text-sm text-rose-600 flex items-center gap-1"><AlertCircle className="h-4 w-4" />{error}</p>}
                </div>
            </Modal>

            {/* Bonus Modal */}
            <Modal isOpen={modal === 'bonus'} onClose={closeModal} title="Add Bonus"
                footer={<>
                    <Button variant="outline" onClick={closeModal}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={actionLoading || !amount} className="bg-amber-500 hover:bg-amber-600 text-white">
                        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Gift className="h-4 w-4 mr-2" />}
                        {bonusPayNow ? 'Pay Bonus Now' : 'Save as Pending'}
                    </Button>
                </>}>
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Bonus Amount (PKR)</label>
                        <Input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 10000" />
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Payment Timing</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => setBonusPayNow(true)}
                                className={`p-3 rounded-xl border-2 text-xs font-bold transition-all ${bonusPayNow ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:border-amber-300'}`}>
                                <CheckCircle2 className="h-4 w-4 mx-auto mb-1" /> Pay Immediately
                            </button>
                            <button onClick={() => setBonusPayNow(false)}
                                className={`p-3 rounded-xl border-2 text-xs font-bold transition-all ${!bonusPayNow ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:border-amber-300'}`}>
                                <Clock className="h-4 w-4 mx-auto mb-1" /> Keep Pending
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Note (optional)</label>
                        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Performance bonus" />
                    </div>
                    {error && <p className="text-sm text-rose-600 flex items-center gap-1"><AlertCircle className="h-4 w-4" />{error}</p>}
                </div>
            </Modal>

            {/* Custom Payment Modal */}
            <Modal isOpen={modal === 'custom'} onClose={closeModal} title="Custom Payment"
                footer={<>
                    <Button variant="outline" onClick={closeModal}>Cancel</Button>
                    <Button onClick={handleSubmit}
                        disabled={actionLoading || !amount || Number(amount) <= 0 || Number(amount) > (summary?.remainingBalance || 0)}
                        className="bg-purple-600 hover:bg-purple-700 text-white">
                        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wallet className="h-4 w-4 mr-2" />} Record Payment
                    </Button>
                </>}>
                <div className="space-y-4">
                    <div className="bg-purple-50 rounded-xl p-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-purple-600 uppercase tracking-wide">Remaining Balance</span>
                        <span className="text-xl font-black text-purple-700">{fmt(summary?.remainingBalance)}</span>
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Amount (PKR)</label>
                        <Input type="number" min="1" max={summary?.remainingBalance}
                            value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Max: ${fmt(summary?.remainingBalance)}`} />
                    </div>
                    {Number(amount) > (summary?.remainingBalance || 0) && Number(amount) > 0 && (
                        <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-3 py-2 text-xs font-medium">
                            <AlertCircle className="h-4 w-4 shrink-0" /> Cannot exceed remaining balance of {fmt(summary?.remainingBalance)}.
                        </div>
                    )}
                    {Number(amount) > 0 && Number(amount) <= (summary?.remainingBalance || 0) && (
                        <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
                            <span className="text-xs text-slate-500 font-medium">Balance after payment</span>
                            <span className="text-base font-black text-slate-700">{fmt(Math.max(0, (summary?.remainingBalance || 0) - Number(amount)))}</span>
                        </div>
                    )}
                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Note (optional)</label>
                        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Emergency payment" />
                    </div>
                    {error && <p className="text-sm text-rose-600 flex items-center gap-1"><AlertCircle className="h-4 w-4" />{error}</p>}
                </div>
            </Modal>
        </div>
    );
};

export default ExpenseManagement;
