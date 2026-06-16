const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// 방 정보 메모리에 저장 (DB 없이 PoC)
const rooms = {};

// 거리 계산 (Haversine 공식)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 지구 반지름 (미터)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// 방향 계산 (나침반용)
function getBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// 거리 → 추상화 텍스트 변환
function getAbstractDistance(meters) {
  if (meters < 100) return '거의 다 왔어요!';
  if (meters < 500) return `도보 ${Math.round(meters / 80)}분 남음`;
  if (meters < 2000) return `도보 ${Math.round(meters / 80)}분 남음`;
  return `약 ${(meters / 1000).toFixed(1)}km 남음`;
}

// 방 생성 API
app.post('/room', (req, res) => {
  const { roomId, destination, meetingTime } = req.body;
  rooms[roomId] = {
    destination,   // { lat, lon, name }
    meetingTime,   // ISO 문자열
    members: {}
  };
  res.json({ success: true, roomId });
});

// 방 정보 조회 API
app.get('/room/:roomId', (req, res) => {
  const room = rooms[req.params.roomId];
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없어요' });
  res.json(room);
});

// Socket.io 실시간 연결
io.on('connection', (socket) => {
  console.log('유저 연결:', socket.id);

  // 방 참가
  socket.on('join_room', ({ roomId, userName }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userName = userName;

    if (rooms[roomId]) {
      rooms[roomId].members[socket.id] = { userName, lat: null, lon: null };
    }
    console.log(`${userName} 이 ${roomId} 방에 참가`);
  });

  // 위치 업데이트
  socket.on('update_location', ({ roomId, lat, lon }) => {
    const room = rooms[roomId];
    if (!room) return;

    const member = room.members[socket.id];
    if (!member) return;

    member.lat = lat;
    member.lon = lon;

    // 목적지 기준 추상화 정보 계산
    const dest = room.destination;
    const distance = getDistance(lat, lon, dest.lat, dest.lon);
    const bearing = getBearing(lat, lon, dest.lat, dest.lon);
    const abstractInfo = getAbstractDistance(distance);

    // 본인 제외 전체에게 브로드캐스트
    socket.to(roomId).emit('member_updated', {
      socketId: socket.id,
      userName: member.userName,
      distance,
      bearing,
      abstractInfo
    });

    // 본인에게도 자신의 정보 전송
    socket.emit('my_info', { distance, bearing, abstractInfo });
  });

  // 연결 해제
  socket.on('disconnect', () => {
    const { roomId, userName } = socket.data;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].members[socket.id];
      io.to(roomId).emit('member_left', { socketId: socket.id, userName });
    }
    console.log('유저 연결 해제:', socket.id);
  });
});

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});