import React from 'react';
import { FaCalendarAlt, FaChevronDown } from 'react-icons/fa';
import type { UserData } from '../contexts/AuthContext';
import ScheduleModal from './modals/ScheduleModal';

interface ScheduleTabProps {
    userData: UserData;
    squadMembers: UserData[];
    selectedUser: UserData | null;
    onSelectUser: (user: UserData | null) => void;
    showAlert: (msg: string) => void;
    showConfirm: (msg: string, onConfirm: () => void, confirmText?: string, cancelText?: string) => void;
}

export default function ScheduleTab({
    userData,
    squadMembers,
    selectedUser,
    onSelectUser,
    showAlert,
    showConfirm
}: ScheduleTabProps) {
    const targetUser = selectedUser || userData;

    // Build unique list of dropdown options (current user first, then other squad members)
    const dropdownMembers = [
        { uid: userData.uid, displayName: 'My Schedule' },
        ...squadMembers.filter(m => m.uid !== userData.uid).map(m => ({
            uid: m.uid,
            displayName: `${m.displayName?.split(' ')[0]}'s Schedule`
        }))
    ];

    const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const uid = e.target.value;
        if (uid === userData.uid) {
            onSelectUser(null); // null means "me" (userData)
        } else {
            const member = squadMembers.find(m => m.uid === uid);
            if (member) {
                onSelectUser(member);
            }
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#121212', color: 'white' }}>
            {/* Dropdown Header Selector */}
            <div style={{
                padding: '16px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(30, 30, 30, 0.6)',
                backdropFilter: 'blur(10px)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FaCalendarAlt color="var(--primary)" size={20} />
                    <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 'bold', background: 'linear-gradient(45deg, var(--primary), var(--secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        Festival Schedules
                    </h2>
                </div>

                <div style={{ position: 'relative', width: '100%' }}>
                    <select
                        value={targetUser.uid}
                        onChange={handleSelectChange}
                        style={{
                            width: '100%',
                            padding: '14px 40px 14px 16px',
                            fontSize: '1rem',
                            fontWeight: '600',
                            color: 'white',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '12px',
                            cursor: 'pointer',
                            outline: 'none',
                            appearance: 'none',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 4px 10px rgba(0,0,0,0.2)'
                        }}
                    >
                        {dropdownMembers.map(member => (
                            <option key={member.uid} value={member.uid} style={{ background: '#222', color: 'white' }}>
                                {member.displayName}
                            </option>
                        ))}
                    </select>
                    <div style={{
                        position: 'absolute',
                        right: '16px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        pointerEvents: 'none',
                        color: 'rgba(255, 255, 255, 0.6)'
                    }}>
                        <FaChevronDown size={14} />
                    </div>
                </div>
            </div>

            {/* Schedule Body */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                <ScheduleModal
                    key={targetUser.uid}
                    userData={userData}
                    viewingUser={targetUser}
                    showAlert={showAlert}
                    showConfirm={showConfirm}
                    inline={true}
                />
            </div>
        </div>
    );
}
