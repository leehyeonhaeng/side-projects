require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Supabase 클라이언트 (서비스 키 사용)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ODSAY_API_KEY = process.env.ODSAY_API_KEY;
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;

// 실시간 위치 메모리 저장 (위치는 DB 저장 안 함)
const roomSessions = {};

const NUDGE_MESSAGES = {
  friend: [
    "야 너 지금 어디야? 우리 다 왔거든? 🔥",
    "혹시 집에서 출발은 한 거야...? 🤔",
    "너 때문에 배고파 죽겠다 진짜 😤",
    "GPS가 너를 포기했나봐 🛰️",
    "우리 너 없이 먼저 시작한다? 😤",
    "혹시 오늘 약속 까먹은 거 아니지? 🙃",
    "지금 어디쯤이야? 대충이라도 알려줘 😭",
    "너만 기다리고 있어... 빨리와 제발 🥺",
  ],
  sarcastic: [
    "오늘도 패션 지각이시네요~ 역시 믿고 기다렸어요 👏",
    "바쁘신 분이 이런 자리까지 와주시다니 영광입니다 🙏",
    "혹시 약속 날짜를 다르게 적어두신 건 아니죠? 😊",
    "늦게 오는 사람이 제일 빛난다고 하더라고요~ 기대할게요 ✨",
    "천천히 오세요~ 우리 시간 많아요~ (없음) 😇",
    "오는 길에 무슨 일이 있으셨나요? 걱정이 되어서요 🤭",
    "혹시 저희가 장소를 잘못 알려드린 건 아닌지 걱정되네요 😌",
    "도착하시면 박수로 맞이해 드릴게요 👏👏👏",
  ],
  office: [
    "현재 미팅 시작 대기 중입니다. ETA 공유 부탁드립니다. 🙏",
    "도착 예정 시간 업데이트 가능하실까요?",
    "현재 N분 지연 중입니다. 조속한 도착 부탁드립니다.",
    "선약이 있으신 건지 확인 요청드립니다.",
    "팀원 전원 대기 중입니다. 빠른 합류 부탁드립니다.",
    "일정 조율이 필요하신 경우 사전 공유 부탁드립니다.",
    "현재 장소 도착 완료했습니다. 위치 공유 부탁드립니다.",
    "금일 약속 컨펌 부탁드립니다. 🙏",
  ]
};

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function getAbstractDistance(meters, transport, etaMinutes) {
  if (etaMinutes !== null && etaMinutes !== undefined) {
    if (meters < 100) return '거의 다 왔어요! 🎉';
    return `${etaMinutes}분 후 도착 예정`;
  }
  if (meters < 100) return '거의 다 왔어요! 🎉';
  if (meters < 500) return `도보 ${Math.round(meters / 80)}분 남음`;
  return `약 ${(meters / 1000).toFixed(1)}km 남음`;
}

// 독촉 메시지
app.get('/nudge/:mode', (req, res) => {
  const { mode } = req.params;
  const messages = NUDGE_MESSAGES[mode] || NUDGE_MESSAGES.friend;
  const random = messages[Math.floor(Math.random() * messages.length)];
  res.json({ message: random });
});

// 방 생성 (DB 저장)
app.post('/room', async (req, res) => {
  const { roomId, destination, meetingTime } = req.body;
  try {
    const { error } = await supabase.from('rooms').insert({
      room_id: roomId,
      destination_name: destination.name,
      destination_lat: destination.lat,
      destination_lon: destination.lon,
      meeting_time: meetingTime
    });
    if (error) throw error;

    // 메모리에도 세션 초기화
    roomSessions[roomId] = { members: {}, lateFees: {} };
    res.json({ success: true, roomId });
  } catch (err) {
    console.error('방 생성 오류:', err.message);
    res.status(500).json({ error: '방 생성 실패' });
  }
});

// 방 조회 (DB에서)
app.get('/room/:roomId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('room_id', req.params.roomId)
      .single();
    if (error || !data) return res.status(404).json({ error: '방을 찾을 수 없어요' });

    res.json({
      roomId: data.room_id,
      destination: {
        name: data.destination_name,
        lat: data.destination_lat,
        lon: data.destination_lon
      },
      meetingTime: data.meeting_time
    });
  } catch (err) {
    console.error('방 조회 오류:', err.message);
    res.status(500).json({ error: '방 조회 실패' });
  }
});

// 지각비 조회
app.get('/room/:roomId/latefee', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('room_members')
      .select('user_name, late_minutes, late_fee')
      .eq('room_id', req.params.roomId)
      .eq('arrived', true);
    if (error) throw error;

    const lateFees = {};
    data.forEach(m => {
      lateFees[m.user_name] = { lateMinutes: m.late_minutes, lateFee: m.late_fee };
    });
    res.json({ lateFees });
  } catch (err) {
    console.error('지각비 조회 오류:', err.message);
    res.status(500).json({ error: '지각비 조회 실패' });
  }
});

app.post('/route/transit', async (req, res) => {
  const { startX, startY, endX, endY } = req.body;
  try {
    const response = await axios.get('https://api.odsay.com/v1/api/searchPubTransPathT', {
      params: {
        apiKey: ODSAY_API_KEY,
        SX: startX, SY: startY, EX: endX, EY: endY,
        SearchType: 0, SearchPathType: 0
      }
    });
    const data = response.data;
    if (data.result && data.result.path && data.result.path.length > 0) {
      const bestPath = data.result.path[0];
      const totalTime = bestPath.info.totalTime;
      const subwayCount = bestPath.info.subwayCount;
      const busCount = bestPath.info.busCount;
      let transportDesc = '';
      if (subwayCount > 0 && busCount > 0) transportDesc = '지하철+버스 환승';
      else if (subwayCount > 0) transportDesc = `지하철 ${subwayCount}회`;
      else if (busCount > 0) transportDesc = `버스 ${busCount}회`;
      res.json({ success: true, totalTime, transportDesc });
    } else {
      res.json({ success: false, message: '경로를 찾을 수 없어요' });
    }
  } catch (err) {
    console.error('ODsay 오류:', err.message);
    res.json({ success: false, message: 'ODsay API 오류' });
  }
});

app.post('/route/car', async (req, res) => {
  const { startX, startY, endX, endY } = req.body;
  try {
    const response = await axios.get('https://apis-navi.kakaomobility.com/v1/directions', {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
      params: { origin: `${startX},${startY}`, destination: `${endX},${endY}` }
    });
    const data = response.data;
    if (data.routes && data.routes.length > 0 && data.routes[0].result_code === 0) {
      const duration = Math.round(data.routes[0].summary.duration / 60);
      res.json({ success: true, totalTime: duration });
    } else {
      res.json({ success: false, message: '경로를 찾을 수 없어요' });
    }
  } catch (err) {
    console.error('카카오모빌리티 오류:', err.message);
    res.json({ success: false, message: '카카오모빌리티 API 오류' });
  }
});

io.on('connection', (socket) => {
  console.log('유저 연결:', socket.id);

  socket.on('join_room', async ({ roomId, userName, userId }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userName = userName;

    // 세션 초기화
    if (!roomSessions[roomId]) {
      roomSessions[roomId] = { members: {}, lateFees: {} };
    }

    roomSessions[roomId].members[socket.id] = {
      userName, lat: null, lon: null,
      transport: 'walk', etaMinutes: null,
      arrived: false, bearing: null, abstractInfo: null, distance: null
    };

    // DB에서 방 정보 가져오기
    const { data: roomData } = await supabase
      .from('rooms')
      .select('*')
      .eq('room_id', roomId)
      .single();

    if (roomData) {
      socket.data.destination = {
        lat: roomData.destination_lat,
        lon: roomData.destination_lon,
        name: roomData.destination_name
      };
      socket.data.meetingTime = roomData.meeting_time;
    }

    // DB에서 지각비 정보 가져오기
    const { data: lateFeeData } = await supabase
      .from('room_members')
      .select('user_name, late_minutes, late_fee')
      .eq('room_id', roomId)
      .eq('arrived', true);

    if (lateFeeData) {
      lateFeeData.forEach(m => {
        roomSessions[roomId].lateFees[m.user_name] = {
          lateMinutes: m.late_minutes,
          lateFee: m.late_fee
        };
      });
    }

    // 기존 멤버 목록 전송
    const existingMembers = Object.entries(roomSessions[roomId].members)
      .filter(([id]) => id !== socket.id)
      .map(([id, m]) => ({
        socketId: id,
        userName: m.userName,
        abstractInfo: m.abstractInfo,
        bearing: m.bearing,
        transport: m.transport,
        arrived: m.arrived
      }));

    socket.emit('existing_members', { members: existingMembers });

    if (Object.keys(roomSessions[roomId].lateFees).length > 0) {
      socket.emit('latefee_updated', { lateFees: roomSessions[roomId].lateFees });
    }

    socket.to(roomId).emit('member_joined', { userName });
    console.log(`${userName}이 ${roomId} 방에 참가`);
  });

  socket.on('update_location', async ({ roomId, lat, lon, transport }) => {
    if (!roomSessions[roomId]) return;
    const member = roomSessions[roomId].members[socket.id];
    if (!member || member.arrived) return;

    member.lat = lat;
    member.lon = lon;
    member.transport = transport || 'walk';

    const dest = socket.data.destination;
    if (!dest) return;

    const distance = getDistance(lat, lon, dest.lat, dest.lon);
    const bearing = getBearing(lat, lon, dest.lat, dest.lon);
    let etaMinutes = null;

    if (transport === 'walk') {
      etaMinutes = Math.round(distance / 80);
    } else if (transport === 'transit') {
      try {
        const result = await axios.post(`http://localhost:${process.env.PORT || 4000}/route/transit`, {
          startX: lon, startY: lat, endX: dest.lon, endY: dest.lat
        });
        if (result.data.success) etaMinutes = result.data.totalTime;
      } catch (e) {}
    } else if (transport === 'car') {
      try {
        const result = await axios.post(`http://localhost:${process.env.PORT || 4000}/route/car`, {
          startX: lon, startY: lat, endX: dest.lon, endY: dest.at
        });
        if (result.data.success) etaMinutes = result.data.totalTime;
      } catch (e) {}
    }

    member.etaMinutes = etaMinutes;
    member.bearing = bearing;
    member.abstractInfo = getAbstractDistance(distance, transport, etaMinutes);
    member.distance = distance;

    socket.to(roomId).emit('member_updated', {
      socketId: socket.id,
      userName: member.userName,
      distance, bearing,
      abstractInfo: member.abstractInfo,
      transport, etaMinutes
    });
    socket.emit('my_info', { distance, bearing, abstractInfo: member.abstractInfo, transport, etaMinutes });
  });

  socket.on('arrive', async ({ roomId }) => {
    if (!roomSessions[roomId]) return;
    const member = roomSessions[roomId].members[socket.id];
    if (!member || member.arrived) return;

    member.arrived = true;
    const arrivedAt = new Date();
    const meetingTime = new Date(socket.data.meetingTime);
    const diffMs = arrivedAt - meetingTime;
    const lateMinutes = diffMs > 0 ? Math.floor(diffMs / 60000) : 0;
    const lateFee = lateMinutes * 500;

    // DB에 저장
    try {
      await supabase.from('room_members').upsert({
        room_id: roomId,
        user_name: member.userName,
        arrived: true,
        arrived_at: arrivedAt.toISOString(),
        late_minutes: lateMinutes,
        late_fee: lateFee
      }, { onConflict: 'room_id,user_name' });
    } catch (err) {
      console.error('지각비 저장 오류:', err.message);
    }

    roomSessions[roomId].lateFees[member.userName] = { lateMinutes, lateFee };

    io.to(roomId).emit('member_arrived', {
      socketId: socket.id,
      userName: member.userName,
      lateMinutes, lateFee
    });
    io.to(roomId).emit('latefee_updated', { lateFees: roomSessions[roomId].lateFees });
    console.log(`${member.userName} 도착, 지각 ${lateMinutes}분, 지각비 ${lateFee}원`);
  });

  socket.on('send_nudge', ({ roomId, fromName, toName, message, isAll }) => {
    io.to(roomId).emit('receive_nudge', { fromName, toName, message, isAll });
  });

  socket.on('disconnect', () => {
    const { roomId, userName } = socket.data;
    if (roomId && roomSessions[roomId]) {
      delete roomSessions[roomId].members[socket.id];
      io.to(roomId).emit('member_left', { socketId: socket.id, userName });
    }
    console.log('유저 연결 해제:', socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});