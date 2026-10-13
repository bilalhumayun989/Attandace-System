import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { API_BASE_URL } from '../config';

const RemoveBiometricModal = ({ onClose }) => {
    const [type, setType] = useState('face');
    const [users, setUsers] = useState([]);
    const [selectedIds, setSelectedIds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState(false);
    const [feedback, setFeedback] = useState(null);

    useEffect(() => {
        const controller = new AbortController();
        const loadUsers = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/attendance/biometrics/users`, {
                    headers: { 'X-Role-Context': 'Admin' }, credentials: 'include', signal: controller.signal
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.message || 'Unable to load users');
                if (!Array.isArray(data)) throw new Error('Invalid user list received');
                setUsers(data);
            } catch (error) {
                if (error.name !== 'AbortError') setFeedback({ error: true, text: error.message });
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        };
        loadUsers();
        return () => controller.abort();
    }, []);

    const enrollmentField = type === 'face' ? 'faceEnrolled' : 'fingerprintEnrolled';
    const eligibleUsers = users.filter(user => user[enrollmentField]);
    const allSelected = eligibleUsers.length > 0 && selectedIds.length === eligibleUsers.length;
    const close = () => { if (!deleting) onClose(); };
    const changeType = (nextType) => {
        setType(nextType);
        setSelectedIds([]);
        setFeedback(null);
    };
    const toggleUser = (id) => setSelectedIds(current =>
        current.includes(id) ? current.filter(selected => selected !== id) : [...current, id]
    );
    const deleteSelected = async () => {
        if (deleting || !selectedIds.length) return;
        if (!window.confirm(`Delete ${type} data for ${selectedIds.length} selected user(s)? They will need to re-enroll their ${type}. This cannot be undone.`)) return;
        setDeleting(true);
        setFeedback(null);
        try {
            const response = await fetch(`${API_BASE_URL}/attendance/biometrics`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'X-Role-Context': 'Admin' },
                credentials: 'include', body: JSON.stringify({ type, userIds: selectedIds })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Unable to delete biometric data');
            setUsers(current => current.map(user => selectedIds.includes(user._id)
                ? { ...user, [enrollmentField]: false } : user));
            setSelectedIds([]);
            setFeedback({ error: false, text: data.message });
        } catch (error) {
            setFeedback({ error: true, text: error.message || 'Error connecting to server' });
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Modal isOpen onClose={close} title="Remove Biometric" footer={
            <>
                <Button variant="outline" onClick={close} disabled={deleting}>Close</Button>
                <Button variant="destructive" onClick={deleteSelected} disabled={loading || deleting || !selectedIds.length}>
                    {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {deleting ? 'Deleting...' : `Delete ${selectedIds.length ? `(${selectedIds.length})` : ''}`}
                </Button>
            </>
        }>
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Choose the biometric data to remove, then select users.</p>
                <div className="flex gap-2">
                    <Button variant={type === 'face' ? 'default' : 'outline'} aria-pressed={type === 'face'} onClick={() => changeType('face')} disabled={deleting}>Delete Faces</Button>
                    <Button variant={type === 'fingerprint' ? 'default' : 'outline'} aria-pressed={type === 'fingerprint'} onClick={() => changeType('fingerprint')} disabled={deleting}>Delete Fingerprints</Button>
                </div>
                {feedback && <p role={feedback.error ? 'alert' : 'status'} className={`text-sm ${feedback.error ? 'text-red-500' : 'text-green-600'}`}>{feedback.text}</p>}
                {loading ? (
                    <div className="flex items-center gap-2 py-6"><Loader2 className="h-4 w-4 animate-spin" />Loading users...</div>
                ) : eligibleUsers.length ? (
                    <>
                        <label className="flex items-center gap-3 border-b pb-3 font-medium text-sm">
                            <input type="checkbox" checked={allSelected} disabled={deleting} onChange={() => setSelectedIds(allSelected ? [] : eligibleUsers.map(user => user._id))} />
                            Select all ({eligibleUsers.length} users)
                        </label>
                        <div className="max-h-64 overflow-y-auto space-y-2">
                            {eligibleUsers.map(user => (
                                <label key={user._id} className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
                                    <input type="checkbox" checked={selectedIds.includes(user._id)} disabled={deleting} onChange={() => toggleUser(user._id)} />
                                    <div>
                                        <p className="text-sm font-medium">{user.name}</p>
                                        <p className="text-xs text-muted-foreground">{user.employeeId}</p>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </>
                ) : <p className="py-4 text-sm text-muted-foreground">No users have {type === 'face' ? 'face' : 'fingerprint'} data enrolled.</p>}
                <p className="text-xs text-muted-foreground">Selected users will need to re-enroll the deleted biometric data.</p>
            </div>
        </Modal>
    );
};

export default RemoveBiometricModal;
