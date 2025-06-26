const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const session = require('express-session');
const http = require('http');
const cors = require('cors');
const passport = require('passport');
const flash = require('express-flash');

const fs = require('fs');

const { Server } = require('socket.io');
const { Op } = require('sequelize');
const { spawn } = require('child_process');

// Sequelize Models
// const sequelize = require('./model/index');
// const User = require('./model/user');
// const CallLog = require('./model/calllog');
// CallLog.sync({ alter: true });

// Routes
const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const roomRouter = require('./routes/room');
const { error } = require('console');




// App setup
const app = express();
const server = http.createServer(app);



// Socket.IO setup
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');
const recordingsDir = path.join(__dirname, './routes/recordings');
console.log(recordingsDir, 'recordings directory');

if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir);
}
app.use('/recordings', express.static(recordingsDir)); // Serve recording files

// Middleware
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: true
}));

require('./middleware/passport')(passport);
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  res.locals.error = req.flash("error");
  res.locals.user = req.user;
  next();
});


// Routes
app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/room', roomRouter);

// WebRTC signaling logic
const rooms = {};
const roomCreators = {};

const recordingProcesses = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (roomId) => {
    socket.join(roomId);
    console.log(`${socket.id} joined ${roomId}`);

    if (!roomCreators[roomId]) {
      roomCreators[roomId] = socket.id;
    }

    const otherUsers = [...io.sockets.adapter.rooms.get(roomId) || []].filter(id => id !== socket.id);
    socket.emit('all-users', otherUsers);
    socket.emit('is-creator', socket.id === roomCreators[roomId]);
    socket.to(roomId).emit('user-joined', socket.id);
  });

  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('chat-message', ({ room, msg }) => {
    socket.to(room).emit('chat-message', { from: socket.id, msg });
  });

  socket.on('leave', (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit('user-left', socket.id);
    if (roomCreators[roomId] === socket.id) {
      delete roomCreators[roomId];
    }
  });

  socket.on('whiteboard-draw', (data) => {
    const { roomId } = data;
    if (roomCreators[roomId] === socket.id) {
      socket.to(roomId).emit('whiteboard-draw', data);
    }
  });

  socket.on('whiteboard-clear', (roomId) => {
    if (roomCreators[roomId] === socket.id) {
      socket.to(roomId).emit('whiteboard-clear', roomId);
    }
  });

socket.on('start-recording', ({ room }) => {
  const recordScript = path.join(__dirname, './routes/recorder.js');
  const child = spawn('node', [recordScript, room], {
    stdio: 'inherit' // 🔁 Pipe output to terminal
  });

  recordingProcesses[room] = child;

  child.on('close', () => {
    console.log(`🎬 Recording saved for room ${room}`);
    socket.emit('recording-available', `${room}.mp4`);
    delete recordingProcesses[room];
  });

  child.on('error', (err) => {
    console.error(`❌ Recording error: ${err.message}`);
  });

  console.log(`🎥 Started recording room: ${room}`);
});


  socket.on('stop-recording', ({ room }) => {
    const child = recordingProcesses[room];
    if (child) {
      child.kill('SIGINT');
      delete recordingProcesses[room];
      console.log(`🛑 Stopped recording for room: ${room}`);
    } else {
      console.log(`⚠️ No active recording found for room: ${room}`);
    }
  });












  socket.on('disconnecting', () => {
    const userRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    userRooms.forEach(roomId => {
      socket.to(roomId).emit('user-left', socket.id);
      if (roomCreators[roomId] === socket.id) {
        delete roomCreators[roomId];
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
})

// WebSocket Recorder for /record/:socketId
app.use(express.static('public'));
// WebSocket server

// 404 and error handling
app.use((req, res, next) => next(createError(404)));

app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.render('error');
});

// Start server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
