import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { FaArrowLeft, FaCopy, FaTrash } from 'react-icons/fa';
import type { Stage } from './StageList';

interface StageScheduleProps {
    stage: Stage;
    userData: any;
    showAlert: (msg: string) => void;
    showConfirm: (msg: string, onConfirm: () => void) => void;
    onBack: () => void;
}

export interface Act {
    id: string;
    name: string;
    startTime: string; // e.g. "14:00"
    endTime: string;   // e.g. "15:30"
    day: string;
}

const DAYS = ['Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
type Day = typeof DAYS[number];

export default function StageSchedule({ stage, userData, showAlert, showConfirm, onBack }: StageScheduleProps) {
    const [selectedDay, setSelectedDay] = useState<Day>('Thursday');
    const [acts, setActs] = useState<Act[]>([]);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editingAct, setEditingAct] = useState<Act | null>(null);
    const [actName, setActName] = useState('');
    const [actStart, setActStart] = useState('');
    const [actEnd, setActEnd] = useState('');

    const isAdmin = userData?.email?.toLowerCase() === 'z4kbrindle@gmail.com' || userData?.isDev;

    useEffect(() => {
        loadSchedule();
    }, [stage.id]);

    const loadSchedule = async () => {
        setLoading(true);
        try {
            const docSnap = await getDoc(doc(db, 'whats_on_schedules', stage.id));
            if (docSnap.exists()) {
                const data = docSnap.data();
                setActs(data.acts || []);
            } else {
                setActs([]);
            }
        } catch (e) {
            console.error("Error loading schedule", e);
            showAlert("Failed to load schedule");
        } finally {
            setLoading(false);
        }
    };

    const handleSaveAct = async () => {
        if (!actName || !actStart || !actEnd) return showAlert("Please fill in all fields");
        
        let newActs = [...acts];
        if (editingAct) {
            newActs = newActs.map(a => a.id === editingAct.id ? { ...a, name: actName, startTime: actStart, endTime: actEnd, day: selectedDay } : a);
        } else {
            newActs.push({
                id: Date.now().toString(),
                name: actName,
                startTime: actStart,
                endTime: actEnd,
                day: selectedDay
            });
        }

        try {
            await setDoc(doc(db, 'whats_on_schedules', stage.id), { acts: newActs }, { merge: true });
            setActs(newActs);
            setIsEditing(false);
            setEditingAct(null);
            setActName('');
            setActStart('');
            setActEnd('');
            showAlert(editingAct ? "Act updated" : "Act added");
        } catch (e) {
            console.error("Error saving act", e);
            showAlert("Failed to save act");
        }
    };

    const handleDeleteAct = async (actId: string) => {
        if (confirm("Delete this act?")) {
            const newActs = acts.filter(a => a.id !== actId);
            try {
                await setDoc(doc(db, 'whats_on_schedules', stage.id), { acts: newActs }, { merge: true });
                setActs(newActs);
                showAlert("Act deleted");
            } catch (e) {
                console.error("Error deleting act", e);
                showAlert("Failed to delete act");
            }
        }
    };

    const generateTimeSlots = (day: Day) => {
        const slots: string[] = [];
        const startHour = 9;
        const endHour = (day === 'Thursday' || day === 'Sunday') ? 24 : 28; // 24 = 12AM, 28 = 4AM next day

        for (let hour = startHour; hour < endHour; hour++) {
            const displayHour = hour >= 24 ? hour - 24 : hour;
            slots.push(`${displayHour.toString().padStart(2, '0')}:00`);
            slots.push(`${displayHour.toString().padStart(2, '0')}:30`);
        }
        if (day === 'Thursday' || day === 'Sunday') {
            slots.push('00:00'); // Midnight
        } else {
            slots.push('04:00'); // 4 AM
        }
        return slots;
    };

    const timeToMinutes = (time: string) => {
        let [hours, minutes] = time.split(':').map(Number);
        if (hours < 9) hours += 24; // Handle post-midnight times
        return hours * 60 + minutes;
    };

    const copyToMySchedule = async (act: Act) => {
        const key = `${act.day}-${act.startTime}`; // Use start time as the 30-min key
        
        const performCopy = async () => {
            try {
                const userDoc = await getDoc(doc(db, 'users', userData.uid));
                const mySchedule = userDoc.exists() ? (userDoc.data().schedule || {}) : {};

                mySchedule[key] = { 
                    day: act.day, 
                    time: act.startTime, 
                    stage: stage.name, 
                    performer: act.name 
                };

                await setDoc(doc(db, 'users', userData.uid), { schedule: mySchedule }, { merge: true });
                showAlert(`Copied ${act.name} to your schedule!`);
            } catch (e) {
                console.error("Error copying schedule", e);
                showAlert("Failed to copy to schedule");
            }
        };

        const userDoc = await getDoc(doc(db, 'users', userData.uid));
        const mySchedule = userDoc.exists() ? (userDoc.data().schedule || {}) : {};
        const existingItem = mySchedule[key];

        if (existingItem) {
            showConfirm(
                `You already have "${existingItem.performer}" at ${existingItem.stage} scheduled at ${act.startTime}. Overwrite it with "${act.name}"?`,
                performCopy
            );
        } else {
            performCopy();
        }
    };

    const timeSlots = generateTimeSlots(selectedDay);
    const dayActs = acts.filter(a => a.day === selectedDay).sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#121212', overflowY: 'auto', paddingBottom: '100px' }}>
            <div style={{ 
                position: 'sticky', 
                top: 0, 
                zIndex: 10, 
                background: 'rgba(18,18,18,0.95)',
                padding: '1rem',
                borderBottom: '1px solid #333'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                    <button onClick={onBack} className="btn icon-button" style={{ color: 'var(--primary)', background: 'transparent' }}>
                        <FaArrowLeft size={20} />
                    </button>
                    <h2 style={{ margin: 0, flex: 1, textAlign: 'center' }}>{stage.name}</h2>
                    <div style={{ width: '40px' }} /> {/* Spacer */}
                </div>
                
                <div style={{ 
                    width: '100%', 
                    height: '180px', 
                    backgroundImage: `url("${stage.imageUrl}")`, 
                    backgroundSize: 'contain', 
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'center',
                    borderRadius: '12px',
                    marginBottom: '1rem',
                    backgroundColor: 'rgba(255,255,255,0.03)'
                }} />

                <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                    {DAYS.map(day => (
                        <button
                            key={day}
                            onClick={() => setSelectedDay(day)}
                            className="btn"
                            style={{
                                flex: 1,
                                minWidth: '80px',
                                padding: '8px',
                                background: selectedDay === day ? 'var(--primary)' : '#333',
                                color: selectedDay === day ? 'black' : 'white',
                                fontWeight: selectedDay === day ? 'bold' : 'normal'
                            }}
                        >
                            {day.substring(0, 3)}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{ padding: '1rem' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '2rem' }}>Loading schedule...</div>
                ) : (
                    <div style={{ position: 'relative' }}>
                        {timeSlots.slice(0, -1).map((time) => {
                            // Find acts starting in this slot or overlapping
                            const slotMinutes = timeToMinutes(time);
                            
                            // For simplicity, we just display acts in the slot they start in
                            const actsInSlot = dayActs.filter(a => {
                                const startMin = timeToMinutes(a.startTime);
                                return startMin >= slotMinutes && startMin < slotMinutes + 30;
                            });

                            return (
                                <div key={time} style={{ 
                                    display: 'flex', 
                                    minHeight: '60px',
                                    borderBottom: '1px solid #333',
                                    position: 'relative'
                                }}>
                                    <div style={{ 
                                        width: '60px', 
                                        padding: '8px 0', 
                                        color: '#888',
                                        fontSize: '0.85rem',
                                        textAlign: 'right',
                                        paddingRight: '12px',
                                        borderRight: '1px solid #333'
                                    }}>
                                        {time}
                                    </div>
                                    <div 
                                        style={{ flex: 1, padding: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}
                                        onClick={() => {
                                            if (isAdmin) {
                                                setEditingAct(null);
                                                setActName('');
                                                setActStart(time);
                                                setActEnd('');
                                                setIsEditing(true);
                                            }
                                        }}
                                    >
                                        {actsInSlot.map(act => (
                                            <div 
                                                key={act.id} 
                                                style={{
                                                    background: 'rgba(187, 134, 252, 0.15)',
                                                    border: '1px solid var(--primary)',
                                                    borderRadius: '8px',
                                                    padding: '8px',
                                                    color: 'white',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    cursor: isAdmin ? 'pointer' : 'default'
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (isAdmin) {
                                                        setEditingAct(act);
                                                        setActName(act.name);
                                                        setActStart(act.startTime);
                                                        setActEnd(act.endTime);
                                                        setIsEditing(true);
                                                    }
                                                }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                    <span style={{ fontWeight: 'bold' }}>{act.name}</span>
                                                    {!isAdmin && (
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); copyToMySchedule(act); }}
                                                            className="btn icon-button"
                                                            style={{ color: 'var(--primary)', padding: '4px', background: 'rgba(0,0,0,0.3)' }}
                                                            title="Copy to My Schedule"
                                                        >
                                                            <FaCopy size={12} />
                                                        </button>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: '#ccc' }}>
                                                    {act.startTime} - {act.endTime}
                                                </div>
                                                {isAdmin && (
                                                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px', justifyContent: 'flex-end' }}>
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteAct(act.id); }}
                                                            className="btn icon-button"
                                                            style={{ color: 'var(--error)', padding: '4px' }}
                                                        >
                                                            <FaTrash size={12} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {isEditing && (
                <div className="modal-overlay" onClick={() => setIsEditing(false)}>
                    <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ flexDirection: 'column' }}>
                        <h3 style={{ marginBottom: '1rem', textAlign: 'center' }}>{editingAct ? 'Edit Act' : 'Add Act'}</h3>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Act Name</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                value={actName} 
                                onChange={(e) => setActName(e.target.value)} 
                                style={{ width: '100%', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Start Time</label>
                                <input 
                                    type="time" 
                                    className="input-field" 
                                    value={actStart} 
                                    onChange={(e) => setActStart(e.target.value)} 
                                    style={{ width: '100%', boxSizing: 'border-box' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>End Time</label>
                                <input 
                                    type="time" 
                                    className="input-field" 
                                    value={actEnd} 
                                    onChange={(e) => setActEnd(e.target.value)} 
                                    style={{ width: '100%', boxSizing: 'border-box' }}
                                />
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button onClick={handleSaveAct} className="btn btn-primary" style={{ flex: 1 }}>Save</button>
                            <button onClick={() => setIsEditing(false)} className="btn btn-secondary" style={{ flex: 1 }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
