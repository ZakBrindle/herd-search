import { useState } from 'react';
import StageList, { type Stage } from './StageList';
import StageSchedule from './StageSchedule';
import ScheduleModal from '../modals/ScheduleModal';

interface WhatsOnTabProps {
    userData: any;
    showAlert: (msg: string) => void;
    showConfirm: (msg: string, onConfirm: () => void, confirmText?: string, cancelText?: string) => void;
    initialSubTab?: 'programme' | 'schedule';
}

export default function WhatsOnTab({ userData, showAlert, showConfirm, initialSubTab = 'programme' }: WhatsOnTabProps) {
    const [selectedStage, setSelectedStage] = useState<Stage | null>(null);
    const [activeSubTab, setActiveSubTab] = useState<'programme' | 'schedule'>(initialSubTab);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#121212', color: 'white' }}>

            <div style={{ display: 'flex', gap: '8px', padding: '16px', borderBottom: '1px solid #333' }}>
                <button 
                    onClick={() => setActiveSubTab('programme')} 
                    className="btn" 
                    style={{ 
                        flex: 1, 
                        background: activeSubTab === 'programme' ? 'var(--primary)' : '#333', 
                        color: activeSubTab === 'programme' ? 'black' : 'white',
                        fontWeight: activeSubTab === 'programme' ? 'bold' : 'normal',
                        padding: '10px'
                    }}>
                    Programme
                </button>
                <button 
                    onClick={() => setActiveSubTab('schedule')} 
                    className="btn" 
                    style={{ 
                        flex: 1, 
                        background: activeSubTab === 'schedule' ? 'var(--primary)' : '#333', 
                        color: activeSubTab === 'schedule' ? 'black' : 'white',
                        fontWeight: activeSubTab === 'schedule' ? 'bold' : 'normal',
                        padding: '10px'
                    }}>
                    My Schedule
                </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
                {activeSubTab === 'schedule' ? (
                    <ScheduleModal 
                        userData={userData} 
                        showAlert={showAlert} 
                        showConfirm={showConfirm} 
                        inline={true} 
                    />
                ) : selectedStage ? (
                    <StageSchedule 
                        stage={selectedStage} 
                        userData={userData} 
                        showAlert={showAlert}
                        showConfirm={showConfirm}
                        onBack={() => setSelectedStage(null)} 
                    />
                ) : (
                    <StageList 
                        userData={userData} 
                        onSelectStage={setSelectedStage} 
                        showAlert={showAlert}
                    />
                )}
            </div>
        </div>
    );
}
