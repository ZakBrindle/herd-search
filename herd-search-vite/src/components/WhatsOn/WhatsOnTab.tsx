import { useState } from 'react';
import StageList, { type Stage } from './StageList';
import StageSchedule from './StageSchedule';

interface WhatsOnTabProps {
    userData: any;
    showAlert: (msg: string) => void;
    showConfirm: (msg: string, onConfirm: () => void) => void;
}

export default function WhatsOnTab({ userData, showAlert, showConfirm }: WhatsOnTabProps) {
    const [selectedStage, setSelectedStage] = useState<Stage | null>(null);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#121212', color: 'white' }}>
            {!selectedStage && (
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    padding: '1rem',
                    borderBottom: '1px solid #333',
                    background: 'rgba(18,18,18,0.95)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <img src="/logo-flash.png" alt="Logo" style={{ height: '32px' }} />
                        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>What's On</h2>
                    </div>
                    {/* The profile picture is rendered globally in App.tsx user-controls, but we can ensure spacing or duplicate it here if needed. 
                        Wait, App.tsx renders user-controls if activeTab !== 'profile'. So it will be visible. 
                        We just leave space for it on the right. */}
                    <div style={{ width: '40px' }} />
                </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto' }}>
                {selectedStage ? (
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
