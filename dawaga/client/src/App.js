import React, { useState } from 'react';
import CreateRoom from './components/CreateRoom';
import JoinRoom from './components/JoinRoom';
import RoomView from './components/RoomView';

const theme = {
  peach: '#FFB997',
  yellow: '#FFE89A',
  bg: '#FFF5EE',
  accent: '#FF8C69',
  soft: '#FFD6C0',
  text: '#5A3E36',
  subtext: '#A07060',
  white: '#FFFFFF',
};

export { theme };

function App() {
  const [screen, setScreen] = useState('home');
  const [roomData, setRoomData] = useState(null);

  if (screen === 'room') return <RoomView roomData={roomData} onBack={() => setScreen('home')} />;

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(160deg, ${theme.bg} 0%, #FFE8D6 100%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Segoe UI', sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: '420px', padding: '24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ fontSize: '64px', marginBottom: '8px' }}>🧭</div>
          <h1 style={{ fontSize: '36px', fontWeight: '800', color: theme.text, margin: 0, letterSpacing: '-1px' }}>
            다와가
          </h1>
          <p style={{ color: theme.subtext, marginTop: '8px', fontSize: '15px' }}>
            약속 시간만 잠깐, 우리 어디쯤이야? 🌸
          </p>
        </div>

        {screen === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <button onClick={() => setScreen('create')} style={mainBtn(theme.accent)}>
              ✨ 약속방 만들기
            </button>
            <button onClick={() => setScreen('join')} style={mainBtn(theme.peach)}>
              🚀 방 참가하기
            </button>
            <p style={{ textAlign: 'center', color: theme.subtext, fontSize: '13px', marginTop: '16px' }}>
              약속 1시간 전~후만 위치 공유돼요 🔒
            </p>
          </div>
        )}

        {screen === 'create' && (
          <CreateRoom
            onCreated={(data) => { setRoomData(data); setScreen('room'); }}
            onBack={() => setScreen('home')}
          />
        )}

        {screen === 'join' && (
          <JoinRoom
            onJoined={(data) => { setRoomData(data); setScreen('room'); }}
            onBack={() => setScreen('home')}
          />
        )}
      </div>
    </div>
  );
}

const mainBtn = (bg) => ({
  padding: '18px',
  backgroundColor: bg,
  color: '#fff',
  border: 'none',
  borderRadius: '20px',
  fontSize: '17px',
  fontWeight: '700',
  cursor: 'pointer',
  boxShadow: `0 4px 15px ${bg}88`,
});

export default App;