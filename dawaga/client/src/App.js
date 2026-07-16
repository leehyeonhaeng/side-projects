import React, { useState, useEffect } from 'react';
import CreateRoom from './components/CreateRoom';
import JoinRoom from './components/JoinRoom';
import RoomView from './components/RoomView';
import { supabase } from './supabase';

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
  const [myRooms, setMyRooms] = useState([]);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    // 현재 로그인 상태 확인
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    // 로그인 상태 변경 감지
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const saved = localStorage.getItem(`dawaga_rooms_${user.id}`);
    if (saved) setMyRooms(JSON.parse(saved));
  }, [user]);

  const saveRoom = (room) => {
    if (!user) return;
    const updated = [room, ...myRooms.filter(r => r.roomId !== room.roomId)];
    setMyRooms(updated);
    localStorage.setItem(`dawaga_rooms_${user.id}`, JSON.stringify(updated));
  };

  const deleteRoom = (roomId) => {
    if (!user) return;
    const updated = myRooms.filter(r => r.roomId !== roomId);
    setMyRooms(updated);
    localStorage.setItem(`dawaga_rooms_${user.id}`, JSON.stringify(updated));
  };

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setMyRooms([]);
  };

  if (authLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: `linear-gradient(160deg, #FFF5EE 0%, #FFE8D6 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <p style={{ color: '#A07060', fontSize: '16px' }}>🧭 로딩 중...</p>
      </div>
    );
  }

  if (screen === 'room') return (
    <RoomView roomData={roomData} onBack={() => setScreen('home')} />
  );

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(160deg, ${theme.bg} 0%, #FFE8D6 100%)`,
      fontFamily: "'Segoe UI', sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: '420px', margin: '0 auto', padding: '24px' }}>

        {/* 헤더 */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '52px', marginBottom: '4px' }}>🧭</div>
          <h1 style={{ fontSize: '32px', fontWeight: '800', color: theme.text, margin: 0 }}>다와가</h1>
          <p style={{ color: theme.subtext, marginTop: '6px', fontSize: '14px' }}>
            약속 시간만 잠깐, 우리 어디쯤이야? 🌸
          </p>
        </div>

        {/* 로그인 안 된 상태 */}
        {!user ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ background: '#fff', borderRadius: '24px', padding: '32px', boxShadow: '0 4px 20px #FFB99744', marginBottom: '16px' }}>
              <p style={{ color: theme.subtext, fontSize: '15px', marginBottom: '24px', margin: '0 0 24px' }}>
                구글 계정으로 로그인하고<br />약속을 만들어보세요 🎉
              </p>
              <button onClick={handleLogin} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '10px', width: '100%', padding: '14px',
                background: '#fff', border: '2px solid #FFD6C0',
                borderRadius: '16px', fontSize: '16px', fontWeight: '700',
                cursor: 'pointer', color: theme.text,
                boxShadow: '0 2px 8px #FFB99733'
              }}>
                <img src="https://www.google.com/favicon.ico" alt="google" width="20" height="20" />
                Google로 로그인
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 유저 정보 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: '#fff', borderRadius: '16px', padding: '12px 16px', boxShadow: '0 2px 8px #FFB99733' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {user.user_metadata?.avatar_url && (
                  <img src={user.user_metadata.avatar_url} alt="profile" width="32" height="32" style={{ borderRadius: '50%' }} />
                )}
                <span style={{ fontSize: '14px', fontWeight: '700', color: theme.text }}>
                  {user.user_metadata?.full_name || user.email}
                </span>
              </div>
              <button onClick={handleLogout} style={{
                background: 'none', border: '1px solid #FFD6C0', borderRadius: '10px',
                padding: '4px 10px', fontSize: '12px', color: theme.subtext, cursor: 'pointer'
              }}>로그아웃</button>
            </div>

            {/* 버튼 */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
              <button onClick={() => setScreen('create')} style={mainBtn(theme.accent)}>
                ✨ 새 약속
              </button>
              <button onClick={() => setScreen('join')} style={mainBtn(theme.peach)}>
                🚀 참가하기
              </button>
            </div>

            {/* 약속 목록 */}
            <h3 style={{ color: theme.text, margin: '0 0 12px', fontSize: '16px' }}>📋 내 약속 목록</h3>
            {myRooms.length === 0 ? (
              <div style={emptyCard}>
                <p style={{ margin: 0, color: theme.subtext, fontSize: '14px', textAlign: 'center' }}>
                  아직 약속이 없어요 🥲<br />새 약속을 만들어보세요!
                </p>
              </div>
            ) : (
              myRooms.map((room) => {
                const meeting = new Date(room.meetingTime);
                const now = new Date();
                const diff = meeting - now;
                const isPast = diff < -60 * 60 * 1000;
                const isActive = diff <= 60 * 60 * 1000 && diff >= -60 * 60 * 1000;

                return (
                  <div key={room.roomId} style={roomCard(isActive)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }} onClick={() => { setRoomData(room); setScreen('room'); }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{
                            fontSize: '11px', fontWeight: '700', padding: '2px 8px',
                            borderRadius: '20px', background: isActive ? '#FFE89A' : isPast ? '#eee' : '#FFD6C0',
                            color: theme.text
                          }}>
                            {isActive ? '🟢 진행중' : isPast ? '⚫ 종료' : '⏸ 대기중'}
                          </span>
                          <span style={{ fontSize: '12px', color: theme.subtext, fontWeight: '700', letterSpacing: '2px' }}>
                            {room.roomId}
                          </span>
                        </div>
                        <p style={{ margin: '4px 0 0', fontWeight: '700', color: theme.text, fontSize: '15px' }}>
                          📍 {room.destination?.name || '약속 장소'}
                        </p>
                        <p style={{ margin: '4px 0 0', color: theme.subtext, fontSize: '13px' }}>
                          {meeting.toLocaleString('ko-KR')}
                        </p>
                      </div>
                      <button onClick={() => deleteRoom(room.roomId)} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: '16px', color: '#ccc', padding: '0 0 0 8px'
                      }}>✕</button>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {screen === 'create' && (
          <CreateRoom
            onCreated={(data) => { saveRoom(data); setRoomData(data); setScreen('room'); }}
            onBack={() => setScreen('home')}
          />
        )}

        {screen === 'join' && (
          <JoinRoom
            onJoined={(data) => { saveRoom(data); setRoomData(data); setScreen('room'); }}
            onBack={() => setScreen('home')}
          />
        )}
      </div>
    </div>
  );
}

const mainBtn = (bg) => ({
  flex: 1, padding: '16px', backgroundColor: bg, color: '#fff',
  border: 'none', borderRadius: '20px', fontSize: '16px',
  fontWeight: '700', cursor: 'pointer', boxShadow: `0 4px 15px ${bg}88`,
});

const emptyCard = {
  background: '#fff', borderRadius: '20px', padding: '24px',
  boxShadow: '0 2px 12px #FFB99733',
};

const roomCard = (isActive) => ({
  background: '#fff', borderRadius: '20px', padding: '16px',
  marginBottom: '10px',
  boxShadow: isActive ? '0 2px 16px #FF8C6944' : '0 2px 12px #FFB99733',
  border: isActive ? '2px solid #FFE89A' : '2px solid transparent',
  cursor: 'pointer',
});

export default App;