import React, { useState } from 'react';
import { theme } from '../App';

function JoinRoom({ onJoined, onBack }) {
  const [userName, setUserName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    if (!userName || !roomId) {
      alert('모든 항목을 입력해주세요 🥺');
      return;
    }
    setLoading(true);
    const res = await fetch(`http://localhost:4000/room/${roomId.toUpperCase()}`);
    if (!res.ok) {
      alert('방을 찾을 수 없어요 😢');
      setLoading(false);
      return;
    }
    const data = await res.json();
    setLoading(false);
    onJoined({ roomId: roomId.toUpperCase(), userName, meetingTime: data.meetingTime });
  };

  return (
    <div>
      <button onClick={onBack} style={backBtn}>← 뒤로</button>
      <div style={card}>
        <h2 style={{ color: theme.text, marginTop: 0 }}>🚀 방 참가하기</h2>
        <div style={formStyle}>
          <label style={labelStyle}>내 이름</label>
          <input value={userName} onChange={e => setUserName(e.target.value)}
            placeholder="홍길동" style={inputStyle} />

          <label style={labelStyle}>방 코드</label>
          <input value={roomId} onChange={e => setRoomId(e.target.value)}
            placeholder="ABC123" style={inputStyle}
            style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '4px', fontSize: '20px', fontWeight: '700' }} />

          <button onClick={handleJoin} disabled={loading}
            style={{ ...actionBtn, backgroundColor: loading ? '#ccc' : theme.peach }}>
            {loading ? '참가 중... 🌀' : '입장하기 🎊'}
          </button>
        </div>
      </div>
    </div>
  );
}

const card = { background: '#fff', borderRadius: '24px', padding: '24px', boxShadow: '0 4px 20px #FFB99744' };
const formStyle = { display: 'flex', flexDirection: 'column', gap: '10px' };
const labelStyle = { fontSize: '13px', fontWeight: '700', color: '#A07060' };
const inputStyle = { padding: '14px', borderRadius: '14px', border: '2px solid #FFD6C0', fontSize: '15px', outline: 'none', background: '#FFF5EE' };
const actionBtn = { padding: '16px', color: '#fff', border: 'none', borderRadius: '16px', fontSize: '16px', fontWeight: '700', cursor: 'pointer', marginTop: '8px' };
const backBtn = { background: 'none', border: 'none', fontSize: '15px', cursor: 'pointer', marginBottom: '12px', color: '#A07060' };

export default JoinRoom;