import { useState, useEffect } from 'react';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { FaTimes, FaClock, FaMusic, FaCopy, FaPencilAlt, FaTrash } from 'react-icons/fa';
import type { UserData } from '../../contexts/AuthContext';

// Schedule item structure
export interface ScheduleItem {
    day: 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
    time: string; // Format: "10:00", "10:30", etc.
    stage: string;
    performer: string;
}

export interface UserSchedule {
    [key: string]: ScheduleItem; // key format: "Thursday-10:00"
}

interface ScheduleModalProps {
    userData: UserData;
    viewingUser?: UserData | null; // If viewing someone else's schedule
    onClose: () => void;
    showAlert: (message: string) => void;
    showConfirm: (message: string, onConfirm: () => void) => void;
}

// List of stages (can be customized)
const STAGES = [
    'Main Stage',
    'The Ring',
    'The Fortress',
    'The Toil Trees',
    'Garage',
    'The Snug',
    'Working Mens Club',
    'Bushrocker Hi-Fi',
    'Sunrise',
    'The Factory',
    'Hubba Bubba',
    'Launderette',
    'Smoking Tentacles',
    'Waterfall',
    'Campfire',
    'Other'
];

// Generate time slots from 10:00 AM to 4:00 AM (next day)
const generateTimeSlots = () => {
    const slots: string[] = [];

    // 10:00 AM to 11:30 PM
    for (let hour = 10; hour < 24; hour++) {
        slots.push(`${hour.toString().padStart(2, '0')}:00`);
        slots.push(`${hour.toString().padStart(2, '0')}:30`);
    }

    // 12:00 AM to 4:00 AM
    for (let hour = 0; hour <= 4; hour++) {
        slots.push(`${hour.toString().padStart(2, '0')}:00`);
        if (hour < 4) {
            slots.push(`${hour.toString().padStart(2, '0')}:30`);
        }
    }

    return slots;
};

const TIME_SLOTS = generateTimeSlots();
const DAYS: Array<'Thursday' | 'Friday' | 'Saturday' | 'Sunday'> = ['Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function ScheduleModal({ userData, viewingUser, onClose, showAlert, showConfirm }: ScheduleModalProps) {
    const isViewingOwnSchedule = !viewingUser || viewingUser.uid === userData.uid;
    const targetUser = viewingUser || userData;

    const [schedule, setSchedule] = useState<UserSchedule>({});
    const [selectedDay, setSelectedDay] = useState<'Thursday' | 'Friday' | 'Saturday' | 'Sunday'>('Thursday');
    const [loading, setLoading] = useState(true);
    const [editingSlot, setEditingSlot] = useState<string | null>(null);
    const [tempStage, setTempStage] = useState('');
    const [tempPerformer, setTempPerformer] = useState('');

    useEffect(() => {
        loadSchedule();
    }, [targetUser.uid]);

    const loadSchedule = async () => {
        try {
            const userDoc = await getDoc(doc(db, 'users', targetUser.uid));
            if (userDoc.exists()) {
                const data = userDoc.data();
                setSchedule(data.schedule || {});
            }
            setLoading(false);
        } catch (error) {
            console.error("Error loading schedule:", error);
            showAlert("Failed to load schedule");
            setLoading(false);
        }
    };

    const saveScheduleItem = async (day: string, time: string, stage: string, performer: string) => {
        const key = `${day}-${time}`;
        const newSchedule = { ...schedule };

        if (stage && performer) {
            newSchedule[key] = { day: day as any, time, stage, performer };
        } else {
            delete newSchedule[key];
        }

        try {
            await updateDoc(doc(db, 'users', userData.uid), {
                schedule: newSchedule
            });
            setSchedule(newSchedule);
            setEditingSlot(null);
            setTempStage('');
            setTempPerformer('');
        } catch (error) {
            console.error("Error saving schedule:", error);
            showAlert("Failed to save schedule item");
        }
    };

    const copyToMySchedule = async (item: ScheduleItem) => {
        const key = `${item.day}-${item.time}`;
        const existingItem = schedule[key];

        const performCopy = async () => {
            try {
                const myScheduleDoc = await getDoc(doc(db, 'users', userData.uid));
                const mySchedule = myScheduleDoc.exists() ? (myScheduleDoc.data().schedule || {}) : {};

                mySchedule[key] = { ...item };

                await updateDoc(doc(db, 'users', userData.uid), {
                    schedule: mySchedule
                });

                showAlert(`Copied ${item.performer} to your schedule!`);
                onClose(); // Close the modal so they can see the next popup or return to map
            } catch (error) {
                console.error("Error copying to schedule:", error);
                showAlert("Failed to copy to your schedule");
            }
        };

        if (existingItem && !isViewingOwnSchedule) {
            onClose(); // Close instantly so they see the confirm popup
            showConfirm(
                `You already have "${existingItem.performer}" at ${existingItem.stage} scheduled for ${item.day} at ${item.time}. Overwrite it with "${item.performer}" at ${item.stage}?`,
                performCopy
            );
        } else {
            onClose(); // Close instantly
            await performCopy();
        }
    };

    const deleteScheduleItem = async (key: string) => {
        const newSchedule = { ...schedule };
        delete newSchedule[key];

        try {
            await updateDoc(doc(db, 'users', userData.uid), {
                schedule: newSchedule
            });
            setSchedule(newSchedule);
            setEditingSlot(null);
        } catch (error) {
            console.error("Error deleting schedule item:", error);
            showAlert("Failed to delete schedule item");
        }
    };

    const formatTime12Hour = (time: string) => {
        const [hour, minute] = time.split(':').map(Number);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return `${displayHour}:${minute.toString().padStart(2, '0')} ${ampm}`;
    };

    if (loading) {
        return (
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
                    <p style={{ textAlign: 'center' }}>Loading schedule...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
            <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1100px', width: '98%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: '1.5rem' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #333', paddingBottom: '1rem' }}>
                    <div>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FaClock color="var(--primary)" />
                            {isViewingOwnSchedule ? 'My Festival Schedule' : `${targetUser.displayName}'s Schedule`}
                        </h3>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#aaa' }}>
                            {isViewingOwnSchedule ? 'Plan your festival weekend' : 'View and copy to your schedule'}
                        </p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.5rem' }}>
                        <FaTimes />
                    </button>
                </div>

                {/* Day Tabs */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    {DAYS.map(day => (
                        <button
                            key={day}
                            onClick={() => setSelectedDay(day)}
                            className="btn"
                            style={{
                                flex: 1,
                                minWidth: '100px',
                                background: selectedDay === day ? 'var(--primary)' : '#333',
                                color: selectedDay === day ? 'black' : 'white',
                                fontWeight: selectedDay === day ? 'bold' : 'normal',
                                padding: '8px 12px'
                            }}
                        >
                            {day}
                        </button>
                    ))}
                </div>

                {/* Schedule Grid */}
                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #333', borderRadius: '12px', background: '#1a1a1a' }}>
                    {TIME_SLOTS.map((time, index) => {
                        const key = `${selectedDay}-${time}`;
                        const item = schedule[key];
                        const isEven = index % 2 === 0;

                        return (
                            <div key={key} style={{
                                padding: '16px 20px',
                                borderBottom: '1px solid #282828',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '20px',
                                background: editingSlot === key ? 'rgba(187, 134, 252, 0.1)' : (isEven ? 'transparent' : 'rgba(255,255,255,0.02)'),
                                transition: 'background-color 0.2s'
                            }}>
                                {/* Time Column */}
                                <div style={{
                                    minWidth: '94px',
                                    fontSize: '0.95rem',
                                    fontWeight: '700',
                                    color: 'var(--primary)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center'
                                }}>
                                    {formatTime12Hour(time)}
                                </div>

                                {/* Content Column */}
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                                    {editingSlot === key && isViewingOwnSchedule ? (
                                        // Edit Mode
                                        <div style={{ flex: 1, display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                            <select
                                                value={tempStage}
                                                onChange={(e) => setTempStage(e.target.value)}
                                                className="input-field"
                                                style={{ flex: '1 1 180px', marginBottom: 0, background: '#333', color: 'white', padding: '10px', border: '1px solid #444' }}
                                            >
                                                <option value="">Select Stage</option>
                                                {STAGES.map(stage => (
                                                    <option key={stage} value={stage}>{stage}</option>
                                                ))}
                                            </select>
                                            <input
                                                type="text"
                                                value={tempPerformer}
                                                onChange={(e) => setTempPerformer(e.target.value)}
                                                placeholder="Performer / Act"
                                                className="input-field"
                                                style={{ flex: '1 1 180px', marginBottom: 0, background: '#333', color: 'white', padding: '10px', border: '1px solid #444' }}
                                            />
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    onClick={() => saveScheduleItem(selectedDay, time, tempStage, tempPerformer)}
                                                    className="btn"
                                                    style={{ background: 'var(--primary)', color: 'black', padding: '8px 20px', fontSize: '0.9rem', flex: 1 }}
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setEditingSlot(null);
                                                        setTempStage('');
                                                        setTempPerformer('');
                                                    }}
                                                    className="btn"
                                                    style={{ background: '#555', color: 'white', padding: '8px 20px', fontSize: '0.9rem', flex: 1 }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : item ? (
                                        // Display Mode with Item
                                        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ flex: 1, marginRight: '16px' }}>
                                                <div style={{
                                                    fontWeight: '700',
                                                    color: 'white',
                                                    marginBottom: '4px',
                                                    fontSize: '1.05rem',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <FaMusic size={14} style={{ color: 'var(--secondary)' }} />
                                                    {item.performer}
                                                </div>
                                                <div style={{ fontSize: '0.85rem', color: '#888', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <span style={{ color: 'var(--primary)', opacity: 0.8 }}>@</span> {item.stage}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                {!isViewingOwnSchedule && (() => {
                                                    const myScheduleKey = `${item.day}-${item.time}`;
                                                    const myItem = userData.schedule?.[myScheduleKey];
                                                    const hasOverlap = !!myItem;

                                                    return (
                                                        <button
                                                            onClick={() => copyToMySchedule(item)}
                                                            className="btn"
                                                            style={{
                                                                background: hasOverlap ? 'var(--error)' : 'rgba(187, 134, 252, 0.1)',
                                                                color: hasOverlap ? 'white' : 'var(--primary)',
                                                                border: `1px solid ${hasOverlap ? 'var(--error)' : 'rgba(187, 134, 252, 0.3)'}`,
                                                                padding: '6px 14px',
                                                                fontSize: '0.85rem',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '6px',
                                                                fontWeight: '600'
                                                            }}
                                                        >
                                                            <FaCopy size={12} /> {hasOverlap ? 'Replace' : 'Copy'}
                                                        </button>
                                                    );
                                                })()}
                                                {isViewingOwnSchedule && (
                                                    <>
                                                        <button
                                                            onClick={() => {
                                                                setEditingSlot(key);
                                                                setTempStage(item.stage);
                                                                setTempPerformer(item.performer);
                                                            }}
                                                            className="btn icon-button"
                                                            style={{
                                                                background: '#333',
                                                                color: 'var(--primary)',
                                                                width: '32px',
                                                                height: '32px',
                                                                padding: 0,
                                                                border: '1px solid #444',
                                                                borderRadius: '8px'
                                                            }}
                                                            title="Edit"
                                                        >
                                                            <FaPencilAlt size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => deleteScheduleItem(key)}
                                                            className="btn icon-button"
                                                            style={{
                                                                background: 'rgba(207, 102, 121, 0.1)',
                                                                color: 'var(--error)',
                                                                width: '32px',
                                                                height: '32px',
                                                                padding: 0,
                                                                border: '1px solid var(--error)',
                                                                borderRadius: '8px'
                                                            }}
                                                            title="Delete"
                                                        >
                                                            <FaTrash size={14} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ) : isViewingOwnSchedule ? (
                                        // Empty slot - show add button for own schedule
                                        <button
                                            onClick={() => {
                                                setEditingSlot(key);
                                                setTempStage('');
                                                setTempPerformer('');
                                            }}
                                            className="btn"
                                            style={{
                                                flex: 1,
                                                background: 'transparent',
                                                border: '1px dashed #444',
                                                padding: '12px',
                                                fontSize: '0.85rem',
                                                color: '#666',
                                                justifyContent: 'center',
                                                transition: 'all 0.2s',
                                                textAlign: 'center'
                                            }}
                                            onMouseOver={(e) => {
                                                e.currentTarget.style.borderColor = 'var(--primary)';
                                                e.currentTarget.style.color = 'var(--primary)';
                                                e.currentTarget.style.background = 'rgba(187, 134, 252, 0.05)';
                                            }}
                                            onMouseOut={(e) => {
                                                e.currentTarget.style.borderColor = '#444';
                                                e.currentTarget.style.color = '#666';
                                                e.currentTarget.style.background = 'transparent';
                                            }}
                                        >
                                            + Add Performance
                                        </button>
                                    ) : (
                                        // Empty slot - viewing someone else's schedule
                                        <div style={{ flex: 1, color: '#444', fontSize: '0.85rem', fontStyle: 'italic' }}>
                                            No plans scheduled
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
