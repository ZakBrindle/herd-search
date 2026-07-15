import React, { useState, useEffect } from 'react';
import { FaCalendarAlt, FaChevronDown, FaClock, FaMapMarkerAlt } from 'react-icons/fa';
import type { UserData } from '../contexts/AuthContext';
import ScheduleModal from './modals/ScheduleModal';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

// Schedule item structure
interface ScheduleItem {
    day: 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
    time: string; // Format: "10:00", "10:30", etc.
    stage: string;
    performer: string;
}

interface UserSchedule {
    [key: string]: ScheduleItem; // key format: "Thursday-10:00"
}

interface ScheduleTabProps {
    userData: UserData;
    squadMembers: UserData[];
    selectedUser: UserData | null;
    onSelectUser: (user: UserData | null) => void;
    showAlert: (msg: string) => void;
    showConfirm: (msg: string, onConfirm: () => void, confirmText?: string, cancelText?: string) => void;
}

const DAY_INDEX = {
    'Thursday': 0,
    'Friday': 1,
    'Saturday': 2,
    'Sunday': 3
};

const getAbsoluteMinutesForDate = (date: Date) => {
    // Start of Thursday: 2026-07-16 10:00:00 (local time)
    const startOfThursday = new Date('2026-07-16T10:00:00');
    const diffMs = date.getTime() - startOfThursday.getTime();
    return diffMs / (60 * 1000);
};

const getAbsoluteMinutesForItem = (day: 'Thursday' | 'Friday' | 'Saturday' | 'Sunday', timeStr: string) => {
    const dayIdx = DAY_INDEX[day];
    const [hour, minute] = timeStr.split(':').map(Number);
    
    let adjustedHour = hour;
    if (hour < 10) {
        adjustedHour = hour + 24; // late night slots (00:00 to 04:00) belong to the same festival day
    }
    
    return (dayIdx * 24 * 60) + (adjustedHour * 60) + minute - 600;
};

export default function ScheduleTab({
    userData,
    squadMembers,
    selectedUser,
    onSelectUser,
    showAlert,
    showConfirm
}: ScheduleTabProps) {
    const targetUser = selectedUser || userData;

    const [schedule, setSchedule] = useState<UserSchedule>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        const unsub = onSnapshot(doc(db, 'users', targetUser.uid), (docSnap) => {
            if (docSnap.exists()) {
                setSchedule(docSnap.data().schedule || {});
            } else {
                setSchedule({});
            }
            setLoading(false);
        }, (error) => {
            console.error("Error listening to schedule:", error);
            setLoading(false);
        });

        return () => unsub();
    }, [targetUser.uid]);

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

    // Format Time to 12 Hour
    const formatTime12Hour = (time: string) => {
        const [hour, minute] = time.split(':').map(Number);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return `${displayHour}:${minute.toString().padStart(2, '0')} ${ampm}`;
    };

    // Calculate next act
    const getNextAct = () => {
        const items = Object.values(schedule);
        if (items.length === 0) return null;

        const currentAbsoluteMinutes = getAbsoluteMinutesForDate(new Date());

        const upcoming = items
            .map(item => ({
                ...item,
                absMin: getAbsoluteMinutesForItem(item.day, item.time)
            }))
            .filter(item => item.absMin >= currentAbsoluteMinutes);

        if (upcoming.length === 0) return null;

        upcoming.sort((a, b) => a.absMin - b.absMin);
        return upcoming[0];
    };

    const nextAct = getNextAct();

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

                {/* WHERE NEXT: Section */}
                {!loading && (
                    <div style={{
                        padding: '12px 14px',
                        background: 'rgba(3, 218, 198, 0.06)',
                        border: '1px solid rgba(3, 218, 198, 0.15)',
                        borderRadius: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        marginTop: '4px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                WHERE NEXT:
                            </span>
                        </div>
                        {nextAct ? (
                            <div>
                                <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: 'white', marginBottom: '4px' }}>
                                    {nextAct.performer}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: '#aaa', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                        <FaMapMarkerAlt size={12} color="var(--primary)" /> {nextAct.stage}
                                    </span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                        <FaClock size={12} color="var(--primary)" /> {nextAct.day.substring(0, 3)} {formatTime12Hour(nextAct.time)}
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.85rem', color: '#888', fontStyle: 'italic' }}>
                                No upcoming acts scheduled
                            </div>
                        )}
                    </div>
                )}
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
