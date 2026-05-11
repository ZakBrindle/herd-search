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
